'use client';

import { useState } from 'react';
import { AxiosError } from 'axios';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import {
    BANK_LABEL,
    CreateBusinessSchema,
    MVP_BANKS,
    businessPaymentPurposeTemplateSchema,
    type BankCode,
} from '@finly/types';
import { z } from 'zod';
import { createBusiness, getApiMessage } from '@/shared/api';
import UiTextarea from '@/shared/ui/UiTextarea';
import UiCheckbox from '@/shared/ui/UiCheckbox';
import UiButton from '@/shared/ui/UiButton';
import UiSpinner from '@/shared/ui/UiSpinner';
import { useBusinessWizardStore } from './businessWizardStore';

const PurposeSchema = businessPaymentPurposeTemplateSchema;
const PurposeWrap = z.object({ paymentPurposeTemplate: PurposeSchema });

export default function Step4PurposeBanks() {
    const router = useRouter();
    const formData = useBusinessWizardStore((s) => s.formData);
    const patch = useBusinessWizardStore((s) => s.patchFormData);
    const setStep = useBusinessWizardStore((s) => s.setStep);
    const reset = useBusinessWizardStore((s) => s.reset);

    const [purpose, setPurpose] = useState<string>(
        formData.paymentPurposeTemplate ?? '',
    );
    const [purposeError, setPurposeError] = useState<string | undefined>();
    const [acceptedBanks, setAcceptedBanks] = useState<BankCode[]>(
        formData.acceptedBanks ?? [...MVP_BANKS],
    );
    const [submitting, setSubmitting] = useState(false);

    const purposeParse = PurposeWrap.safeParse({
        paymentPurposeTemplate: purpose,
    });
    const purposeValid = purposeParse.success;
    const banksValid = acceptedBanks.length >= 1;
    const canSubmit = purposeValid && banksValid;

    const toggleBank = (bank: BankCode, checked: boolean) => {
        setAcceptedBanks((prev) =>
            checked
                ? prev.includes(bank)
                    ? prev
                    : [...prev, bank]
                : prev.filter((b) => b !== bank),
        );
    };

    const onPurposeBlur = () => {
        if (!purposeParse.success) {
            setPurposeError(purposeParse.error.issues[0]?.message);
        } else {
            setPurposeError(undefined);
        }
    };

    const onSubmit = async () => {
        if (!canSubmit) return;

        // Sprint 3 §3.7 — фінальна валідація через `CreateBusinessSchema`
        // перед submit. Захист від stale sessionStorage / drift у store
        // (наприклад, persist-блок на step 1 устарів, формат полів змінився
        // між версіями). Без safeParse тут TypeScript-cast `as` приховав
        // би неповний DTO, і API повернув би 400 з generic VALIDATION_ERROR
        // без вказання, який саме крок треба переробити.
        const draft = {
            ...formData,
            paymentPurposeTemplate: purpose,
            acceptedBanks,
        };
        const parsed = CreateBusinessSchema.safeParse(draft);
        if (!parsed.success) {
            // Дані з попередніх кроків неконсистентні. Reset wizard на step 1
            // щоб ФОП пройшов flow заново (forms підхоплять відсутні поля).
            toast.error(
                'Дані форми застаріли. Будь ласка, заповніть кроки заново.',
            );
            setStep(1);
            return;
        }

        setSubmitting(true);
        patch({ paymentPurposeTemplate: purpose, acceptedBanks });
        try {
            const created = await createBusiness(parsed.data);
            reset();
            router.replace(`/business/${created.slug}`);
        } catch (err) {
            const code =
                err instanceof AxiosError
                    ? (err.response?.data as
                          | { error?: { code?: string } }
                          | undefined)?.error?.code
                    : undefined;
            toast.error(getApiMessage(code ?? 'unknown', 'businesses'));
            setSubmitting(false);
        }
    };

    return (
        <div className="space-y-6">
            <UiTextarea
                label="Призначення платежу за замовчуванням"
                placeholder="Оплата за послуги"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                onBlur={onPurposeBlur}
                error={purposeError}
                autoGrow
                maxRows={4}
            />

            <div className="space-y-3">
                <div>
                    <p className="text-foreground text-sm font-medium">
                        Банки, з яких приймати оплати
                    </p>
                    <p className="text-muted-foreground text-xs">
                        Оберіть мінімум один. Дефолт — усі 11 увімкнені.
                    </p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {MVP_BANKS.map((bank) => (
                        <label
                            key={bank}
                            htmlFor={`bank-${bank}`}
                            className="border-border hover:bg-accent flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2"
                        >
                            <UiCheckbox
                                id={`bank-${bank}`}
                                checked={acceptedBanks.includes(bank)}
                                onChange={(checked) =>
                                    toggleBank(bank, checked)
                                }
                            />
                            <span className="text-foreground text-sm">
                                {BANK_LABEL[bank]}
                            </span>
                        </label>
                    ))}
                </div>
                {!banksValid && (
                    <p className="text-destructive text-xs">
                        Оберіть мінімум один банк
                    </p>
                )}
            </div>

            <div className="flex justify-between">
                <UiButton
                    type="button"
                    variant="outline"
                    size="md"
                    disabled={submitting}
                    onClick={() => setStep(3)}
                >
                    Назад
                </UiButton>
                <UiButton
                    type="button"
                    variant="filled"
                    size="md"
                    disabled={!canSubmit || submitting}
                    onClick={onSubmit}
                    className="relative"
                >
                    <span className={submitting ? 'invisible' : ''}>
                        Створити
                    </span>
                    {submitting && (
                        <UiSpinner
                            size="sm"
                            className="absolute inset-0 m-auto"
                        />
                    )}
                </UiButton>
            </div>
        </div>
    );
}
