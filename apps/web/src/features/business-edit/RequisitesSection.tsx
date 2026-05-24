'use client';

import type { Business } from '@finly/types';
import UiInput from '@/shared/ui/UiInput';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiEditableField from '@/shared/ui/UiEditableField';
import { mapValidationCode } from '@/shared/lib';
import { taxIdFieldConfig } from '@/entities/business';

interface Props {
    business: Business;
    onSave: (patch: { taxId: string }) => Promise<void>;
}

/**
 * Sprint 3 §3.8 + Sprint 7 §SP-4 + Sprint 9 §9.2 — реквізити з type-aware
 * "Кодом одержувача".
 *
 * **Sprint 9 рефакторинг:** IBAN видалено (живе на Account — окрема card на
 * business-cabinet-page через `AccountsSection`). Лишається лише `taxId` —
 * top-level field бізнесу (raніше `requisites.taxId`).
 *
 * Type-aware: РНОКПП (10 цифр + checksum) для individual / fop, ЄДРПОУ (8 цифр
 * без checksum) для tov / organization. Label / placeholder / maxLength /
 * validator — з shared helper-у `taxIdFieldConfig`, що використовується також
 * у `BusinessCreateForm` на /business/new.
 */
export default function RequisitesSection({ business, onSave }: Props) {
    const taxIdConfig = taxIdFieldConfig(business.type);
    return (
        <UiSectionCard title="Реквізити">
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
                        : (mapValidationCode(r.error.issues[0]?.message) ??
                              null);
                }}
                onSave={(taxId) => onSave({ taxId })}
            />
        </UiSectionCard>
    );
}
