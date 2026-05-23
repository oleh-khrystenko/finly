'use client';

import {
    businessPaymentPurposeTemplateSchema,
    type Business,
} from '@finly/types';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiTextarea from '@/shared/ui/UiTextarea';
import UiEditableField from '@/shared/ui/UiEditableField';
import { paymentPurposeTemplateFieldConfig } from '@/entities/business';
import { mapValidationCode } from '@/shared/lib';

interface Props {
    business: Business;
    onSave: (patch: { paymentPurposeTemplate: string }) => Promise<void>;
}

export default function PurposeSection({ business, onSave }: Props) {
    const purposeFieldConfig = paymentPurposeTemplateFieldConfig(business.type);

    return (
        <UiSectionCard title="Призначення">
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
                    const r =
                        businessPaymentPurposeTemplateSchema.safeParse(v);
                    return r.success
                        ? null
                        : (mapValidationCode(r.error.issues[0]?.message) ??
                              null);
                }}
                onSave={(paymentPurposeTemplate) =>
                    onSave({ paymentPurposeTemplate })
                }
            />
        </UiSectionCard>
    );
}
