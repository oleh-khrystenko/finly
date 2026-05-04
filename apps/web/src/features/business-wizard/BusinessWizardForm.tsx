'use client';

import { useEffect } from 'react';
import { useBusinessWizardStore, type WizardStep } from './businessWizardStore';
import StepNavigator from './StepNavigator';
import Step1TypeName from './Step1TypeName';
import Step2Requisites from './Step2Requisites';
import Step3Taxation from './Step3Taxation';
import Step4PurposeBanks from './Step4PurposeBanks';

/**
 * Sprint 3 §3.7 — root wizard.
 *
 * **Lifecycle persisted wizard state:**
 *   - State живе у Zustand store з sessionStorage persist — випадковий
 *     reload зберігає прогрес.
 *   - **Reset** робиться **тільки у `Step4PurposeBanks` після успішного
 *     `createBusiness()`** (через `useBusinessWizardStore.reset()`).
 *     Жодного unmount-cleanup тут навмисно: користувач, що залишив wizard
 *     і повернувся (router back, refresh), має побачити свій прогрес.
 *   - Stale-state recovery: якщо persisted `currentStep >= 2`, але
 *     `formData.name` відсутній (наприклад, store був reset в іншому tab-і),
 *     ефект нижче скидає на step 1 — інакше user landed би на Step 2 з
 *     порожніми полями реквізитів і не зрозумів би, що сталося.
 *   - Implicit cleanup: browser-unload вбиває window → sessionStorage
 *     зберігається до закриття tab-а; після close — wiped автоматично.
 */
export default function BusinessWizardForm() {
    const currentStep = useBusinessWizardStore((s) => s.currentStep);
    const setStep = useBusinessWizardStore((s) => s.setStep);

    // Якщо persisted state містить step > 1, але user-data немає (new user
    // з очищеним store) — fallback на step 1. Захист від stale persistance
    // після `reset()` в іншому tab-і.
    const formData = useBusinessWizardStore((s) => s.formData);
    useEffect(() => {
        if (currentStep >= 2 && !formData.name) {
            setStep(1);
        }
    }, [currentStep, formData.name, setStep]);

    return (
        <div className="space-y-6">
            <StepNavigator
                current={currentStep}
                maxReached={currentStep}
                onJumpBack={(s: WizardStep) => setStep(s)}
            />
            <div className="border-border bg-card rounded-xl border p-5 md:p-6">
                {currentStep === 1 && <Step1TypeName />}
                {currentStep === 2 && <Step2Requisites />}
                {currentStep === 3 && <Step3Taxation />}
                {currentStep === 4 && <Step4PurposeBanks />}
            </div>
        </div>
    );
}
