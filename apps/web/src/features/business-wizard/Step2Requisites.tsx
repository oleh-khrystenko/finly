'use client';

import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { individualTaxIdZod } from '@finly/types';
import UiInput from '@/shared/ui/UiInput';
import UiButton from '@/shared/ui/UiButton';
import { getZodFieldError } from '@/shared/lib';
import { taxIdFieldConfig } from '@/entities/business';
import { useBusinessWizardStore } from './businessWizardStore';

/**
 * Sprint 9 §9.2 — крок "Реквізити" wizard-у. **Тільки `taxId`** (IBAN видалений
 * повністю — живе на Account після Sprint 9, створюється окремою формою
 * `/business/[slug]/account/new` пост-create бізнесу).
 *
 * Type-aware валідація `taxId` через `taxIdFieldConfig(type)` — single source
 * of truth label/placeholder/validator/maxLength, що шерить wizard з
 * cabinet-edit `RequisitesSection`.
 */
export default function Step2Requisites() {
    const formData = useBusinessWizardStore((s) => s.formData);
    const patch = useBusinessWizardStore((s) => s.patchFormData);
    const setStep = useBusinessWizardStore((s) => s.setStep);
    const nextStep = useBusinessWizardStore((s) => s.nextStep);

    /**
     * Defensive: якщо store потрапив у Step 'requisites' без обраного `type`
     * (наприклад, stale sessionStorage drift), редіректимо назад на Step 1
     * замість render-у з невідомим валідатором. Той самий patern, що
     * Step3Taxation робить через `requiresTaxation` (§7.7).
     */
    useEffect(() => {
        if (!formData.type) {
            setStep('type-name');
        }
    }, [formData.type, setStep]);

    const type = formData.type;
    // Sprint 7 §SP-4 — type-aware UI-config через shared helper. Fallback на
    // `individualTaxIdZod` — щоб TS звузив `Schema` до конкретного ZodObject-
    // shape; runtime-фолбек skip-ається early-return-ом нижче.
    const config = type ? taxIdFieldConfig(type) : null;
    const taxIdValidator = config?.validator ?? individualTaxIdZod;

    const Schema = useMemo(
        () =>
            z.object({
                taxId: taxIdValidator,
            }),
        [taxIdValidator]
    );
    type Values = z.input<typeof Schema>;

    const form = useForm<Values>({
        resolver: zodResolver(Schema),
        mode: 'onChange',
        defaultValues: {
            taxId: formData.taxId ?? '',
        },
    });
    const { errors, isValid } = form.formState;

    const onSubmit = (data: Values) => {
        patch({ taxId: data.taxId });
        // `nextStep` обчислює steps[] з поточного `formData.type` —
        // skip `'taxation'` для individual/organization автоматично.
        nextStep();
    };

    if (!type || !config) return null;

    return (
        <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-5"
            noValidate
        >
            <UiInput
                label={config.label}
                placeholder={config.placeholder}
                inputMode="numeric"
                maxLength={config.maxLength}
                {...form.register('taxId')}
                error={getZodFieldError(errors.taxId)}
            />

            <div className="flex justify-between">
                <UiButton
                    type="button"
                    variant="outline"
                    size="md"
                    onClick={() => setStep('type-name')}
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
