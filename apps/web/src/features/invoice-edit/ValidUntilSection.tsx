'use client';

import { useRef, useState } from 'react';
import { CalendarDays, Check, Pencil, X } from 'lucide-react';
import { type Invoice } from '@finly/types';
import UiButton from '@/shared/ui/UiButton';
import UiInput from '@/shared/ui/UiInput';
import UiSelect from '@/shared/ui/UiSelect';
import { isoToUaDate, kyivEndOfDayInstant, uaDateToIso } from '@/shared/lib';

interface Props {
    invoice: Invoice;
    onSave: (patch: Partial<Pick<Invoice, 'validUntil'>>) => Promise<void>;
}

const DATE_LOCALE = 'uk-UA';

type Mode = 'none' | 'date';

/**
 * Sprint 4 §4.6 — рядок "Термін дії" у картці «Дані платежу».
 *
 * **Cardless** — рядок усередині спільної `PaymentDetailsCard`. Badge
 * "Прострочено" живе у хедері merged-картки (`PaymentDetailsCard`), щоб статус
 * читався на рівні всього блоку параметрів, а не загубленого рядка.
 *
 * **Modes:** "без терміну" → `null`. "До конкретної дати" → ручний ввід у
 * `ДД.ММ.РРРР` (ФОП вписує дату руками) + кнопка календаря як зручність.
 * Фіксуємо `23:59:59` локального українського часу (Sprint 4 SP-7).
 *
 * **Власний edit-lifecycle** (не generic `UiEditableField`), бо при ручному
 * вводі дата проходить multi-stage state (raw `ДД.ММ.РРРР` ↔ parsed ISO ↔
 * format-error). Generic-field тримає лише фінальний `Date | null`, тож
 * частковий набір ("15.0") не мав би де жити, а порожній/невалідний текст
 * тихо ставав би `null` ("без терміну") — той самий клас silent data-loss,
 * що вирішив `MoneyEditableField`. Save заблокований на parse-error.
 */
export default function ValidUntilSection({ invoice, onSave }: Props) {
    const [editing, setEditing] = useState(false);
    const [mode, setMode] = useState<Mode>('none');
    // raw — текст у форматі `ДД.ММ.РРРР` (single source of truth у edit-mode).
    const [raw, setRaw] = useState('');
    const [error, setError] = useState<string | undefined>();
    const [saving, setSaving] = useState(false);
    // Прихований нативний date-input як host для системного календаря —
    // `showPicker()` відкриває його з кнопки, текст лишається editable вручну.
    const pickerRef = useRef<HTMLInputElement>(null);

    const startEdit = () => {
        if (invoice.validUntil === null) {
            setMode('none');
            setRaw('');
        } else {
            setMode('date');
            setRaw(isoToUaDate(kyivIsoDate(invoice.validUntil)));
        }
        setError(undefined);
        setEditing(true);
    };

    const cancel = () => {
        setEditing(false);
        setError(undefined);
    };

    const switchMode = (next: Mode) => {
        setMode(next);
        setError(undefined);
        if (next === 'date' && raw.trim() === '') {
            // Дефолт — завтра 23:59:59 у Kyiv tz. Беремо "завтра" з точки зору
            // самого Києва, не браузера (інакше у tz < UTC+2 завтра-Київ
            // випадало б на післязавтра-браузер і навпаки).
            setRaw(isoToUaDate(kyivTomorrowIsoDate()));
        }
    };

    const handleRawChange = (input: string) => {
        setRaw(input);
        // Live-валідація лише коли поле непорожнє: під час набору не червонимо.
        setError(
            input.trim() === '' || uaDateToIso(input) !== null
                ? undefined
                : 'Введіть дату у форматі ДД.ММ.РРРР'
        );
    };

    const handlePick = (iso: string) => {
        setRaw(isoToUaDate(iso));
        setError(undefined);
    };

    const openPicker = () => {
        const el = pickerRef.current;
        if (!el) return;
        if (typeof el.showPicker === 'function') {
            try {
                el.showPicker();
                return;
            } catch {
                // showPicker може кинути (não-user-gesture / unsupported) —
                // падаємо у focus+click як фолбек.
            }
        }
        el.focus();
        el.click();
    };

    const save = async () => {
        let validUntil: Date | null;
        if (mode === 'none') {
            validUntil = null;
        } else {
            const iso = uaDateToIso(raw);
            if (iso === null) {
                setError('Введіть дату у форматі ДД.ММ.РРРР');
                return;
            }
            // SP-7 — фіксуємо 23:59:59 у Kyiv tz.
            validUntil = kyivEndOfDayInstant(iso);
        }
        setSaving(true);
        try {
            await onSave({ validUntil });
            setEditing(false);
            setError(undefined);
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Не вдалося зберегти');
        } finally {
            setSaving(false);
        }
    };

    const saveBlocked = mode === 'date' && uaDateToIso(raw) === null;

    return (
        <div className="space-y-2">
            <p className="text-muted-foreground text-base font-medium">
                Термін дії
            </p>
            {!editing ? (
                <div className="flex items-center justify-between gap-3">
                    <div className="text-foreground min-w-0 flex-1 text-lg break-words">
                        {invoice.validUntil === null
                            ? 'Без терміну'
                            : new Date(invoice.validUntil).toLocaleDateString(
                                  DATE_LOCALE
                              )}
                    </div>
                    <UiButton
                        type="button"
                        variant="icon"
                        size="sm"
                        onClick={startEdit}
                        aria-label="Редагувати: Термін дії"
                        IconLeft={<Pencil />}
                    />
                </div>
            ) : (
                <div className="space-y-3">
                    <UiSelect
                        options={[
                            { value: 'none', label: 'Без терміну' },
                            { value: 'date', label: 'До конкретної дати' },
                        ]}
                        value={mode}
                        onChange={(next) => switchMode(next as Mode)}
                    />
                    {mode === 'date' && (
                        <div className="flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                                <UiInput
                                    value={raw}
                                    onChange={(e) =>
                                        handleRawChange(e.target.value)
                                    }
                                    placeholder="ДД.ММ.РРРР"
                                    inputMode="numeric"
                                    autoComplete="off"
                                    aria-label="Дата у форматі ДД.ММ.РРРР"
                                    error={error}
                                />
                            </div>
                            <UiButton
                                type="button"
                                variant="outline"
                                size="md"
                                onClick={openPicker}
                                aria-label="Обрати в календарі"
                                IconLeft={<CalendarDays />}
                            />
                            <UiInput
                                ref={pickerRef}
                                type="date"
                                value={uaDateToIso(raw) ?? ''}
                                onChange={(e) => handlePick(e.target.value)}
                                tabIndex={-1}
                                aria-hidden="true"
                                className="sr-only"
                            />
                        </div>
                    )}
                    <div className="flex justify-end gap-2">
                        <UiButton
                            type="button"
                            variant="text"
                            size="sm"
                            onClick={cancel}
                            disabled={saving}
                            IconLeft={<X />}
                        >
                            Скасувати
                        </UiButton>
                        <UiButton
                            type="button"
                            variant="filled"
                            size="sm"
                            onClick={() => void save()}
                            disabled={saveBlocked}
                            loading={saving}
                            IconLeft={<Check />}
                        >
                            Зберегти
                        </UiButton>
                    </div>
                </div>
            )}
        </div>
    );
}

/**
 * `Date` → `YYYY-MM-DD` у Europe/Kyiv tz. Раніше використовувалося
 * `getFullYear`/`getMonth`/`getDate` — це browser-local значення, тож для
 * `validUntil`, створеного у Kyiv-tz (літо UTC+3), браузер у UTC+0 показав би
 * день раніше. Через Intl-formatter тримаємо одну і ту саму "правду" для всіх
 * клієнтів, щоб edit-mode стартував з правильного дня.
 */
const KYIV_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

function kyivIsoDate(d: Date): string {
    // `en-CA` дає вже `YYYY-MM-DD`.
    return KYIV_DATE_FORMATTER.format(new Date(d));
}

function kyivTomorrowIsoDate(): string {
    const todayKyiv = kyivIsoDate(new Date());
    const [y, m, d] = todayKyiv.split('-').map(Number);
    // `Date.UTC` + +1 day; потім назад у Kyiv-формат — DST-safe бо ми не
    // міксуємо часові зони, тільки day-arithmetic у UTC.
    const tomorrowUtc = new Date(Date.UTC(y, m - 1, d + 1));
    return kyivIsoDate(tomorrowUtc);
}
