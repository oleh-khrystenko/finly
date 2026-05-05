'use client';

import { type Invoice } from '@finly/types';
import UiInput from '@/shared/ui/UiInput';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSelect from '@/shared/ui/UiSelect';
import UiEditableField from '@/shared/ui/UiEditableField';
import { getInvoiceStatus } from '@/features/invoices/formatKopecks';

interface Props {
    invoice: Invoice;
    onSave: (
        patch: Partial<Pick<Invoice, 'validUntil'>>,
    ) => Promise<void>;
}

const DATE_LOCALE = 'uk-UA';

/**
 * Sprint 4 §4.6 — секція "Термін дії".
 *
 * **Modes:** "без терміну" → `null`. "До конкретної дати" → date-picker;
 * фіксуємо `23:59:59` локального українського часу (Sprint 4 SP-7).
 *
 * **Status banner у read-mode** — якщо `validUntil < now`, показуємо
 * "Прострочено" badge. Узгоджено з §4.7 public-сторінкою (`InvoicePublicView`
 * sanity-block).
 */
export default function ValidUntilSection({ invoice, onSave }: Props) {
    const status = getInvoiceStatus(invoice.validUntil);
    return (
        <UiSectionCard
            title="Термін дії"
            headerRight={
                status === 'expired' ? (
                    <span className="bg-destructive/10 text-destructive shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium">
                        Прострочено
                    </span>
                ) : undefined
            }
        >
            <UiEditableField<Date | null>
                label="До якої дати рахунок дійсний"
                value={invoice.validUntil}
                renderRead={(v) =>
                    v === null
                        ? 'Без терміну'
                        : new Date(v).toLocaleDateString(DATE_LOCALE)
                }
                renderEdit={({ value, setValue }) => {
                    const dateStr =
                        value instanceof Date && !Number.isNaN(value.getTime())
                            ? toIsoDate(value)
                            : '';
                    return (
                        <div className="space-y-3">
                            <UiSelect
                                options={[
                                    { value: 'none', label: 'Без терміну' },
                                    {
                                        value: 'date',
                                        label: 'До конкретної дати',
                                    },
                                ]}
                                value={value === null ? 'none' : 'date'}
                                onChange={(mode) => {
                                    if (mode === 'none') {
                                        setValue(null);
                                    } else if (value === null) {
                                        // Default — завтра 23:59:59 локально.
                                        const tomorrow = new Date();
                                        tomorrow.setDate(
                                            tomorrow.getDate() + 1,
                                        );
                                        tomorrow.setHours(23, 59, 59, 0);
                                        setValue(tomorrow);
                                    }
                                }}
                            />
                            {value !== null && (
                                <UiInput
                                    type="date"
                                    value={dateStr}
                                    onChange={(e) => {
                                        if (e.target.value === '') {
                                            setValue(null);
                                            return;
                                        }
                                        // SP-7 — фіксуємо 23:59:59 локально.
                                        const next = new Date(
                                            `${e.target.value}T23:59:59`,
                                        );
                                        setValue(next);
                                    }}
                                />
                            )}
                        </div>
                    );
                }}
                onSave={(validUntil) => onSave({ validUntil })}
            />
        </UiSectionCard>
    );
}

function toIsoDate(d: Date): string {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}
