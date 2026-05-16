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

/**
 * Sprint 7 §SP-1 / §SP-6 — under-label one-liner для кожного типу.
 *
 * Кожен опис максимально стислий і **дискримінує тип з сусідніх кейсів**, які
 * легко переплутати: ТОВ vs Організація обидва — юр.особи з ЄДРПОУ, але
 * перший — комерційний, другий — неприбутковий. ОСББ-кейс маркером "ОСББ /
 * фонд / громадська" знімає UX-плутанину PUB-6 (Sprint 7 README §Risks #3).
 *
 * Single-source-of-truth для wizard-у; cabinet `BasicSection` Sprint 7 §7.8
 * читає лише top-label `BUSINESS_TYPE_LABEL[type]`, без описів.
 */
const TYPE_DESCRIPTIONS: Record<BusinessType, string> = {
    individual: 'Фізособа: збори, подарунки, особисті оплати',
    fop: 'ФОП: підприємницька діяльність, РНОКПП',
    tov: 'ТОВ, ПрАТ: комерційна юр.особа з ЄДРПОУ',
    organization: 'ОСББ, фонд, громадська спілка — без оподаткування',
};

const NAME_PLACEHOLDERS: Record<BusinessType, string> = {
    individual: 'Коваленко Іван Миколайович',
    fop: 'Коваленко Іван Миколайович',
    tov: 'ТОВ «Ромашка»',
    organization: 'ОСББ «Будинок 12»',
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
                label="Тип платника"
                description="Оберіть юр-форму, від якої виставляєте платіжне посилання. Цей вибір впливає на формат коду одержувача та інші поля."
                options={TYPE_OPTIONS}
                value={selectedType}
                onChange={handleSelectType}
                columns={{ mobile: 2, desktop: 4 }}
            />

            <UiInput
                label="Назва бізнесу"
                placeholder={NAME_PLACEHOLDERS[selectedType ?? 'individual']}
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
