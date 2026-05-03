'use client';

import { useState } from 'react';
import {
    TAXATION_SYSTEMS,
    TAXATION_SYSTEM_LABEL,
    isVatAllowedTaxationSystem,
    type TaxationSystem,
} from '@finly/types';
import UiSelect from '@/shared/ui/UiSelect';
import UiSwitch from '@/shared/ui/UiSwitch';
import UiButton from '@/shared/ui/UiButton';
import { useBusinessWizardStore } from './businessWizardStore';

const SELECT_OPTIONS = TAXATION_SYSTEMS.map((value) => ({
    value,
    label: TAXATION_SYSTEM_LABEL[value],
}));

export default function Step3Taxation() {
    const formData = useBusinessWizardStore((s) => s.formData);
    const patch = useBusinessWizardStore((s) => s.patchFormData);
    const setStep = useBusinessWizardStore((s) => s.setStep);

    const [taxationSystem, setTaxationSystem] = useState<
        TaxationSystem | undefined
    >(formData.taxationSystem);
    const [isVatPayer, setIsVatPayer] = useState<boolean>(
        formData.isVatPayer ?? false,
    );

    const vatAllowed =
        taxationSystem !== undefined &&
        isVatAllowedTaxationSystem(taxationSystem);

    const handleTaxationChange = (next: string) => {
        const ts = next as TaxationSystem;
        setTaxationSystem(ts);
        // Coupled-rule (C1): при перемиканні на simplified-1/2 — automatic
        // false для VAT, щоб submitв уmовно невалідну пару.
        if (!isVatAllowedTaxationSystem(ts) && isVatPayer) {
            setIsVatPayer(false);
        }
    };

    const canProceed = taxationSystem !== undefined;

    const handleNext = () => {
        if (!taxationSystem) return;
        patch({ taxationSystem, isVatPayer });
        setStep(4);
    };

    return (
        <div className="space-y-5">
            <UiSelect
                label="Система оподаткування"
                placeholder="Оберіть систему"
                options={SELECT_OPTIONS}
                value={taxationSystem ?? ''}
                onChange={handleTaxationChange}
            />

            <div className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
                <label
                    htmlFor="wizard-vat"
                    className="flex flex-1 cursor-pointer flex-col gap-1"
                >
                    <span className="text-foreground text-sm font-medium">
                        Платник ПДВ
                    </span>
                    {!vatAllowed && (
                        <span className="text-muted-foreground text-xs">
                            ПДВ доступний для спрощеної-3 і загальної системи
                        </span>
                    )}
                </label>
                <UiSwitch
                    id="wizard-vat"
                    checked={isVatPayer && vatAllowed}
                    disabled={!vatAllowed}
                    onChange={(next) => setIsVatPayer(next)}
                />
            </div>

            <div className="flex justify-between">
                <UiButton
                    type="button"
                    variant="outline"
                    size="md"
                    onClick={() => setStep(2)}
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
