'use client';

import {
    invoicePaymentPurposeSchema,
    type Business,
    type Invoice,
} from '@finly/types';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiTextarea from '@/shared/ui/UiTextarea';
import UiEditableField from '@/shared/ui/UiEditableField';

interface Props {
    invoice: Invoice;
    business: Business;
    onSave: (
        patch: Partial<Pick<Invoice, 'paymentPurpose'>>,
    ) => Promise<void>;
}

/**
 * Sprint 4 §4.6 — секція "Призначення".
 *
 * **Inheritance UI:** якщо `paymentPurpose === null`, відображаємо italic
 * fallback з business.paymentPurposeTemplate, щоб ФОП бачив, що насправді
 * надсилається у банк (через `effectiveInvoicePurpose`-resolver на backend).
 */
export default function PurposeSection({ invoice, business, onSave }: Props) {
    return (
        <UiSectionCard title="Призначення">
            <UiEditableField<string | null>
                label="Текст призначення"
                value={invoice.paymentPurpose}
                renderRead={(v) =>
                    v === null ? (
                        <span className="text-muted-foreground italic">
                            Використано з налаштувань бізнесу:
                            «{business.paymentPurposeTemplate}»
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
                    return r.success
                        ? null
                        : (r.error.issues[0]?.message ??
                              'Невалідний текст');
                }}
                onSave={(paymentPurpose) => onSave({ paymentPurpose })}
            />
        </UiSectionCard>
    );
}
