'use client';

import {
    invoicePaymentPurposeSchema,
    type Business,
    type Invoice,
} from '@finly/types';
import UiTextarea from '@/shared/ui/UiTextarea';
import UiEditableField from '@/shared/ui/UiEditableField';
import { mapValidationCode } from '@/shared/lib';

interface Props {
    invoice: Invoice;
    business: Business;
    onSave: (patch: Partial<Pick<Invoice, 'paymentPurpose'>>) => Promise<void>;
}

/**
 * Sprint 4 §4.6 — рядок "Призначення".
 *
 * **Cardless** — рядок усередині спільної `PaymentDetailsCard`; лейбл поля
 * («Текст призначення») несе смисл рядка, окремий титул-картки прибрано.
 *
 * **Inheritance UI:** якщо `paymentPurpose === null`, відображаємо italic
 * fallback з business.paymentPurposeTemplate, щоб ФОП бачив, що насправді
 * надсилається у банк (через `effectiveInvoicePurpose`-resolver на backend).
 */
export default function PurposeSection({ invoice, business, onSave }: Props) {
    return (
        <UiEditableField<string | null>
            label="Текст призначення"
            value={invoice.paymentPurpose}
            renderRead={(v) =>
                v === null ? (
                    <span className="text-muted-foreground italic">
                        Використано з налаштувань бізнесу: «
                        {business.paymentPurposeTemplate}»
                    </span>
                ) : (
                    v
                )
            }
            renderEdit={({ value, setValue, error }) => (
                <UiTextarea
                    value={value ?? ''}
                    placeholder={`Залиште порожнім — щоб використати: «${business.paymentPurposeTemplate}»`}
                    onChange={(e) => {
                        const v = e.target.value;
                        setValue(v === '' ? null : v);
                    }}
                    error={error}
                    autoGrow
                    maxRows={4}
                />
            )}
            validate={(v) => {
                if (v === null) return null;
                const r = invoicePaymentPurposeSchema.safeParse(v);
                if (r.success) return null;
                // Якщо validate повертає null — UiEditableField пропускає
                // save. Тож на Zod-fail повертаємо ОБОВ'ЯЗКОВО non-null
                // UA-рядок (raw `INVALID_*` код ніколи не доходить до
                // користувача, default Zod-помилка без `.message()` теж
                // не пропустить save через `??`-fallback).
                return (
                    mapValidationCode(r.error.issues[0]?.message) ??
                    'Перевірте правильність значення'
                );
            }}
            onSave={(paymentPurpose) => onSave({ paymentPurpose })}
        />
    );
}
