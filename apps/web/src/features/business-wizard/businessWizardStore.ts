import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
    BankCode,
    BusinessType,
    CreateBusinessRequest,
    TaxationSystem,
} from '@finly/types';
import {
    MVP_BANKS,
    isTaxationAllowedForType,
    requiresTaxation,
} from '@finly/types';
import { taxIdFieldConfig } from '@/entities/business';

/**
 * Sprint 7 §SP-6 — wizard step як **семантичний літерал**, не numeric
 * (`1 | 2 | 3 | 4` до Sprint 7). Причина: dynamic step-list залежить від
 * `formData.type` (`individual` / `organization` пропускають крок
 * `'taxation'`); numeric-нумерація тоді стає крихкою (Step 3 для ФОП =
 * Taxation, для ОСББ = Purpose-Banks). Named steps дають **stable identity**:
 * рендер-вибір у `BusinessWizardForm` робиться за `currentStep === 'taxation'`
 * незалежно від index-у у `steps[]`.
 */
export type BusinessWizardStep =
    | 'type-name'
    | 'requisites'
    | 'taxation'
    | 'purpose-banks';

/**
 * Повний step-list (4 кроки). `taxation` присутній лише для `requiresTaxation`-
 * типів (Sprint 7 §SP-6). `computeStepsForType` нижче — single source of truth
 * для wizard-навігації і `StepNavigator` рендеру.
 */
const FULL_STEPS: readonly BusinessWizardStep[] = [
    'type-name',
    'requisites',
    'taxation',
    'purpose-banks',
] as const;

/**
 * Set валідних step-літералів. Single source of truth для:
 *  - persist-migration v1→v2 (numeric → named)
 *  - stale-state recovery у `BusinessWizardForm` (fallback на 'type-name'
 *    якщо persisted значення випало з enum-у через manual sessionStorage
 *    edit чи downgrade-флоу).
 *
 * `Set<string>` приймає будь-який string у `.has()` — ідеально для type-guard-
 * runtime-перевірки, де compile-type вже втрачено (deserialized JSON).
 */
const VALID_STEPS: ReadonlySet<string> = new Set(FULL_STEPS);

export const isBusinessWizardStep = (
    value: unknown
): value is BusinessWizardStep =>
    typeof value === 'string' && VALID_STEPS.has(value);

const STEPS_WITHOUT_TAXATION: readonly BusinessWizardStep[] = [
    'type-name',
    'requisites',
    'purpose-banks',
] as const;

/**
 * Sprint 7 §SP-6 — обчислити список кроків для wizard-у на основі `type`.
 *
 *  - `fop`, `tov` → 4 кроки (включно з `'taxation'`)
 *  - `individual`, `organization` → 3 кроки (без `'taxation'`)
 *  - `undefined` (тип ще не обраний на Step 1) → ВЕСЬ список 4 кроки —
 *    проміжний стан wizard-у. `nextStep` після обрання типу перерахує і
 *    переключиться на правильний кінцевий list.
 *
 * **Чому readonly tuple, а не computed-on-each-call**: масивні літерали тут —
 * sentinel-значення для `===`-порівнянь у тестах і React `useMemo`-стабільності
 * (один і той самий reference повертається для одного й того самого type).
 */
export const computeStepsForType = (
    type: BusinessType | undefined
): readonly BusinessWizardStep[] => {
    if (type === undefined) return FULL_STEPS;
    return requiresTaxation(type) ? FULL_STEPS : STEPS_WITHOUT_TAXATION;
};

/**
 * UA-назви кроків для `StepNavigator` (`'Крок N з 4'` mobile, horizontal stepper
 * desktop). Single source of truth — frontend рендер читає звідси.
 */
export const STEP_TITLES: Record<BusinessWizardStep, string> = {
    'type-name': 'Тип і назва',
    requisites: 'Реквізити',
    taxation: 'Оподаткування',
    'purpose-banks': 'Призначення і банки',
};

/**
 * Sprint 7 §7.7 — flat draft-shape для wizard-state. Замість
 * `Partial<CreateBusinessRequest>` (що після переходу на discriminated union
 * стає Partial union, де taxation-поля недоступні з individual / organization
 * variant-у), wizard оперує **єдиним структурованим draft-ом** з усіма полями
 * optional і type-незалежними.
 *
 * **Чому flat draft, а не discriminated union у store**: wizard step-by-step
 * заповнює форму; між Step1 (тип ще не обраний) і Step3 (taxation) користувач
 * має cancel + back-navigate freely. Discriminated union у state-shape вимагав
 * би reset taxation-полів при кожній зміні типу — крихко і нечитабельно. Flat
 * draft + final-submit-mapping `draft → CreateBusinessRequest variant` дає
 * single source of truth з чистою dispatch-логікою.
 */
/**
 * Sprint 9 §9.2 — `iban` повністю прибраний з draft (живе тільки на Account,
 * створюється окремою формою пост-create через `POST /businesses/me/{slug}/
 * accounts`). `requisites`-wrapper видалений; `taxId` стає top-level field-ом
 * у draft + у `CreateBusinessSchema`. `invoiceSlugPresetDefault` видалений
 * (orphan-key у Sprint 7 v2-draft — `buildCreateRequestFromDraft` його не
 * emit-ив; Sprint 9 переніс власника поля на Account).
 */
export interface BusinessWizardDraft {
    type?: BusinessType;
    name?: string;
    taxId?: string;
    taxationSystem?: TaxationSystem;
    isVatPayer?: boolean;
    paymentPurposeTemplate?: string;
    acceptedBanks?: BankCode[];
}

/**
 * Sprint 3 §3.7 wizard state. Persist у sessionStorage — щоб випадковий
 * reload не втратив прогрес ФОП. На submit success / cancel — reset.
 *
 * Кожен step валідує власну підмножину через RHF + Zod-resolver на entity-
 * схемах (single source of truth з `@finly/types`); final-submit маппить
 * draft → discriminated `CreateBusinessRequest` (Sprint 7 §7.7).
 */
export interface BusinessWizardState {
    currentStep: BusinessWizardStep;
    formData: BusinessWizardDraft;
    /** Прямий перехід — наприклад, click по past-кроку у `StepNavigator`. */
    setStep: (step: BusinessWizardStep) => void;
    /**
     * Sprint 7 §SP-6 — обрати тип бізнесу. **Атомарно reset-ить taxation-
     * fields у `undefined`** при переході з `requiresTaxation`-type на
     * не-taxation-type (fop/tov → individual/organization). Інакше старі
     * taxation-значення лишилися б у draft-і і `buildCreateRequestFromDraft`
     * пропустив би їх у submit, який далі reject-нувся б backend-ом
     * (`.strict()` на individual/organization-variant).
     *
     * Cross-taxation-type перехід (`fop → tov`): зберігаємо taxation-fields,
     * якщо існуюча `taxationSystem` дозволена для нового типу
     * (`isTaxationAllowedForType`). Інакше скидаємо у `undefined` — на ТОВ
     * групи 1/2 єдиного податку заборонені ПКУ, тож стара `simplified-1` /
     * `simplified-2` з ФОП-draft-у несумісна; без reset користувач застряг
     * би на Step3 з невалідним store-стейтом, який dropdown відфільтрував би
     * з options, але `formData.taxationSystem` лишився б defined → `canProceed`
     * пройшов би, а submit упав на backend Zod-refine.
     *
     * При зворотному переході (individual/organization → fop/tov) поля
     * лишаються `undefined` — користувач заповнить на Step 'taxation'.
     *
     * **`taxId`-reset на несумісний формат** — симетричний інваріант з
     * taxation-clear. Якщо у draft уже введено taxId, який не пройде
     * validator нового типу (наприклад, 10-цифровий РНОКПП після переходу
     * fop → tov, де очікується 8-цифровий ЄДРПОУ) — `taxId` скидається у
     * `undefined`. Без цього Step2 на re-mount хапав би старе значення як
     * `defaultValues`, RHF reject-ив би його новим валідатором, і кнопка
     * "Далі" лишалася б заблокованою поки користувач не видалить надлишок
     * цифр вручну.
     */
    setType: (type: BusinessType) => void;
    patchFormData: (patch: BusinessWizardDraft) => void;
    /** Перейти на наступний step за `computeStepsForType(formData.type)`. */
    nextStep: () => void;
    /** Перейти на попередній step за тим самим списком. */
    prevStep: () => void;
    reset: () => void;
}

/**
 * Sprint 7 §SP-6 — `type` навмисно `undefined` у initial state. Step 1 тепер
 * вимагає явного вибору з 4 опцій (radio-cards), без default-у на ФОП. Жодне
 * "Далі" не enabled поки type не обрано (UI перевіряє `formData.type`).
 *
 * `acceptedBanks` лишається з повним set-ом банків — це Sprint 3 §B6 default
 * "усі 11 увімкнені", що однаковий для всіх 4 типів.
 *
 * `isVatPayer` — НЕ default. До Sprint 7 був `false`, але з 4 типами це
 * неприпустимо: для individual/organization isVatPayer семантично `null`,
 * для fop/tov — обов'язковий вибір на Step 'taxation'.
 */
const INITIAL_FORM: BusinessWizardDraft = {
    acceptedBanks: [...MVP_BANKS],
};

/**
 * Sprint 7 §SP-6 persist — серіалізована частина state. **Без actions** —
 * persist `partialize` zберігає лише data-shape; actions залишаються з
 * `create()`-callback-у на rehydrate. Без `partialize` default-merge переписав
 * би actions на whatever migrate-функція повернула (NoOp stubs у попередній
 * версії), ламаючи store повністю.
 */
type PersistedWizardState = Pick<
    BusinessWizardState,
    'currentStep' | 'formData'
>;

/**
 * Sprint 7 §SP-6 persist migration — `currentStep` змінив shape з `1 | 2 | 3 |
 * 4` (Sprint 3-) на named `BusinessWizardStep` (Sprint 7+). Без bumping persist
 * version старі sessionStorage-значення (numeric `2`) залишилися б у store і
 * `BusinessWizardForm` render-switch (`currentStep === 'requisites'`) не
 * матчив би жодного — порожній екран wizard-у для повертайників із попередньою
 * tab-сесією.
 *
 * **Mapping:** symmetric до старого order (Step1→type-name, Step2→requisites,
 * Step3→taxation, Step4→purpose-banks). Якщо persisted значення невалідне
 * (manual edit, downgrade-flow), fallback на `'type-name'` — wizard
 * перезапускається з початку, без crash чи blank state.
 */
const NUMERIC_STEP_TO_NAMED: Record<number, BusinessWizardStep> = {
    1: 'type-name',
    2: 'requisites',
    3: 'taxation',
    4: 'purpose-banks',
};

/**
 * Sprint 9 §9.2 — v3 migration:
 *  - drop `requisites`-wrapper з draft-shape (`iban` зник повністю, `taxId`
 *    flatten-ується у top-level). v2-payload з `formData.requisites.taxId`
 *    переноситься у `formData.taxId`; `formData.requisites` вилучається.
 *  - drop orphan `invoiceSlugPresetDefault` (v2 містив поле, але emitter
 *    `buildCreateRequestFromDraft` його не emit-ив; Sprint 9 переніс owner-а).
 *
 * Якщо persisted shape неможливо інтерпретувати — fallback на initial state.
 */
const migratePersistedState = (
    persistedState: unknown,
    version: number
): PersistedWizardState => {
    const fallback: PersistedWizardState = {
        currentStep: 'type-name',
        formData: INITIAL_FORM,
    };

    if (typeof persistedState !== 'object' || persistedState === null) {
        return fallback;
    }
    const state = persistedState as {
        currentStep?: unknown;
        formData?: Record<string, unknown>;
    };

    let migratedStep: BusinessWizardStep;
    if (version < 2 && typeof state.currentStep === 'number') {
        migratedStep = NUMERIC_STEP_TO_NAMED[state.currentStep] ?? 'type-name';
    } else if (isBusinessWizardStep(state.currentStep)) {
        migratedStep = state.currentStep;
    } else {
        migratedStep = 'type-name';
    }

    const rawForm = state.formData ?? {};
    const migratedForm: BusinessWizardDraft = { ...INITIAL_FORM };

    // Pass-through полів, що не змінюють форму між v2 і v3.
    if (typeof rawForm.type === 'string') {
        migratedForm.type = rawForm.type as BusinessType;
    }
    if (typeof rawForm.name === 'string') {
        migratedForm.name = rawForm.name;
    }
    if (typeof rawForm.taxationSystem === 'string') {
        migratedForm.taxationSystem = rawForm.taxationSystem as TaxationSystem;
    }
    if (typeof rawForm.isVatPayer === 'boolean') {
        migratedForm.isVatPayer = rawForm.isVatPayer;
    }
    if (typeof rawForm.paymentPurposeTemplate === 'string') {
        migratedForm.paymentPurposeTemplate = rawForm.paymentPurposeTemplate;
    }
    if (Array.isArray(rawForm.acceptedBanks)) {
        migratedForm.acceptedBanks = rawForm.acceptedBanks as BankCode[];
    }

    // v2 → v3: `requisites.taxId` (якщо був) → top-level `taxId`.
    // `requisites.iban` навмисно drop-ається (Account-domain).
    if (version < 3) {
        const requisites = rawForm.requisites as
            | { iban?: unknown; taxId?: unknown }
            | undefined;
        if (
            requisites &&
            typeof requisites === 'object' &&
            typeof requisites.taxId === 'string'
        ) {
            migratedForm.taxId = requisites.taxId;
        }
    } else if (typeof rawForm.taxId === 'string') {
        migratedForm.taxId = rawForm.taxId;
    }

    return {
        currentStep: migratedStep,
        formData: migratedForm,
    };
};

/**
 * "Порожній draft" — користувач ще не ввів жодного поля. `acceptedBanks`
 * навмисно НЕ враховується, бо завжди pre-filled `MVP_BANKS` за дефолтом
 * (Sprint 3 §B6). Перевірка точкова — кожне поле, яке user реально вводить
 * або обирає. Слугує для skip-confirm-on-empty у cancel-flow: якщо нічого
 * не введено — викидати модалку зайве.
 */
export const isWizardDraftEmpty = (draft: BusinessWizardDraft): boolean =>
    draft.type === undefined &&
    !draft.name &&
    !draft.taxId &&
    draft.taxationSystem === undefined &&
    draft.isVatPayer === undefined &&
    !draft.paymentPurposeTemplate;

export const useBusinessWizardStore = create<BusinessWizardState>()(
    persist(
        (set) => ({
            currentStep: 'type-name',
            formData: INITIAL_FORM,
            setStep: (step) => set({ currentStep: step }),
            setType: (type) =>
                set((s) => {
                    const previousType = s.formData.type;
                    const wasTaxationType =
                        previousType !== undefined &&
                        requiresTaxation(previousType);
                    const willBeTaxationType = requiresTaxation(type);
                    const currentSystem = s.formData.taxationSystem;
                    const shouldClearTaxation =
                        (wasTaxationType && !willBeTaxationType) ||
                        (wasTaxationType &&
                            willBeTaxationType &&
                            currentSystem !== undefined &&
                            !isTaxationAllowedForType(type, currentSystem));
                    const currentTaxId = s.formData.taxId;
                    const shouldClearTaxId =
                        typeof currentTaxId === 'string' &&
                        currentTaxId.length > 0 &&
                        !taxIdFieldConfig(type).validator.safeParse(
                            currentTaxId
                        ).success;
                    const nextFormData: BusinessWizardDraft = {
                        ...s.formData,
                        type,
                    };
                    if (shouldClearTaxation) {
                        nextFormData.taxationSystem = undefined;
                        nextFormData.isVatPayer = undefined;
                    }
                    if (shouldClearTaxId) {
                        nextFormData.taxId = undefined;
                    }
                    return { formData: nextFormData };
                }),
            patchFormData: (patch) =>
                set((s) => ({ formData: { ...s.formData, ...patch } })),
            nextStep: () =>
                set((s) => {
                    const steps = computeStepsForType(s.formData.type);
                    const idx = steps.indexOf(s.currentStep);
                    // Якщо поточний step не входить у обчислений list (зміна
                    // типу зробила його irrelevant — наприклад, `taxation`
                    // після setType('individual')) — fallback на 'purpose-banks'
                    // як останній логічний крок.
                    if (idx === -1) {
                        return { currentStep: 'purpose-banks' };
                    }
                    if (idx >= steps.length - 1) {
                        return {};
                    }
                    return { currentStep: steps[idx + 1]! };
                }),
            prevStep: () =>
                set((s) => {
                    const steps = computeStepsForType(s.formData.type);
                    const idx = steps.indexOf(s.currentStep);
                    if (idx <= 0) return {};
                    return { currentStep: steps[idx - 1]! };
                }),
            reset: () =>
                set({ currentStep: 'type-name', formData: INITIAL_FORM }),
        }),
        {
            name: 'finly:business-wizard',
            storage: createJSONStorage(() => sessionStorage),
            // Sprint 7 §SP-6 — bump 1→2 при breaking change `currentStep`
            //   (`1|2|3|4` → named literals).
            // Sprint 9 §9.2 — bump 2→3: `requisites`-wrapper видалено
            //   (taxId flatten на top-level), `invoiceSlugPresetDefault` drop
            //   (переїхав на Account). `migrate` переносить v2→v3 поля.
            version: 3,
            migrate: migratePersistedState,
            // **Persist лише data-частину**, не actions. Без цього default-
            // merge переписав би actions значеннями, що повернула migrate-
            // функція — для actions це означало б destruction (functions не
            // serializable у JSON; на rehydrate-phase вони стали б undefined
            // / no-op stubs). Persist `partialize` фіксує contract: на disk-у
            // лежить рівно `{currentStep, formData}`, actions завжди з
            // create()-callback-у.
            partialize: (state): PersistedWizardState => ({
                currentStep: state.currentStep,
                formData: state.formData,
            }),
        }
    )
);

/**
 * Sprint 7 §7.7 — final-submit mapping draft → `CreateBusinessRequest` (one of
 * 4 discriminated variants). Викликається у submit-handler-і wizard-а перед
 * POST. Кидає `Error` для невалідного draft-у — wizard-step-ам слід попередньо
 * перевіряти required fields, тож throw тут — bug-trap, не recovery-path.
 *
 * **Чому окремий маппер, а не inline-cast**: TS не виведе discriminated
 * variant з flat draft-у автоматично; concentrating dispatch-логіки в одному
 * місці робить додавання нового `BusinessType` (через розширення enum-у)
 * point-edit, не shotgun-змін у компонентах.
 */
export function buildCreateRequestFromDraft(
    draft: BusinessWizardDraft
): CreateBusinessRequest {
    const {
        type,
        name,
        taxId,
        paymentPurposeTemplate,
        acceptedBanks,
        taxationSystem,
        isVatPayer,
    } = draft;
    if (!type || !name || !taxId) {
        throw new Error('Wizard draft incomplete: required fields missing');
    }
    if (!paymentPurposeTemplate || !acceptedBanks?.length) {
        throw new Error('Wizard draft incomplete: purpose / banks missing');
    }
    const baseFields = {
        name,
        taxId,
        paymentPurposeTemplate,
        acceptedBanks,
    };
    switch (type) {
        case 'individual':
            return { type, ...baseFields };
        case 'organization':
            return { type, ...baseFields };
        case 'fop':
        case 'tov':
            if (taxationSystem === undefined || isVatPayer === undefined) {
                throw new Error(
                    'Wizard draft incomplete: taxation fields missing for ' +
                        type
                );
            }
            return {
                type,
                ...baseFields,
                taxationSystem,
                isVatPayer,
            };
    }
}
