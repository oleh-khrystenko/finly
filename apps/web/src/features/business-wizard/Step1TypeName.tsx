'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { businessNameSchema, BUSINESS_TYPE_LABEL } from '@finly/types';
import UiInput from '@/shared/ui/UiInput';
import UiButton from '@/shared/ui/UiButton';
import { useBusinessWizardStore } from './businessWizardStore';

const Schema = z.object({ name: businessNameSchema });
type Values = z.input<typeof Schema>;

export default function Step1TypeName() {
    const formData = useBusinessWizardStore((s) => s.formData);
    const patch = useBusinessWizardStore((s) => s.patchFormData);
    const setStep = useBusinessWizardStore((s) => s.setStep);

    const form = useForm<Values>({
        resolver: zodResolver(Schema),
        mode: 'onChange',
        defaultValues: { name: formData.name ?? '' },
    });
    const { errors, isValid } = form.formState;

    const onSubmit = (data: Values) => {
        patch({ name: data.name });
        setStep(2);
    };

    return (
        <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-5"
            noValidate
        >
            <div className="space-y-2">
                <label className="text-foreground text-sm font-medium">
                    Тип бізнесу
                </label>
                <div className="border-border bg-muted/30 rounded-md border px-3 py-2.5 text-sm">
                    <p className="text-foreground font-medium">
                        {BUSINESS_TYPE_LABEL.fop}
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                        Поки що підтримуємо лише цей тип; ТОВ і ВАТ — у розробці
                    </p>
                </div>
            </div>

            <UiInput
                label="Назва бізнесу"
                placeholder="Іваненко"
                {...form.register('name')}
                error={errors.name?.message}
            />

            <div className="flex justify-end">
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
