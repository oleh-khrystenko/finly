import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
    BankCode,
    BusinessType,
    CreateBusinessRequest,
    SlugPreset,
    TaxationSystem,
} from '@finly/types';
import { MVP_BANKS, requiresTaxation } from '@finly/types';

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
    value: unknown,
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
    type: BusinessType | undefined,
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
export interface BusinessWizardDraft {
    type?: BusinessType;
    name?: string;
    requisites?: { iban?: string; taxId?: string };
    taxationSystem?: TaxationSystem;
    isVatPayer?: boolean;
    paymentPurposeTemplate?: string;
    acceptedBanks?: BankCode[];
    invoiceSlugPresetDefault?: SlugPreset | null;
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
     * При зворотному переході (individual/organization → fop/tov) поля
     * лишаються `undefined` — користувач заповнить на Step 'taxation'.
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

const migratePersistedState = (
    persistedState: unknown,
    version: number,
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
        formData?: BusinessWizardDraft;
    };

    let migratedStep: BusinessWizardStep;
    if (version < 2 && typeof state.currentStep === 'number') {
        migratedStep =
            NUMERIC_STEP_TO_NAMED[state.currentStep] ?? 'type-name';
    } else if (isBusinessWizardStep(state.currentStep)) {
        migratedStep = state.currentStep;
    } else {
        migratedStep = 'type-name';
    }

    return {
        currentStep: migratedStep,
        formData: state.formData ?? INITIAL_FORM,
    };
};

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
                    if (wasTaxationType && !willBeTaxationType) {
                        return {
                            formData: {
                                ...s.formData,
                                type,
                                taxationSystem: undefined,
                                isVatPayer: undefined,
                            },
                        };
                    }
                    return {
                        formData: { ...s.formData, type },
                    };
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
            // Sprint 7 §SP-6 — bump version при breaking change у state-shape
            // (`currentStep: 1|2|3|4` → named literals). `migrate` маппить
            // старі persistanceси, чужорідні значення → fresh `'type-name'`.
            version: 2,
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
        },
    ),
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
    draft: BusinessWizardDraft,
): CreateBusinessRequest {
    const {
        type,
        name,
        requisites,
        paymentPurposeTemplate,
        acceptedBanks,
        taxationSystem,
        isVatPayer,
    } = draft;
    if (!type || !name || !requisites?.iban || !requisites.taxId) {
        throw new Error('Wizard draft incomplete: required fields missing');
    }
    if (!paymentPurposeTemplate || !acceptedBanks?.length) {
        throw new Error('Wizard draft incomplete: purpose / banks missing');
    }
    const baseFields = {
        name,
        requisites: { iban: requisites.iban, taxId: requisites.taxId },
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
                        type,
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
