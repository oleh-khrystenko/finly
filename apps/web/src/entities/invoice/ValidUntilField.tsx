'use client';

import { useRef } from 'react';
import { CalendarDays } from 'lucide-react';
import { isoToUaDate, uaDateToIso } from '@/shared/lib';
import UiButton from '@/shared/ui/UiButton';
import UiInput from '@/shared/ui/UiInput';
import UiSelect from '@/shared/ui/UiSelect';
import {
    kyivTomorrowIsoDate,
    type ValidUntilDraft,
    type ValidUntilMode,
} from './validUntilDraft';

interface Props {
    /** Контрольований draft (mode + raw `ДД.ММ.РРРР`). */
    draft: ValidUntilDraft;
    onChange: (next: ValidUntilDraft) => void;
    /** Лейбл селекта режиму; пропусти, якщо обгортка має власний заголовок. */
    label?: string;
    labelSize?: 'sm' | 'md';
    /**
     * Зовнішня помилка (server / submit). Перекриває live-формат-помилку, щоб
     * не дублювати два повідомлення під одним полем.
     */
    error?: string;
}

const MODE_OPTIONS: { value: ValidUntilMode; label: string }[] = [
    { value: 'none', label: 'Без терміну' },
    { value: 'date', label: 'До конкретної дати' },
];

/**
 * Спільний контрольований редактор «Термін дії» — single source of truth для
 * create-форми та inline-edit. Ручний ввід `ДД.ММ.РРРР` (ФОП вписує дату
 * руками) + кнопка системного календаря (`showPicker()`) як зручність; Kyiv-tz
 * семантика інкапсульована у `validUntilDraft`-helpers.
 *
 * Live-error лише на непорожньому невалідному вводі — під час набору не
 * червонимо. Блокування submit/save за валідністю draft-у — на боці обгортки
 * (`isValidUntilDraftValid`).
 */
export default function ValidUntilField({
    draft,
    onChange,
    label,
    labelSize = 'md',
    error,
}: Props) {
    // Прихований нативний date-input як host для системного календаря —
    // `showPicker()` відкриває його з кнопки, текст лишається editable вручну.
    const pickerRef = useRef<HTMLInputElement>(null);

    const liveError =
        draft.mode === 'date' &&
        draft.raw.trim() !== '' &&
        uaDateToIso(draft.raw) === null
            ? 'Введіть дату у форматі ДД.ММ.РРРР'
            : undefined;
    const fieldError = error ?? liveError;

    const switchMode = (next: ValidUntilMode) => {
        if (next === 'date' && draft.raw.trim() === '') {
            // Дефолт — завтра 23:59:59 у Kyiv tz. «Завтра» рахуємо з точки зору
            // самого Києва, не браузера (інакше у tz < UTC+2 завтра-Київ
            // випадало б на післязавтра-браузер і навпаки).
            onChange({ mode: 'date', raw: isoToUaDate(kyivTomorrowIsoDate()) });
            return;
        }
        onChange({ ...draft, mode: next });
    };

    const openPicker = () => {
        const el = pickerRef.current;
        if (!el) return;
        if (typeof el.showPicker === 'function') {
            try {
                el.showPicker();
                return;
            } catch {
                // showPicker може кинути (не-user-gesture / unsupported) —
                // падаємо у focus+click як фолбек.
            }
        }
        el.focus();
        el.click();
    };

    return (
        <div className="space-y-3">
            <UiSelect
                label={label}
                labelSize={labelSize}
                options={MODE_OPTIONS}
                value={draft.mode}
                onChange={(next) => switchMode(next as ValidUntilMode)}
            />
            {draft.mode === 'date' && (
                <div className="space-y-1.5">
                    {/*
                     * `items-stretch` вирівнює висоту кнопки календаря до інпута:
                     * icon-only UiButton (svg 20px) сам по собі на 4px нижчий за
                     * UiInput (text-line 24px), хоч padding/border однакові.
                     * Помилку рендеримо ПІД рядком (не через `error`-проп інпута),
                     * щоб її текст не розтягував кнопку разом з flex-stretch.
                     */}
                    <div className="flex items-stretch gap-2">
                        <div className="min-w-0 flex-1">
                            <UiInput
                                value={draft.raw}
                                onChange={(e) =>
                                    onChange({ ...draft, raw: e.target.value })
                                }
                                placeholder="ДД.ММ.РРРР"
                                inputMode="numeric"
                                autoComplete="off"
                                aria-label="Дата у форматі ДД.ММ.РРРР"
                                // Червона рамка при помилці без inline-message
                                // (message — окремим рядком нижче). className
                                // композиться останнім, тож перекриває borderIdle.
                                className={
                                    fieldError
                                        ? 'border-destructive hover:border-destructive focus-within:border-destructive'
                                        : undefined
                                }
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
                            value={uaDateToIso(draft.raw) ?? ''}
                            onChange={(e) =>
                                onChange({
                                    ...draft,
                                    raw: e.target.value
                                        ? isoToUaDate(e.target.value)
                                        : '',
                                })
                            }
                            tabIndex={-1}
                            aria-hidden="true"
                            className="sr-only"
                        />
                    </div>
                    {fieldError && (
                        <p className="text-destructive text-sm" role="alert">
                            {fieldError}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
