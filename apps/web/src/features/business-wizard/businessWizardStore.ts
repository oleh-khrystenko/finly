import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { CreateBusinessRequest } from '@finly/types';
import { MVP_BANKS } from '@finly/types';

export type WizardStep = 1 | 2 | 3 | 4;

/**
 * Sprint 3 §3.7 wizard state. Persist у sessionStorage — щоб випадковий
 * reload не втратив прогрес ФОП. На submit success / cancel — reset.
 *
 * `formData` — `Partial<CreateBusinessRequest>` (всі поля optional до моменту
 * submit-у). Кожен step валідує власну підмножину через RHF + Zod-resolver
 * на entity-схемах (single source of truth з `@finly/types`).
 */
export interface BusinessWizardState {
    currentStep: WizardStep;
    formData: Partial<CreateBusinessRequest>;
    setStep: (step: WizardStep) => void;
    patchFormData: (patch: Partial<CreateBusinessRequest>) => void;
    reset: () => void;
}

const INITIAL_FORM: Partial<CreateBusinessRequest> = {
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
