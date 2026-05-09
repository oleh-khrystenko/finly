'use client';

import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ibanZod, individualTaxIdZod } from '@finly/types';
import UiInput from '@/shared/ui/UiInput';
import UiButton from '@/shared/ui/UiButton';
import { getZodFieldError } from '@/shared/lib';
import { taxIdFieldConfig } from '@/entities/business';
import { useBusinessWizardStore } from './businessWizardStore';

export default function Step2Requisites() {
    const formData = useBusinessWizardStore((s) => s.formData);
    const patch = useBusinessWizardStore((s) => s.patchFormData);
    const setStep = useBusinessWizardStore((s) => s.setStep);
    const nextStep = useBusinessWizardStore((s) => s.nextStep);

    /**
     * Defensive: якщо store потрапив у Step 'requisites' без обраного `type`
     * (наприклад, stale sessionStorage drift), редіректимо назад на Step 1
     * замість render-у з невідомим валідатором. Це той самий sanity-fail-safe
     * patern, що Step3Taxation робить через `requiresTaxation` (§7.7
     * sprint-плану).
     */
    useEffect(() => {
        if (!formData.type) {
            setStep('type-name');
        }
    }, [formData.type, setStep]);

    const type = formData.type;
    // Sprint 7 §SP-4 — type-aware UI-config через shared helper. Той самий
    // мапінг використовує `RequisitesSection` у cabinet edit; зміна label-копії
    // у одному місці — propagates в обох UI-точках.
    //
    // Fallback на `individualTaxIdZod` — щоб TS звузив `Schema` до конкретного
    // ZodObject-shape з `taxId: ZodType<string>` (без union з generic ZodString).
    // Runtime-фолбек ніколи не triggers, бо при `!type` early-return нижче
    // skip-ить render до redirect-у `useEffect` вище. RHF / `useForm` потребують
    // **stable Schema** на кожен render (хук-порядок), тому неможливо
    // повертати null зі store-config.
    const config = type ? taxIdFieldConfig(type) : null;
    const taxIdValidator = config?.validator ?? individualTaxIdZod;

    const Schema = useMemo(
        () =>
            z.object({
                iban: ibanZod,
                taxId: taxIdValidator,
            }),
        [taxIdValidator]
    );
    type Values = z.input<typeof Schema>;

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
        // `nextStep` обчислює steps[] з поточного `formData.type` —
        // skip `'taxation'` для individual/organization автоматично.
        nextStep();
    };

    if (!type || !config) return null; // Effect вище redirect-ить, render skip під час transition.

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
                error={getZodFieldError(errors.iban)}
            />
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
