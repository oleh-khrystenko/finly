'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ibanZod, individualTaxIdZod } from '@finly/types';
import UiInput from '@/shared/ui/UiInput';
import UiButton from '@/shared/ui/UiButton';
import { useBusinessWizardStore } from './businessWizardStore';

const Schema = z.object({
    iban: ibanZod,
    taxId: individualTaxIdZod,
});
type Values = z.input<typeof Schema>;

export default function Step2Requisites() {
    const formData = useBusinessWizardStore((s) => s.formData);
    const patch = useBusinessWizardStore((s) => s.patchFormData);
    const setStep = useBusinessWizardStore((s) => s.setStep);

    const form = useForm<Values>({
        resolver: zodResolver(Schema),
        mode: 'onChange',
        defaultValues: {
            iban: formData.requisites?.iban ?? '',
            taxId: formData.requisites?.taxId ?? '',
        },
    });
    const { errors, isValid } = form.formState;

    const onSubmit = (data: Values) => {
        patch({ requisites: data });
        setStep(3);
    };

    return (
        <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-5"
            noValidate
        >
            <UiInput
                label="IBAN"
                placeholder="UA213223130000026007233566001"
                inputMode="text"
                {...form.register('iban')}
                error={errors.iban?.message}
            />
            <UiInput
                label="Індивідуальний податковий номер"
                placeholder="1234567890"
                inputMode="numeric"
                maxLength={10}
                {...form.register('taxId')}
                error={errors.taxId?.message}
            />

            <div className="flex justify-between">
                <UiButton
                    type="button"
                    variant="outline"
                    size="md"
                    onClick={() => setStep(1)}
                >
                    Назад
                </UiButton>
                <UiButton
                    type="submit"
                    variant="filled"
                    size="md"
                    disabled={!isValid}
                >
                    Далі
                </UiButton>
            </div>
        </form>
    );
}
