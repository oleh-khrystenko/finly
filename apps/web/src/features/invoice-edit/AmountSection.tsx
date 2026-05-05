'use client';

import { type Invoice } from '@finly/types';
import UiInput from '@/shared/ui/UiInput';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSwitch from '@/shared/ui/UiSwitch';
import UiEditableField from '@/shared/ui/UiEditableField';
import { formatKopecksAsHryvnia } from '@/features/invoices/formatKopecks';

interface Props {
    invoice: Invoice;
    onSave: (
        patch: Partial<Pick<Invoice, 'amount' | 'amountLocked'>>,
    ) => Promise<void>;
}

/**
 * Sprint 4 §4.6 — секція "Сума і блокування".
 *
 * **Inline-edit для двох полів:** amount + amountLocked. Coupled-rule
 * SP-6 enforced на UI: amount-edit-readonly якщо `amountLocked=true`
 * (inverted display). Через окрему секцію — для invoice-flow саме ці два
 * поля логічно групуються.
 */
export default function AmountSection({ invoice, onSave }: Props) {
    return (
        <UiSectionCard title="Сума і блокування">
            <div className="space-y-4">
                <UiEditableField<number | null>
                    label="Сума"
                    value={invoice.amount}
                    renderRead={(v) =>
                        formatKopecksAsHryvnia(v) ??
                        'Без суми (клієнт вводить у банку)'
                    }
                    renderEdit={({ value, setValue, error }) => (
                        <UiInput
                            type="number"
                            inputMode="decimal"
                            placeholder="1500.00 — порожнє для signage-mode"
                            value={value === null ? '' : (value / 100).toString()}
                            onChange={(e) => {
                                const raw = e.target.value;
                                if (raw === '') {
                                    setValue(null);
                                    return;
                                }
                                const parsed = Number.parseFloat(raw);
                                if (!Number.isNaN(parsed)) {
                                    setValue(Math.round(parsed * 100));
                                }
                            }}
                            error={error}
                        />
                    )}
                    onSave={(amount) => {
                        // SP-6 — auto-reset amountLocked при amount → null.
                        if (amount === null && invoice.amountLocked) {
                            return onSave({ amount, amountLocked: false });
                        }
                        return onSave({ amount });
                    }}
                />
                <label
                    htmlFor="invoice-amount-lock"
                    className={`border-border flex items-start justify-between gap-3 rounded-md border p-3 ${
                        invoice.amount === null
                            ? 'cursor-not-allowed opacity-60'
                            : 'cursor-pointer'
                    }`}
                >
                    <div className="flex flex-1 flex-col gap-1">
                        <span className="text-foreground text-sm font-medium">
                            Дозволити клієнту правити суму
                        </span>
                        <span className="text-muted-foreground text-xs">
                            {invoice.amount === null
                                ? 'Заблокувати можна лише при заданій сумі'
                                : 'Якщо вимкнено — клієнт сплатить точно зазначену суму'}
                        </span>
                    </div>
                    <UiSwitch
                        id="invoice-amount-lock"
                        checked={!invoice.amountLocked}
                        disabled={invoice.amount === null}
                        onChange={(allowEdit) => {
                            void onSave({ amountLocked: !allowEdit });
                        }}
                    />
                </label>
            </div>
        </UiSectionCard>
    );
}
