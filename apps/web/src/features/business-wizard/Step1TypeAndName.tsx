'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
    BUSINESS_TYPES,
    BUSINESS_TYPE_LABEL,
    businessNameSchema,
    type BusinessType,
} from '@finly/types';
import UiInput from '@/shared/ui/UiInput';
import UiButton from '@/shared/ui/UiButton';
import UiRadioCardGroup, {
    type UiRadioCardGroupOption,
} from '@/shared/ui/UiRadioCardGroup';
import { getZodFieldError } from '@/shared/lib';
import { useBusinessWizardStore } from './businessWizardStore';

const NameSchema = z.object({ name: businessNameSchema });
type NameValues = z.input<typeof NameSchema>;

const TYPE_DESCRIPTIONS: Record<BusinessType, string> = {
    individual: 'Збори, донати, особисті повернення',
    fop: 'Послуги, гонорари, рахунки клієнтам',
    tov: 'Товари, послуги, контракти з компаніями',
    organization: 'Внески, пожертви, цільові збори',
};

const NAME_LABELS: Record<BusinessType, string> = {
    individual: "Повне ім'я",
    fop: "Повне ім'я",
    tov: 'Назва компанії',
    organization: 'Назва організації',
};

const NAME_HELPERS: Record<BusinessType, string> = {
    individual: '«Фізособа» додасться автоматично',
    fop: '«ФОП» додасться автоматично',
    tov: '«ТОВ» додасться автоматично',
    organization: '«Неприбуткова організація» додасться автоматично',
};

const NAME_PLACEHOLDERS: Record<BusinessType, string> = {
    individual: 'Коваленко Іван Миколайович',
    fop: 'Шевченко Марія Іванівна',
    tov: '«Ваша компанія»',
    organization: '«Ваша організація»',
};

const TYPE_OPTIONS: ReadonlyArray<UiRadioCardGroupOption<BusinessType>> =
    BUSINESS_TYPES.map((type) => ({
        value: type,
        title: BUSINESS_TYPE_LABEL[type],
        description: TYPE_DESCRIPTIONS[type],
    }));

export default function Step1TypeAndName() {
    const formData = useBusinessWizardStore((s) => s.formData);
    const setType = useBusinessWizardStore((s) => s.setType);
    const patch = useBusinessWizardStore((s) => s.patchFormData);
    const nextStep = useBusinessWizardStore((s) => s.nextStep);

    /**
     * `selectedType` — локальний controlled-state. Sync з store через
     * `setType`, що **атомарно скидає taxation-fields** при переході fop/tov →
     * individual/organization (Sprint 7 §SP-6 setType semantics).
     *
     * Чому не зчитуємо напряму з `formData.type`: store-update викликає
     * re-render усього wizard-form-а, що при frequent toggle-у дав би helter-
     * skelter UX. Локальний state ізолює радіо-flips від downstream-форм
     * (Step3Taxation захоплює `taxationSystem` з store через own snapshot).
     */
    const [selectedType, setSelectedType] = useState<BusinessType | undefined>(
        formData.type
    );

    const form = useForm<NameValues>({
        resolver: zodResolver(NameSchema),
        mode: 'onChange',
        defaultValues: { name: formData.name ?? '' },
    });
    const { errors, isValid: isNameValid } = form.formState;

    const handleSelectType = (type: BusinessType) => {
        setSelectedType(type);
        setType(type);
    };

    const onSubmit = (data: NameValues) => {
        if (!selectedType) return;
        patch({ name: data.name });
        nextStep();
    };

    const canProceed = isNameValid && selectedType !== undefined;

    return (
        <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-6"
            noValidate
        >
            <UiRadioCardGroup<BusinessType>
                label="Тип одержувача"
                options={TYPE_OPTIONS}
                value={selectedType}
                onChange={handleSelectType}
                columns={{ mobile: 2, desktop: 4 }}
            />

            <UiInput
                label={NAME_LABELS[selectedType ?? 'individual']}
                placeholder={NAME_PLACEHOLDERS[selectedType ?? 'individual']}
                description={NAME_HELPERS[selectedType ?? 'individual']}
                {...form.register('name')}
                error={getZodFieldError(errors.name)}
            />

            <div className="flex justify-end">
                <UiButton
                    type="submit"
                    variant="filled"
                    size="md"
                    disabled={!canProceed}
                >
                    Далі
                </UiButton>
            </div>
        </form>
    );
}
