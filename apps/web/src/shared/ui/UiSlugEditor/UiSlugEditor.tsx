'use client';

import { useEffect, useRef, useState } from 'react';
import {
    Check,
    Clock,
    Copy,
    ExternalLink,
    Pencil,
    RefreshCw,
    X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
    SLUG_AVAILABILITY_STATUS,
    type SlugAvailabilityStatus,
    type SlugReservationView,
} from '@finly/types';
import UiButton from '@/shared/ui/UiButton';
import UiPrefixInput from '@/shared/ui/UiPrefixInput';
import type { UiSlugEditorProps } from './types';

const AVAILABILITY_DEBOUNCE_MS = 350;

type Mode = 'read' | 'edit' | 'upsell';
type AvailabilityState = { status: SlugAvailabilityStatus | null; checking: boolean };

/**
 * Sprint 20 — єдиний контрол редагування vanity-slug на трьох сторінках
 * (Отримувач / Реквізити / Документ). Інвертує Sprint-19-логіку: поле і кнопка
 * редагування видимі всім рівням, бар'єр спрацьовує лише на Save.
 *
 *  - **Платний (brand+)** — Save пише slug одразу (звичайний rename).
 *  - **Free** — Save не пише ім'я, а кладе його на 15-хвилинний холд і відкриває
 *    inline-апсел: прев'ю майбутньої public-URL, зворотний відлік, один primary
 *    CTA «Підписатись» + тиха secondary «Усі тарифи». Після оплати ім'я
 *    застосовується автоматично (див. `useApplyPendingSlug`).
 *
 * Live-доступність (вільно / зайнято / недоступне) показується поки користувач
 * друкує — це гачок конверсії: цінність відчувається до оплати.
 */
export default function UiSlugEditor({
    currentSlug,
    prefix,
    publicUrl,
    ariaLabel,
    helpText,
    validate,
    isPaid,
    checkAvailability,
    reserve,
    onSave,
    onRegenerate,
    onSubscribe,
    subscribePriceLabel,
    initialReservation = null,
    autoStartEdit = false,
}: UiSlugEditorProps) {
    const [mode, setMode] = useState<Mode>(
        initialReservation ? 'upsell' : autoStartEdit ? 'edit' : 'read'
    );
    const [draft, setDraft] = useState(
        initialReservation?.desiredSlug ?? currentSlug
    );
    const [formatError, setFormatError] = useState<string | undefined>();
    const [availability, setAvailability] = useState<AvailabilityState>({
        status: null,
        checking: false,
    });
    const [saving, setSaving] = useState(false);
    const [subscribing, setSubscribing] = useState(false);
    const [reservation, setReservation] = useState<SlugReservationView | null>(
        initialReservation
    );
    const [copied, setCopied] = useState(false);

    // Lowercase-порівняння — для пропуску availability-check власного імені
    // (зміна лише регістру свого slug тривіально «вільна»).
    const isUnchanged = draft.trim().toLowerCase() === currentSlug.toLowerCase();
    // Точне порівняння — для no-op-короткозамикання Save: зміна лише регістру
    // (`ivanenko` → `IvanEnko`) — валідна платна правка (бекенд: slugCaseOnlyChange),
    // тож вона НЕ no-op і має дійти до запису.
    const isExactSame = draft === currentSlug;
    const formatValid = validate(draft) === null;

    // Live-доступність із debounce. Тільки в edit-mode, лише для валідного
    // формату і відмінного від поточного імені. Stale-guard через requestId.
    const requestIdRef = useRef(0);
    useEffect(() => {
        if (mode !== 'edit') return;
        if (!formatValid || isUnchanged) {
            setAvailability({ status: null, checking: false });
            return;
        }
        const id = ++requestIdRef.current;
        setAvailability({ status: null, checking: true });
        const handle = setTimeout(() => {
            void checkAvailability(draft)
                .then((status) => {
                    if (requestIdRef.current === id) {
                        setAvailability({ status, checking: false });
                    }
                })
                .catch(() => {
                    if (requestIdRef.current === id) {
                        setAvailability({ status: null, checking: false });
                    }
                });
        }, AVAILABILITY_DEBOUNCE_MS);
        return () => clearTimeout(handle);
    }, [draft, mode, formatValid, isUnchanged, checkAvailability]);

    // Зворотний відлік броні. На нулі — апсел тихо згортається у edit-mode,
    // ім'я повертається в доступ, повторний Save бронює знову.
    const [remainingMs, setRemainingMs] = useState(0);
    useEffect(() => {
        if (mode !== 'upsell' || !reservation) return;
        const expiresAt = new Date(reservation.expiresAt).getTime();
        const tick = () => {
            const left = expiresAt - Date.now();
            if (left <= 0) {
                setReservation(null);
                setDraft(reservation.desiredSlug);
                setMode('edit');
                return;
            }
            setRemainingMs(left);
        };
        tick();
        const interval = setInterval(tick, 1000);
        return () => clearInterval(interval);
    }, [mode, reservation]);

    // Sprint 20 — поач-фолбек: батько вмикає `autoStartEdit` уже ПІСЛЯ mount
    // (добивання наміру впало на SLUG_TAKEN, ім'я перехопили). useState-
    // ініціалізатор читає проп лише на першому рендері, тож реагуємо ефектом —
    // відкриваємо поле з поточним іменем. Ref-guard, щоб не перебивати ручний
    // Cancel наступними рендерами з тим самим `autoStartEdit=true`.
    const autoEditAppliedRef = useRef(false);
    useEffect(() => {
        if (autoStartEdit && !autoEditAppliedRef.current) {
            autoEditAppliedRef.current = true;
            setDraft(currentSlug);
            setFormatError(undefined);
            setAvailability({ status: null, checking: false });
            setMode('edit');
        }
    }, [autoStartEdit, currentSlug]);

    const startEdit = () => {
        setDraft(currentSlug);
        setFormatError(undefined);
        setAvailability({ status: null, checking: false });
        setMode('edit');
    };

    const cancelEdit = () => {
        setFormatError(undefined);
        setMode(reservation ? 'upsell' : 'read');
    };

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(publicUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            toast.error('Не вдалося скопіювати');
        }
    };

    const handleSave = async () => {
        const err = validate(draft);
        if (err) {
            setFormatError(err);
            return;
        }
        setFormatError(undefined);
        if (isExactSame) {
            setMode('read');
            return;
        }
        // Свіжа перевірка перед дією (live-статус міг бути ще не дорахований).
        const status = await checkAvailability(draft);
        setAvailability({ status, checking: false });
        if (status !== SLUG_AVAILABILITY_STATUS.AVAILABLE) return;

        if (isPaid) {
            setSaving(true);
            try {
                await onSave(draft);
                setMode('read');
            } catch (e) {
                setFormatError(
                    e instanceof Error ? e.message : 'Не вдалося зберегти'
                );
            } finally {
                setSaving(false);
            }
            return;
        }

        setSaving(true);
        try {
            const held = await reserve(draft);
            setReservation(held);
            setMode('upsell');
        } catch {
            // Розрізняємо конфлікт (ім'я щойно зайняли) від інших збоїв
            // (мережа / 5xx): перевіряємо реальний статус. Без цього будь-яка
            // помилка показувала б хибне «зайнято».
            let conflicted = false;
            try {
                const status = await checkAvailability(draft);
                conflicted = status !== SLUG_AVAILABILITY_STATUS.AVAILABLE;
                if (conflicted) {
                    setAvailability({ status, checking: false });
                }
            } catch {
                conflicted = false;
            }
            if (!conflicted) {
                setFormatError('Не вдалося зберегти. Спробуйте ще раз');
            }
        } finally {
            setSaving(false);
        }
    };

    if (mode === 'upsell' && reservation) {
        return (
            <div className="border-primary/30 bg-primary/5 flex flex-col gap-4 rounded-lg border p-4">
                <div className="flex flex-col gap-1">
                    <p className="text-foreground text-base font-medium">
                        Ваша майбутня адреса готова
                    </p>
                    <span className="font-mono text-sm break-all">
                        <span className="text-muted-foreground">{prefix}</span>
                        <span className="text-foreground">
                            {reservation.desiredSlug}
                        </span>
                    </span>
                    <p className="text-muted-foreground text-sm">
                        Оформіть тариф «Свій бренд», і ця адреса стане вашою
                        одразу після оплати. Поки що вона потрібна лише вам.
                    </p>
                </div>
                <p className="text-muted-foreground flex items-center gap-2 text-sm">
                    <Clock className="text-primary h-4 w-4 shrink-0" />
                    Ім&apos;я тримається за вами ще{' '}
                    {formatCountdown(remainingMs)}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <UiButton
                        type="button"
                        variant="filled"
                        size="md"
                        loading={subscribing}
                        onClick={() => {
                            setSubscribing(true);
                            // `onSubscribe` редіректить на провайдера (сторінка
                            // вивантажується) АБО reject-ить на збої створення
                            // сесії. Помилку показує батько (toast); тут лише
                            // знімаємо loading, щоб кнопка лишалась клікабельною
                            // для повтору. `.catch` ковтає reject (свій toast уже
                            // показано) — інакше unhandled rejection.
                            void Promise.resolve(onSubscribe())
                                .catch(() => {})
                                .finally(() => setSubscribing(false));
                        }}
                        className="w-full sm:w-auto"
                    >
                        {subscribePriceLabel}
                    </UiButton>
                    <UiButton
                        as="link"
                        href="/billing"
                        variant="text"
                        size="md"
                        className="w-full sm:w-auto"
                    >
                        Усі тарифи
                    </UiButton>
                    <UiButton
                        type="button"
                        variant="text"
                        size="md"
                        onClick={() => {
                            setDraft(reservation.desiredSlug);
                            setMode('edit');
                        }}
                        className="w-full sm:w-auto sm:ml-auto"
                    >
                        Обрати інше ім&apos;я
                    </UiButton>
                </div>
            </div>
        );
    }

    if (mode === 'edit') {
        return (
            <div className="flex flex-col gap-2">
                <UiPrefixInput
                    prefix={prefix}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    error={formatError}
                    aria-label={ariaLabel}
                    autoFocus
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                />
                {!formatError && !isUnchanged && (
                    <AvailabilityHint state={availability} />
                )}
                {helpText && (
                    <p className="text-muted-foreground text-sm">{helpText}</p>
                )}
                <div className="flex justify-end gap-2">
                    <UiButton
                        type="button"
                        variant="text"
                        size="sm"
                        onClick={cancelEdit}
                        disabled={saving}
                        IconLeft={<X />}
                    >
                        Скасувати
                    </UiButton>
                    <UiButton
                        type="button"
                        variant="filled"
                        size="sm"
                        onClick={() => void handleSave()}
                        loading={saving}
                        IconLeft={<Check />}
                    >
                        Зберегти
                    </UiButton>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3">
            <span className="font-mono break-all">
                <span className="text-muted-foreground">{prefix}</span>
                <span className="text-foreground">{currentSlug}</span>
            </span>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <UiButton
                    as="a"
                    href={publicUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    variant="outline"
                    size="md"
                    IconLeft={<ExternalLink />}
                    className="w-full sm:w-auto"
                >
                    Відкрити в новій вкладці
                </UiButton>
                <UiButton
                    type="button"
                    variant="outline"
                    size="md"
                    onClick={() => void handleCopy()}
                    IconLeft={copied ? <Check /> : <Copy />}
                    className="w-full sm:w-auto"
                >
                    {copied ? 'Скопійовано' : 'Копіювати'}
                </UiButton>
                <UiButton
                    type="button"
                    variant="outline"
                    size="md"
                    onClick={startEdit}
                    IconLeft={<Pencil />}
                    className="w-full sm:w-auto"
                >
                    Редагувати
                </UiButton>
                {isPaid && (
                    <UiButton
                        type="button"
                        variant="outline"
                        size="md"
                        onClick={onRegenerate}
                        IconLeft={<RefreshCw />}
                        className="w-full sm:w-auto"
                    >
                        Згенерувати нове посилання
                    </UiButton>
                )}
            </div>
        </div>
    );
}

function AvailabilityHint({ state }: { state: AvailabilityState }) {
    if (state.checking) {
        return (
            <p className="text-muted-foreground text-sm">
                Перевіряємо доступність…
            </p>
        );
    }
    if (state.status === SLUG_AVAILABILITY_STATUS.AVAILABLE) {
        return <p className="text-success text-sm">Адреса вільна</p>;
    }
    if (state.status === SLUG_AVAILABILITY_STATUS.TAKEN) {
        return (
            <p className="text-destructive text-sm">
                Це посилання вже зайняте. Оберіть інше
            </p>
        );
    }
    if (state.status === SLUG_AVAILABILITY_STATUS.RESERVED) {
        return (
            <p className="text-destructive text-sm">
                Це посилання зарезервоване системою. Оберіть інше
            </p>
        );
    }
    return null;
}

function formatCountdown(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
