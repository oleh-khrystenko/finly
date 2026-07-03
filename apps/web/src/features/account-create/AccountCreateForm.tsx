'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { AxiosError } from 'axios';
import { toast } from 'sonner';
import {
    CreateAccountSchema,
    accountNameSchema,
    ibanZod,
    normalizeIban,
    type CreateAccountRequest,
} from '@finly/types';
import { z } from 'zod';

import { createAccount, getApiMessage } from '@/shared/api';
import { getZodFieldError } from '@/shared/lib';
import { useQrLandingDraftStore } from '@/entities/qr-landing-draft';
import UiButton from '@/shared/ui/UiButton';
import UiInput from '@/shared/ui/UiInput';

interface Props {
    businessSlug: string;
    /**
     * Sprint 10 §10.2 — pre-fill IBAN value у RHF defaultValues. Передається
     * page-rapper-ом коли активний `?from=landing`-flow (anon-claim recovery
     * після failure POST2 Account або після manual wizard-завершення на
     * recovery-path).
     */
    prefillIban?: string;
    /**
     * Sprint 10 §10.2 — landing-recovery branch активний. На success робить
     * `clearAll()` landing-store + redirect на per-account page із success-
     * toast "Бізнес і рахунок збережено". На стандартний cabinet-flow —
     * redirect із "Рахунок створено".
     */
    landingRecovery?: boolean;
}

/**
 * Sprint 9 §9.2 — single-form для створення Account під бізнесом.
 *
 * Поля:
 *  - `iban` (required) — `ibanZod`-валідація на client-side; backend reject-не
 *    duplicate `(businessId, iban)` через 409 `ACCOUNT_IBAN_DUPLICATE`.
 *  - `name` (optional) — backend auto-generate `"{BANK_LABEL[bankCode]} •{last4}"`
 *    якщо порожнє (Sprint 9 §A4 auto-default-policy). UI показує placeholder.
 *
 * **Resolver через `RHF + zod` на флат-shape**: оба поля валідуються
 * незалежно. `CreateAccountSchema` уже `.strict()` — будь-яке зайве поле
 * reject-неться, тому body shape точно матчить контракт.
 *
 * **`name`-схема з literal('')-варіантом**: empty string у `name`-input
 * означає "хочу auto-default з МФО", не "явне порожнє name". `accountNameSchema`
 * має `.min(1)`, тож сам `.optional()`-wrapper не допоможе — `''` (не `undefined`)
 * пішло б через `.min(1)` і fail-ило б `INVALID_ACCOUNT_NAME_REQUIRED` з
 * помилкою під полем, хоча порожнє поле — легітимний стан.
 *
 * Union `z.literal('').or(accountNameSchema)` дозволяє `''` як легітимний "skip-
 * варіант" з form-side; submit-handler нормалізує `''.trim() === '' → omit`
 * (line ~75) перед POST. `.optional()` додатково покриває `undefined` (RHF
 * uncontrolled).
 */
const FormSchema = z.object({
    iban: ibanZod,
    name: z.literal('').or(accountNameSchema).optional(),
});

type FormValues = z.input<typeof FormSchema>;

export default function AccountCreateForm({
    businessSlug,
    prefillIban,
    landingRecovery,
}: Props) {
    const router = useRouter();
    const [submitting, setSubmitting] = useState(false);

    const form = useForm<FormValues>({
        resolver: zodResolver(FormSchema),
        mode: 'onChange',
        defaultValues: { iban: prefillIban ?? '', name: '' },
    });
    const { register, handleSubmit, formState } = form;
    const { errors } = formState;

    // IBAN усюди показується групами по 4 з пробілами — нормалізуємо на вводі,
    // щоб скопійоване `UA21 3223 …` не падало на pattern-валідації.
    const ibanField = register('iban');

    const onSubmit = async (values: FormValues): Promise<void> => {
        const name = values.name?.trim();
        const dto: CreateAccountRequest = {
            iban: values.iban,
            // Empty input → omit `name`, щоб backend застосував auto-default.
            ...(name && name.length > 0 ? { name } : {}),
        };

        // Belt-and-suspenders: pre-submit pass через канонічний contract-схему.
        const parsed = CreateAccountSchema.safeParse(dto);
        if (!parsed.success) {
            toast.error('Перевірте правильність значень');
            return;
        }

        setSubmitting(true);
        try {
            const created = await createAccount(businessSlug, parsed.data);
            if (landingRecovery) {
                useQrLandingDraftStore.getState().clearAll();
                toast.success('Отримувача і реквізити збережено');
                router.replace(
                    `/business/${businessSlug}/account/${created.slug}`
                );
            } else {
                toast.success('Реквізити створено');
                router.replace(
                    `/business/${businessSlug}/account/${created.slug}`
                );
            }
        } catch (err) {
            const code =
                err instanceof AxiosError
                    ? ((
                          err.response?.data as
                              | { error?: { code?: string } }
                              | undefined
                      )?.error?.code ?? 'unknown')
                    : 'unknown';
            toast.error(getApiMessage(code, 'accounts'));
            setSubmitting(false);
        }
    };

    return (
        <form
            onSubmit={(e) => {
                void handleSubmit(onSubmit)(e);
            }}
            className="space-y-6"
            noValidate
        >
            <div className="border-border bg-card space-y-6 rounded-xl border p-6 md:p-8">
                <UiInput
                    label="IBAN"
                    labelSize="md"
                    placeholder="UA213223130000026007233566001"
                    description="Після створення IBAN не можна змінити."
                    inputMode="text"
                    {...ibanField}
                    onChange={(e) => {
                        e.target.value = normalizeIban(e.target.value);
                        return ibanField.onChange(e);
                    }}
                    error={getZodFieldError(errors.iban)}
                />

                <UiInput
                    label="Назва"
                    labelSize="md"
                    placeholder="За замовчуванням підтягнеться з банку"
                    description="Можна не заповнювати: назва підтягнеться з банку (наприклад, «ПриватБанк •2580»)."
                    {...register('name')}
                    error={getZodFieldError(errors.name)}
                    maxLength={60}
                />
            </div>

            <div className="flex justify-end gap-3 pt-2">
                <UiButton
                    as="link"
                    href={`/business/${businessSlug}`}
                    variant="text"
                    size="md"
                    disabled={submitting}
                >
                    Скасувати
                </UiButton>
                <UiButton
                    type="submit"
                    variant="filled"
                    size="md"
                    disabled={submitting}
                >
                    {submitting ? 'Створюю...' : 'Створити реквізити'}
                </UiButton>
            </div>
        </form>
    );
}
