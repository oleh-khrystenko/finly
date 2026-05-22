'use client';

import { useEffect, useMemo, useState } from 'react';
import {
    TAXATION_SYSTEMS,
    TAXATION_SYSTEM_LABEL,
    isTaxationAllowedForType,
    requiresTaxation,
    type TaxationSystem,
} from '@finly/types';
import {
    VAT_CHOICE_SECTION_LABEL,
    getVatChoiceOptions,
    isVatChoiceApplicable,
    vatBoolToChoice,
    vatChoiceToBool,
    type VatChoice,
} from '@/entities/business';
import UiSelect from '@/shared/ui/UiSelect';
import UiButton from '@/shared/ui/UiButton';
import UiRadioCardGroup from '@/shared/ui/UiRadioCardGroup';
import { useBusinessWizardStore } from './businessWizardStore';

export default function Step3Taxation() {
    const formData = useBusinessWizardStore((s) => s.formData);
    const patch = useBusinessWizardStore((s) => s.patchFormData);
    const setStep = useBusinessWizardStore((s) => s.setStep);
    const nextStep = useBusinessWizardStore((s) => s.nextStep);

    /**
     * Sprint 7 §SP-7 sanity-fail-safe: для individual / organization цей крок
     * не входить у `computeStepsForType`, тож `nextStep` з Step 'requisites'
     * перестрибує одразу на 'purpose-banks'. Якщо store потрапив сюди обхідним
     * шляхом (stale sessionStorage, прямий URL, devtools setStep) — редіректимо
     * на наступний логічний крок замість render-у форми, що згенерує garbage
     * taxation-data для не-taxation типу. План §7.7 явно фіксує це як
     * "defensive: not the expected path".
     */
    useEffect(() => {
        if (formData.type && !requiresTaxation(formData.type)) {
            setStep('purpose-banks');
        }
    }, [formData.type, setStep]);

    const [taxationSystem, setTaxationSystem] = useState<
        TaxationSystem | undefined
    >(formData.taxationSystem);
    /**
     * VAT-вибір — `undefined` поки користувач явно не клацнув одну з radio-cards.
     * Default `false` ховав би відсутність рішення під pre-selected карткою
     * "без ПДВ" — frictionless UI, але дезінформація: бекенд би отримав
     * `isVatPayer: false` як ніби-юзер обрав, а реально просто не торкнувся.
     * `canProceed` примусово вимагає explicit-choice для VAT-required систем.
     */
    const [vatChoice, setVatChoice] = useState<VatChoice | undefined>(
        formData.isVatPayer === undefined
            ? undefined
            : vatBoolToChoice(formData.isVatPayer)
    );

    const selectOptions = useMemo(
        () =>
            TAXATION_SYSTEMS.filter((system) =>
                formData.type
                    ? isTaxationAllowedForType(formData.type, system)
                    : true
            ).map((value) => ({
                value,
                label: TAXATION_SYSTEM_LABEL[value],
            })),
        [formData.type]
    );

    const vatApplicable = isVatChoiceApplicable(taxationSystem);
    const vatOptions = useMemo(
        () => (vatApplicable ? getVatChoiceOptions(taxationSystem) : null),
        [vatApplicable, taxationSystem]
    );

    const handleTaxationChange = (next: string) => {
        const ts = next as TaxationSystem;
        setTaxationSystem(ts);
        // На Спрощеній-1/2 ПДВ юридично заборонений (ст. 293.3 ПКУ) — radio-
        // card-секція не рендериться, а stale-вибір з попередньої системи
        // (наприклад, user був на Спрощеній-3 з 'yes' → перейшов на -1)
        // треба обнулити, інакше submit понесе invalid pair.
        if (!isVatChoiceApplicable(ts)) {
            setVatChoice(undefined);
        }
    };

    const canProceed =
        taxationSystem !== undefined && (!vatApplicable || vatChoice !== undefined);

    const handleNext = () => {
        if (!taxationSystem) return;
        const isVatPayer = vatApplicable
            ? vatChoiceToBool(vatChoice as VatChoice)
            : false;
        patch({ taxationSystem, isVatPayer });
        nextStep();
    };

    return (
        <div className="space-y-5">
            <UiSelect
                label="Система оподаткування"
                placeholder="Оберіть систему"
                options={selectOptions}
                value={taxationSystem ?? ''}
                onChange={handleTaxationChange}
            />

            {vatApplicable && vatOptions && (
                <UiRadioCardGroup<VatChoice>
                    label={VAT_CHOICE_SECTION_LABEL[taxationSystem]}
                    options={vatOptions}
                    value={vatChoice}
                    onChange={setVatChoice}
                    columns={{ mobile: 1, desktop: 2 }}
                />
            )}

            <div className="flex justify-between">
                <UiButton
                    type="button"
                    variant="outline"
                    size="md"
                    onClick={() => setStep('requisites')}
                >
                    Назад
                </UiButton>
                <UiButton
                    type="button"
                    variant="filled"
                    size="md"
                    disabled={!canProceed}
                    onClick={handleNext}
                >
                    Далі
                </UiButton>
            </div>
        </div>
    );
}
