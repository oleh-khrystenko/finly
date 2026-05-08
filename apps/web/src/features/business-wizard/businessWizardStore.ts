import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
    BankCode,
    BusinessType,
    CreateBusinessRequest,
    SlugPreset,
    TaxationSystem,
} from '@finly/types';
import { MVP_BANKS } from '@finly/types';

export type WizardStep = 1 | 2 | 3 | 4;

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
    currentStep: WizardStep;
    formData: BusinessWizardDraft;
    setStep: (step: WizardStep) => void;
    patchFormData: (patch: BusinessWizardDraft) => void;
    reset: () => void;
}

const INITIAL_FORM: BusinessWizardDraft = {
    type: 'fop',
    isVatPayer: false,
    // Дефолт усі 11 банків увімкнені (Sprint 3 рішення B6).
    acceptedBanks: [...MVP_BANKS],
};

export const useBusinessWizardStore = create<BusinessWizardState>()(
    persist(
        (set) => ({
            currentStep: 1,
            formData: INITIAL_FORM,
            setStep: (step) => set({ currentStep: step }),
            patchFormData: (patch) =>
                set((s) => ({ formData: { ...s.formData, ...patch } })),
            reset: () => set({ currentStep: 1, formData: INITIAL_FORM }),
        }),
        {
            name: 'finly:business-wizard',
            storage: createJSONStorage(() => sessionStorage),
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
