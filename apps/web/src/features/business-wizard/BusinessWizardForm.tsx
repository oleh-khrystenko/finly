'use client';

import { useEffect, useMemo } from 'react';
import {
    computeStepsForType,
    isBusinessWizardStep,
    useBusinessWizardStore,
    type BusinessWizardStep,
} from './businessWizardStore';
import StepNavigator from './StepNavigator';
import Step1TypeAndName from './Step1TypeAndName';
import Step2Requisites from './Step2Requisites';
import Step3Taxation from './Step3Taxation';
import Step4PurposeBanks from './Step4PurposeBanks';

/**
 * Sprint 3 §3.7 + Sprint 7 §SP-6 — root wizard.
 *
 * **Lifecycle persisted wizard state:**
 *   - State живе у Zustand store з sessionStorage persist — випадковий
 *     reload зберігає прогрес.
 *   - **Reset** робиться **тільки у `Step4PurposeBanks` після успішного
 *     `createBusiness()`** (через `useBusinessWizardStore.reset()`).
 *     Жодного unmount-cleanup тут навмисно: користувач, що залишив wizard
 *     і повернувся (router back, refresh), має побачити свій прогрес.
 *   - Stale-state recovery: якщо persisted `currentStep ∉ {'type-name'}`
 *     (тобто користувач був далі), але `formData.type` чи `formData.name`
 *     відсутні (наприклад, store був reset в іншому tab-і / drift версій), —
 *     ефект нижче скидає на `'type-name'`.
 *   - Implicit cleanup: browser-unload вбиває window → sessionStorage
 *     зберігається до закриття tab-а; після close — wiped автоматично.
 *
 * **Dynamic step-list (Sprint 7 §SP-6):** для individual / organization
 * wizard має 3 кроки, для fop / tov — 4. `steps` обчислюється з
 * `formData.type` через `computeStepsForType` — single source of truth для
 * StepNavigator-render-у і `nextStep` / `prevStep` навігації у store.
 */
export default function BusinessWizardForm() {
    const currentStep = useBusinessWizardStore((s) => s.currentStep);
    const setStep = useBusinessWizardStore((s) => s.setStep);
    const formData = useBusinessWizardStore((s) => s.formData);

    // Sprint 7 — stale-state recovery (3 path-и):
    //  1. Persisted `currentStep` випав з нашого enum-у (manual sessionStorage
    //     edit, ще-не-мігровані старі версії, downgrade-flow). Persist
    //     `migrate(version=2)` має це закрити, але runtime-guard захищає від
    //     misconfig migrate-flow.
    //  2. `currentStep !== 'type-name'`, але `formData.type` / `name` відсутні
    //     (drift, reset в іншому tab-і) — користувач лендінг-y у середині
    //     wizard-у з порожнім state.
    // Будь-який з цих сценаріїв → reset на `'type-name'`, не leak-аємо
    // garbage state у downstream-кроки.
    useEffect(() => {
        if (!isBusinessWizardStep(currentStep)) {
            setStep('type-name');
            return;
        }
        if (currentStep !== 'type-name' && (!formData.type || !formData.name)) {
            setStep('type-name');
        }
    }, [currentStep, formData.type, formData.name, setStep]);

    const steps = useMemo(
        () => computeStepsForType(formData.type),
        [formData.type],
    );

    return (
        <div className="space-y-6">
            <StepNavigator
                current={currentStep}
                steps={steps}
                onJumpBack={(step: BusinessWizardStep) => setStep(step)}
            />
            <div className="border-border bg-card rounded-xl border p-5 md:p-6">
                {currentStep === 'type-name' && <Step1TypeAndName />}
                {currentStep === 'requisites' && <Step2Requisites />}
                {currentStep === 'taxation' && <Step3Taxation />}
                {currentStep === 'purpose-banks' && <Step4PurposeBanks />}
            </div>
        </div>
    );
}
