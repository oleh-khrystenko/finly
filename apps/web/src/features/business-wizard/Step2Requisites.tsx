'use client';

import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
    ibanZod,
    individualTaxIdZod,
    legalEntityTaxIdZod,
    taxIdLengthFor,
    type BusinessType,
} from '@finly/types';
import UiInput from '@/shared/ui/UiInput';
import UiButton from '@/shared/ui/UiButton';
import { getZodFieldError } from '@/shared/lib';
import { useBusinessWizardStore } from './businessWizardStore';

/**
 * Sprint 7 §7.7 / §SP-4 — type-aware UI-параметри для поля "Код одержувача".
 *
 * Норматив НБУ §IV.10.5 дозволяє рівно 2 формати — РНОКПП (10 цифр + checksum)
 * АБО ЄДРПОУ (8 цифр без checksum). UI-помилка має зватися **точно**, бо
 * `mapValidationCode` бачить різні issue-коди (`INVALID_TAX_ID` vs
 * `INVALID_LEGAL_TAX_ID`); але label / placeholder теж мусять відрізнятись —
 * "ЄДРПОУ" і "РНОКПП" мають різні юридичні значення, а універсальне "Код
 * одержувача" не дає user-у швидко зрозуміти, що ввести.
 *
 * **Discriminator-таблиця** замість `if/else` — додавання нового `BusinessType`
 * без оновлення цього мапінгу дає compile-error через `Record<BusinessType,
 * ...>` exhaustiveness (fail-fast convention).
 */
interface TaxIdFieldConfig {
    label: string;
    placeholder: string;
    validator: typeof individualTaxIdZod | typeof legalEntityTaxIdZod;
}

const TAX_ID_CONFIG: Record<BusinessType, TaxIdFieldConfig> = {
    individual: {
        label: 'РНОКПП',
        placeholder: '1234567890',
        validator: individualTaxIdZod,
    },
    fop: {
        label: 'РНОКПП',
        placeholder: '1234567890',
        validator: individualTaxIdZod,
    },
    tov: {
        label: 'ЄДРПОУ',
        placeholder: '12345678',
        validator: legalEntityTaxIdZod,
    },
    organization: {
        label: 'ЄДРПОУ',
        placeholder: '12345678',
        validator: legalEntityTaxIdZod,
    },
};

export default function Step2Requisites() {
    const formData = useBusinessWizardStore((s) => s.formData);
    const patch = useBusinessWizardStore((s) => s.patchFormData);
    const setStep = useBusinessWizardStore((s) => s.setStep);
    const nextStep = useBusinessWizardStore((s) => s.nextStep);

    /**
     * Defensive: якщо store потрапив у Step 'requisites' без обраного `type`
     * (наприклад, stale sessionStorage drift), редіректимо назад на Step 1
     * замість render-у з невідомим валідатором. Це той самий sanity-fail-safe
     * patern, що Sprint 4 використовує у Step 'taxation' (§7.7 sprint-плану).
     */
    useEffect(() => {
        if (!formData.type) {
            setStep('type-name');
        }
    }, [formData.type, setStep]);

    const type = formData.type;
    const config = type ? TAX_ID_CONFIG[type] : TAX_ID_CONFIG.fop;

    const Schema = useMemo(
        () =>
            z.object({
                iban: ibanZod,
                taxId: config.validator,
            }),
        [config.validator],
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

    if (!type) return null; // Effect вище redirect-ить, render skip під час transition.

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
                maxLength={taxIdLengthFor(type)}
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
