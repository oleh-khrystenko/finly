'use client';

import {
    ibanZod,
    individualTaxIdZod,
    type Business,
    type BusinessRequisites,
} from '@finly/types';
import UiInput from '@/shared/ui/UiInput';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiEditableField from '@/shared/ui/UiEditableField';

interface Props {
    business: Business;
    onSave: (patch: { requisites: BusinessRequisites }) => Promise<void>;
}

export default function RequisitesSection({ business, onSave }: Props) {
    return (
        <UiSectionCard title="Реквізити">
            <div className="space-y-4">
                <UiEditableField<string>
                    label="IBAN"
                    value={business.requisites.iban}
                    renderRead={(v) => (
                        <span className="font-mono">{v}</span>
                    )}
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
                            : (r.error.issues[0]?.message ?? 'Невірний IBAN');
                    }}
                    onSave={(iban) =>
                        onSave({
                            requisites: { ...business.requisites, iban },
                        })
                    }
                />
                <UiEditableField<string>
                    label="Індивідуальний податковий номер"
                    value={business.requisites.taxId}
                    renderRead={(v) => (
                        <span className="font-mono">{v}</span>
                    )}
                    renderEdit={({ value, setValue, error }) => (
                        <UiInput
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            error={error}
                            inputMode="numeric"
                            maxLength={10}
                        />
                    )}
                    validate={(v) => {
                        const r = individualTaxIdZod.safeParse(v);
                        return r.success
                            ? null
                            : (r.error.issues[0]?.message ?? 'Невірний ІПН');
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
