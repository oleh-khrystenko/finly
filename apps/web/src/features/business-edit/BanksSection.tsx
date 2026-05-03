'use client';

import {
    BANK_LABEL,
    MVP_BANKS,
    businessPaymentPurposeTemplateSchema,
    type BankCode,
    type Business,
} from '@finly/types';
import UiCheckbox from '@/shared/ui/UiCheckbox';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiTextarea from '@/shared/ui/UiTextarea';
import EditableField from './EditableField';

interface Props {
    business: Business;
    onSave: (
        patch:
            | { paymentPurposeTemplate: string }
            | { acceptedBanks: BankCode[] },
    ) => Promise<void>;
}

export default function BanksSection({ business, onSave }: Props) {
    return (
        <UiSectionCard title="Призначення і банки">
            <div className="space-y-4">
                <EditableField<string>
                    label="Призначення платежу"
                    value={business.paymentPurposeTemplate}
                    renderRead={(v) => v}
                    renderEdit={({ value, setValue, error }) => (
                        <UiTextarea
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
                            : (r.error.issues[0]?.message ??
                                  'Невірне значення');
                    }}
                    onSave={(paymentPurposeTemplate) =>
                        onSave({ paymentPurposeTemplate })
                    }
                />
                <EditableField<BankCode[]>
                    label="Банки, з яких приймати оплати"
                    value={business.acceptedBanks}
                    renderRead={(v) => (
                        <div className="flex flex-wrap gap-1.5">
                            {v.map((b) => (
                                <span
                                    key={b}
                                    className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs"
                                >
                                    {BANK_LABEL[b]}
                                </span>
                            ))}
                        </div>
                    )}
                    renderEdit={({ value, setValue, error }) => (
                        <div className="space-y-2">
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                {MVP_BANKS.map((bank) => (
                                    <label
                                        key={bank}
                                        htmlFor={`edit-bank-${bank}`}
                                        className="border-border hover:bg-accent flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2"
                                    >
                                        <UiCheckbox
                                            id={`edit-bank-${bank}`}
                                            checked={value.includes(bank)}
                                            onChange={(checked) => {
                                                setValue(
                                                    checked
                                                        ? value.includes(bank)
                                                            ? value
                                                            : [...value, bank]
                                                        : value.filter(
                                                              (b) => b !== bank,
                                                          ),
                                                );
                                            }}
                                        />
                                        <span className="text-foreground text-sm">
                                            {BANK_LABEL[bank]}
                                        </span>
                                    </label>
                                ))}
                            </div>
                            {error && (
                                <p className="text-destructive text-xs">
                                    {error}
                                </p>
                            )}
                        </div>
                    )}
                    validate={(v) =>
                        v.length >= 1 ? null : 'Оберіть мінімум один банк'
                    }
                    onSave={(banks) => onSave({ acceptedBanks: banks })}
                />
            </div>
        </UiSectionCard>
    );
}
