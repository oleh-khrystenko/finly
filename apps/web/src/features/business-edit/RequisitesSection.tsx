'use client';

import type { Business } from '@finly/types';
import UiInput from '@/shared/ui/UiInput';
import UiEditableField from '@/shared/ui/UiEditableField';
import { mapValidationCode } from '@/shared/lib';
import { taxIdFieldConfig } from '@/entities/business';

interface Props {
    business: Business;
    onSave: (patch: { taxId: string }) => Promise<void>;
}

/**
 * Sprint 3 §3.8 + Sprint 7 §SP-4 + Sprint 9 §9.2 — type-aware "Код одержувача"
 * як один рядок у спільній merged-картці «Реквізити» (Sprint 13: drop власного
 * UiSectionCard-обгортника — секція тепер єдина для taxId + taxation + purpose,
 * враппер на рівні `RequisitesCard`).
 *
 * Type-aware: РНОКПП (10 цифр + checksum) для individual / fop, ЄДРПОУ (8 цифр
 * без checksum) для tov / organization. Label / placeholder / maxLength /
 * validator — з shared helper-у `taxIdFieldConfig`, що використовується також
 * у `BusinessCreateForm` на /business/new.
 */
export default function RequisitesSection({ business, onSave }: Props) {
    const taxIdConfig = taxIdFieldConfig(business.type);
    return (
        <UiEditableField<string>
            label={taxIdConfig.label}
            value={business.taxId}
            renderRead={(v) => <span className="font-mono">{v}</span>}
            renderEdit={({ value, setValue, error }) => (
                <UiInput
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    error={error}
                    inputMode="numeric"
                    maxLength={taxIdConfig.maxLength}
                    placeholder={taxIdConfig.placeholder}
                    description={taxIdConfig.description}
                />
            )}
            validate={(v) => {
                const r = taxIdConfig.validator.safeParse(v);
                return r.success
                    ? null
                    : (mapValidationCode(r.error.issues[0]?.message) ?? null);
            }}
            onSave={(taxId) => onSave({ taxId })}
        />
    );
}
