'use client';

import { type Invoice } from '@finly/types';
import UiInput from '@/shared/ui/UiInput';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSelect from '@/shared/ui/UiSelect';
import UiEditableField from '@/shared/ui/UiEditableField';
import { kyivEndOfDayInstant } from '@/shared/lib';
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
                                        // Default — завтра 23:59:59 у Kyiv tz.
                                        // Беремо "завтра" з точки зору самого
                                        // Києва, не браузера (інакше у tz <
                                        // UTC+2 завтра-Київ випадало б на
                                        // післязавтра-браузер і навпаки).
                                        setValue(
                                            kyivEndOfDayInstant(
                                                kyivTomorrowIsoDate(),
                                            ),
                                        );
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
                                        // SP-7 — фіксуємо 23:59:59 у Kyiv tz.
                                        setValue(
                                            kyivEndOfDayInstant(e.target.value),
                                        );
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

/**
 * `Date` → `YYYY-MM-DD` у Europe/Kyiv tz. Раніше використовувалося
 * `getFullYear`/`getMonth`/`getDate` — це browser-local значення, тож для
 * `validUntil`, створеного у Kyiv-tz (літо UTC+3), браузер у UTC+0 показав би
 * день раніше. `<input type="date">` потім edit-mode стартував би з неправильного
 * дня. Через Intl-formatter тримаємо одну і ту саму "правду" для всіх клієнтів.
 */
const KYIV_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

function toIsoDate(d: Date): string {
    // `en-CA` дає вже `YYYY-MM-DD`.
    return KYIV_DATE_FORMATTER.format(d);
}

function kyivTomorrowIsoDate(): string {
    const todayKyiv = toIsoDate(new Date());
    const [y, m, d] = todayKyiv.split('-').map(Number);
    // `Date.UTC` + +1 day; потім назад у Kyiv-формат — DST-safe бо ми не
    // міксуємо часові зони, тільки day-arithmetic у UTC.
    const tomorrowUtc = new Date(Date.UTC(y, m - 1, d + 1));
    return toIsoDate(tomorrowUtc);
}
