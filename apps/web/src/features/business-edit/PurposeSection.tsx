'use client';

import {
    regularPaymentPurposeTemplateSchema,
    type Business,
} from '@finly/types';
import UiTextarea from '@/shared/ui/UiTextarea';
import UiEditableField from '@/shared/ui/UiEditableField';
import { paymentPurposeTemplateFieldConfig } from '@/entities/business';
import { mapValidationCode } from '@/shared/lib';

interface Props {
    business: Business;
    onSave: (patch: { paymentPurposeTemplate: string }) => Promise<void>;
}

/**
 * Sprint 13: «Призначення переказу» — рядок у спільній merged-картці
 * «Реквізити», без власного UiSectionCard-обгортника (раніше титул картки
 * дублював лейбл поля).
 */
export default function PurposeSection({ business, onSave }: Props) {
    const purposeFieldConfig = paymentPurposeTemplateFieldConfig(business.type);

    return (
        <UiEditableField<string>
            label={purposeFieldConfig.label}
            value={business.paymentPurposeTemplate}
            renderRead={(v) => v}
            renderEdit={({ value, setValue, error }) => (
                <UiTextarea
                    placeholder={purposeFieldConfig.placeholder}
                    description={purposeFieldConfig.description}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    error={error}
                    autoGrow
                    maxRows={4}
                />
            )}
            validate={(v) => {
                const r = regularPaymentPurposeTemplateSchema.safeParse(v);
                return r.success
                    ? null
                    : (mapValidationCode(r.error.issues[0]?.message) ?? null);
            }}
            onSave={(paymentPurposeTemplate) =>
                onSave({ paymentPurposeTemplate })
            }
        />
    );
}
