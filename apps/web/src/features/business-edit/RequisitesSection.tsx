'use client';

import { ibanZod, type Business, type BusinessRequisites } from '@finly/types';
import UiInput from '@/shared/ui/UiInput';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiEditableField from '@/shared/ui/UiEditableField';
import { mapValidationCode } from '@/shared/lib';
import { taxIdFieldConfig } from '@/entities/business';

interface Props {
    business: Business;
    onSave: (patch: { requisites: BusinessRequisites }) => Promise<void>;
}

/**
 * Sprint 3 §3.8 + Sprint 7 §SP-4 — реквізити з type-aware "Кодом одержувача".
 *
 * IBAN — універсальний (всі 4 типи). `taxId` — РНОКПП (10 цифр + checksum)
 * для individual / fop, ЄДРПОУ (8 цифр без checksum) для tov / organization.
 * Label / placeholder / maxLength / validator — з shared helper-у
 * `taxIdFieldConfig`, що використовується також у wizard `Step2Requisites`.
 *
 * **Single source of truth для UI-копії**: будь-яка зміна label-у "РНОКПП" /
 * "ЄДРПОУ" чи placeholder-а робиться у `entities/business/taxIdField.ts`,
 * propagates у wizard і cabinet-edit одразу.
 */
export default function RequisitesSection({ business, onSave }: Props) {
    const taxIdConfig = taxIdFieldConfig(business.type);
    return (
        <UiSectionCard title="Реквізити">
            <div className="space-y-4">
                <UiEditableField<string>
                    label="IBAN"
                    value={business.requisites.iban}
                    renderRead={(v) => <span className="font-mono">{v}</span>}
                    renderEdit={({ value, setValue, error }) => (
                        <UiInput
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            error={error}
                            inputMode="text"
                        />
                    )}
                    validate={(v) => {
                        const r = ibanZod.safeParse(v);
                        return r.success
                            ? null
                            : (mapValidationCode(r.error.issues[0]?.message) ??
                                  null);
                    }}
                    onSave={(iban) =>
                        onSave({
                            requisites: { ...business.requisites, iban },
                        })
                    }
                />
                <UiEditableField<string>
                    label={taxIdConfig.label}
                    value={business.requisites.taxId}
                    renderRead={(v) => <span className="font-mono">{v}</span>}
                    renderEdit={({ value, setValue, error }) => (
                        <UiInput
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            error={error}
                            inputMode="numeric"
                            maxLength={taxIdConfig.maxLength}
                            placeholder={taxIdConfig.placeholder}
                        />
                    )}
                    validate={(v) => {
                        const r = taxIdConfig.validator.safeParse(v);
                        return r.success
                            ? null
                            : (mapValidationCode(r.error.issues[0]?.message) ??
                                  null);
                    }}
                    onSave={(taxId) =>
                        onSave({
                            requisites: { ...business.requisites, taxId },
                        })
                    }
                />
            </div>
        </UiSectionCard>
    );
}
