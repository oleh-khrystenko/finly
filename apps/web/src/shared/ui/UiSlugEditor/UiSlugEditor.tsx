'use client';

import { useEffect, useRef, useState } from 'react';
import {
    Check,
    Clock,
    Copy,
    ExternalLink,
    Pencil,
    RefreshCw,
    Share2,
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

/**
 * Read-mode дії (Поділитись / Копіювати / Відкрити / Редагувати / Згенерувати).
 * Mobile-first: базово підпис прихований (`hidden sm:inline` на тексті) — лишається
 * сама іконка; від sm: підпис з'являється і кнопка природно розширюється. Падинг
 * і gap беремо від UiButton (ui-primitives.md §2 — не дублюємо/не оверрайдимо їх
 * у className); `min-h-11` тримає touch-target 44px на мобільному (responsive.md §2).
 */
const compactActionButton = 'min-h-11';

type Mode = 'read' | 'edit' | 'upsell';
type LiveState =
    | { kind: 'idle' }
    | { kind: 'checking' }
    | { kind: 'status'; status: SlugAvailabilityStatus };

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
    const [saveError, setSaveError] = useState<string | undefined>();
    const [live, setLive] = useState<LiveState>({ kind: 'idle' });
    const [saving, setSaving] = useState(false);
    const [subscribing, setSubscribing] = useState(false);
    const [reservation, setReservation] = useState<SlugReservationView | null>(
        initialReservation
    );
    const [copied, setCopied] = useState(false);
    // Web Share API є на всіх мобільних, але часто відсутня на десктоп-Chrome/
    // Firefox. Рендеримо «Поділитись» лише там, де браузер її підтримує
    // (progressive enhancement) — інакше на десктопі вона дублювала б
    // «Копіювати». Перевірка лише на клієнті після mount (SSR не має navigator).
    const [canShare, setCanShare] = useState(false);
    useEffect(() => {
        setCanShare(
            typeof navigator !== 'undefined' &&
                typeof navigator.share === 'function'
        );
    }, []);

    // Lowercase-порівняння — для пропуску availability-check власного імені
    // (зміна лише регістру свого slug тривіально «вільна»).
    const isUnchanged = draft.trim().toLowerCase() === currentSlug.toLowerCase();
    // Точне порівняння — для no-op-короткозамикання Save: зміна лише регістру
    // (`ivanenko` → `IvanEnko`) — валідна платна правка (бекенд: slugCaseOnlyChange),
    // тож вона НЕ no-op і має дійти до запису.
    const isExactSame = draft === currentSlug;
    // Формат-помилка рахується синхронно на рендері (дешево) — показується
    // миттєво без debounce, на відміну від мережевої перевірки вільності.
    const formatMessage = validate(draft);
    // Save блокується, поки формат невалідний, поле порожнє, або ім'я зайняте/
    // зарезервоване: помилка стає недосяжною, контрол веде до валідного стану
    // замість сюрпризу на клік.
    const saveBlocked =
        formatMessage !== null ||
        (live.kind === 'status' &&
            live.status !== SLUG_AVAILABILITY_STATUS.AVAILABLE);
    const canSave = !saving && draft.trim() !== '' && !saveBlocked;

    // Live-доступність із debounce. Мережа стартує лише коли формат валідний,
    // поле непорожнє і ім'я відмінне від поточного. Формат-помилку показує
    // синхронний `formatMessage` (без debounce), тож тут її гілка — просто idle.
    // Stale-guard: `id` бампиться на КОЖНОМУ прогоні, тож in-flight промис із
    // попереднього драфту відкидається навіть на гілках без мережі.
    const requestIdRef = useRef(0);
    useEffect(() => {
        if (mode !== 'edit') return;
        const id = ++requestIdRef.current;
        if (draft.trim() === '' || isUnchanged || formatMessage) {
            setLive({ kind: 'idle' });
            return;
        }
        setLive({ kind: 'checking' });
        const handle = setTimeout(() => {
            void checkAvailability(draft)
                .then((status) => {
                    if (requestIdRef.current === id) {
                        setLive({ kind: 'status', status });
                    }
                })
                .catch(() => {
                    if (requestIdRef.current === id) {
                        setLive({ kind: 'idle' });
                    }
                });
        }, AVAILABILITY_DEBOUNCE_MS);
        return () => clearTimeout(handle);
    }, [draft, mode, isUnchanged, formatMessage, checkAvailability]);

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
            setSaveError(undefined);
            setLive({ kind: 'idle' });
            setMode('edit');
        }
    }, [autoStartEdit, currentSlug]);

    const startEdit = () => {
        setDraft(currentSlug);
        setSaveError(undefined);
        setLive({ kind: 'idle' });
        setMode('edit');
    };

    const cancelEdit = () => {
        setSaveError(undefined);
        setMode(reservation ? 'upsell' : 'read');
    };

    const handleShare = async () => {
        try {
            await navigator.share({ url: publicUrl });
        } catch {
            // Користувач закрив системну шторку (AbortError) або поділитись не
            // вдалось — мовчки ігноруємо. «Копіювати» поруч лишається запасним
            // шляхом, тож страшний toast тут зайвий.
        }
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
        // Формат уже підсвічено синхронно (`formatMessage`), а Save задизейблено
        // на невалідному — це лише захисний guard.
        if (validate(draft) !== null) return;
        setSaveError(undefined);
        if (isExactSame) {
            setMode('read');
            return;
        }
        // Свіжа перевірка перед дією (live-статус міг бути ще не дорахований).
        const status = await checkAvailability(draft);
        setLive({ kind: 'status', status });
        if (status !== SLUG_AVAILABILITY_STATUS.AVAILABLE) return;

        if (isPaid) {
            setSaving(true);
            try {
                await onSave(draft);
                setMode('read');
            } catch (e) {
                setSaveError(
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
                    setLive({ kind: 'status', status });
                }
            } catch {
                conflicted = false;
            }
            if (!conflicted) {
                setSaveError('Не вдалося зберегти. Спробуйте ще раз');
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
                        Ця адреса поки вільна, і ми тримаємо її за вами.
                        Оформіть «Бренд», і вона стане вашою одразу після
                        оплати.
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
                    onChange={(e) => {
                        setDraft(e.target.value);
                        setSaveError(undefined);
                    }}
                    error={saveError}
                    aria-label={ariaLabel}
                    autoFocus
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                />
                {!saveError && !isUnchanged && draft.trim() !== '' && (
                    <SlugHint formatMessage={formatMessage} live={live} />
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
                        disabled={!canSave}
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
            {/*
             * Mobile-first (<sm): icon-only — підпис прихований, дія лишається
             * озвученою через aria-label; `min-h-11` дає touch-target 44px
             * (responsive.md §2). Від sm: повні підписи.
             */}
            <div className="flex flex-row flex-wrap items-center gap-2">
                {canShare && (
                    <UiButton
                        type="button"
                        variant="filled"
                        size="md"
                        onClick={() => void handleShare()}
                        aria-label="Поділитись"
                        IconLeft={<Share2 />}
                        collapseLabel
                        className={compactActionButton}
                    >
                        Поділитись
                    </UiButton>
                )}
                <UiButton
                    type="button"
                    variant="outline"
                    size="md"
                    onClick={() => void handleCopy()}
                    aria-label={copied ? 'Скопійовано' : 'Копіювати'}
                    IconLeft={copied ? <Check /> : <Copy />}
                    collapseLabel
                    className={compactActionButton}
                >
                    {copied ? 'Скопійовано' : 'Копіювати'}
                </UiButton>
                <UiButton
                    as="a"
                    href={publicUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    variant="outline"
                    size="md"
                    aria-label="Відкрити в новій вкладці"
                    IconLeft={<ExternalLink />}
                    collapseLabel
                    className={compactActionButton}
                >
                    Відкрити в новій вкладці
                </UiButton>
                <UiButton
                    type="button"
                    variant="outline"
                    size="md"
                    onClick={startEdit}
                    aria-label="Редагувати"
                    IconLeft={<Pencil />}
                    collapseLabel
                    className={compactActionButton}
                >
                    Редагувати
                </UiButton>
                {/*
                 * Згенерувати нове посилання — доступне всім рівням. Це не
                 * брендова фіча (видає випадковий slug), а гігієна/безпека:
                 * спалити витекле посилання й отримати свіже. На Free це єдиний
                 * важіль над власною адресою, тож без гейта й без апселу.
                 */}
                <UiButton
                    type="button"
                    variant="outline"
                    size="md"
                    onClick={onRegenerate}
                    aria-label="Згенерувати нове посилання"
                    IconLeft={<RefreshCw />}
                    collapseLabel
                    className={compactActionButton}
                >
                    Згенерувати нове посилання
                </UiButton>
            </div>
        </div>
    );
}

function SlugHint({
    formatMessage,
    live,
}: {
    formatMessage: string | null;
    live: LiveState;
}) {
    if (formatMessage) {
        return <p className="text-destructive text-sm">{formatMessage}</p>;
    }
    if (live.kind === 'checking') {
        return (
            <p className="text-muted-foreground text-sm">
                Перевіряємо доступність…
            </p>
        );
    }
    if (live.kind === 'status') {
        if (live.status === SLUG_AVAILABILITY_STATUS.AVAILABLE) {
            return <p className="text-success text-sm">Адреса вільна</p>;
        }
        if (live.status === SLUG_AVAILABILITY_STATUS.TAKEN) {
            return (
                <p className="text-destructive text-sm">
                    Це посилання вже зайняте. Оберіть інше
                </p>
            );
        }
        if (live.status === SLUG_AVAILABILITY_STATUS.RESERVED) {
            return (
                <p className="text-destructive text-sm">
                    Це посилання зарезервоване системою. Оберіть інше
                </p>
            );
        }
    }
    return null;
}

function formatCountdown(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
