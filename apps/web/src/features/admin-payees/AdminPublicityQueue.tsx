'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AlertCircle, ExternalLink, Inbox } from 'lucide-react';
import {
    BUSINESS_TYPE_LABEL,
    CATALOG_CATEGORIES,
    CATALOG_CATEGORY_LABEL,
    type Business,
    type CatalogCategory,
} from '@finly/types';

import {
    adminApprovePublicity,
    adminListApprovedPublicity,
    adminListPublicityQueue,
    extractApiErrorCode,
    getApiMessage,
} from '@/shared/api';
import { formatPayeeName } from '@/entities/business';
import { ENV } from '@/shared/config/env';
import UiButton from '@/shared/ui/UiButton';
import UiLink from '@/shared/ui/UiLink';
import UiSelect from '@/shared/ui/UiSelect';
import UiSpinner from '@/shared/ui/UiSpinner';
import { useRejectPublicityStore } from './rejectPublicityStore';

const DATE_FMT = new Intl.DateTimeFormat('uk-UA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Kyiv',
});

type LoadState = { phase: 'loading' } | { phase: 'error' } | { phase: 'ready' };

export function AdminPublicityQueue() {
    const [state, setState] = useState<LoadState>({ phase: 'loading' });
    const [queue, setQueue] = useState<Business[]>([]);
    const [approved, setApproved] = useState<Business[]>([]);
    const openReject = useRejectPublicityStore((s) => s.open);

    // Guard на обидва шляхи завантаження (перший рендер і ручний reload після
    // схвалення/відхилення): відповідь, що прийшла після розмонтування, нічого
    // не пише. Тримається у ref, бо `load` спільний і не знає, звідки викликаний.
    const mountedRef = useRef(true);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    // Обидва списки тягнуться однаково і завжди разом (черга і схвалені —
    // дві секції одного екрана), тож завантаження одне на компонент.
    const load = useCallback(() => {
        Promise.all([adminListPublicityQueue(), adminListApprovedPublicity()])
            .then(([loadedQueue, loadedApproved]) => {
                if (!mountedRef.current) return;
                setQueue(loadedQueue);
                setApproved(loadedApproved);
                setState({ phase: 'ready' });
            })
            .catch(() => {
                if (mountedRef.current) setState({ phase: 'error' });
            });
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    return (
        <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 md:py-14 lg:px-8">
            <header>
                <h1 className="text-foreground text-2xl font-semibold tracking-tight md:text-3xl">
                    Запити на публічність
                </h1>
                <p className="text-muted-foreground mt-1 text-sm">
                    Заявки користувачів на додавання отримувача в каталог.
                </p>
            </header>

            <div className="mt-8">
                {state.phase === 'loading' && (
                    <div className="flex justify-center py-16">
                        <UiSpinner size="lg" />
                    </div>
                )}

                {state.phase === 'error' && (
                    <div className="border-border bg-muted/40 text-muted-foreground flex items-center gap-3 rounded-xl border p-5 text-sm">
                        <AlertCircle className="size-5 shrink-0" aria-hidden />
                        Не вдалося завантажити чергу. Перезавантажте сторінку.
                    </div>
                )}

                {state.phase === 'ready' && queue.length === 0 && (
                    <div className="border-border bg-muted/40 mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border p-8 text-center">
                        <span className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-lg">
                            <Inbox className="size-5" aria-hidden />
                        </span>
                        <p className="text-foreground text-sm font-medium">
                            Черга порожня
                        </p>
                        <p className="text-muted-foreground text-sm">
                            Нових заявок на розгляд немає.
                        </p>
                    </div>
                )}

                {state.phase === 'ready' && queue.length > 0 && (
                    <div className="space-y-3">
                        {queue.map((payee) => (
                            <QueueCard
                                key={payee.id}
                                payee={payee}
                                onApproved={load}
                                onReject={() =>
                                    openReject({
                                        slug: payee.slug,
                                        payeeName: formatPayeeName(
                                            payee.type,
                                            payee.name
                                        ),
                                        mode: 'pending',
                                        onRejected: load,
                                    })
                                }
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Схвалені: каталог це вітрина довіри, тож адмін мусить бачити,
                кого вже впустив, і мати змогу забрати схвалення одним кліком. */}
            {state.phase === 'ready' && approved.length > 0 && (
                <section className="mt-12">
                    <h2 className="text-foreground text-lg font-semibold">
                        Схвалені отримувачі
                    </h2>
                    <p className="text-muted-foreground mt-1 text-sm">
                        Видимість у каталозі кожен вмикає сам. Схвалення можна
                        забрати: отримувач зникне з каталогу, його публічні
                        сторінки і QR працюватимуть далі.
                    </p>
                    <div className="mt-4 space-y-3">
                        {approved.map((payee) => (
                            <ApprovedCard
                                key={payee.id}
                                payee={payee}
                                onRevoke={() =>
                                    openReject({
                                        slug: payee.slug,
                                        payeeName: formatPayeeName(
                                            payee.type,
                                            payee.name
                                        ),
                                        mode: 'approved',
                                        onRejected: load,
                                    })
                                }
                            />
                        ))}
                    </div>
                </section>
            )}
        </main>
    );
}

function ApprovedCard({
    payee,
    onRevoke,
}: {
    payee: Business;
    onRevoke: () => void;
}) {
    const publicUrl = `${ENV.NEXT_PUBLIC_PAY_PUBLIC_URL.replace(/\/$/, '')}/${payee.slug}`;
    return (
        <div className="border-border bg-card flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
            <div className="min-w-0">
                <p className="text-foreground truncate font-medium">
                    {formatPayeeName(payee.type, payee.name)}
                </p>
                <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span>{CATALOG_CATEGORY_LABEL[payee.catalogCategory]}</span>
                    <span aria-hidden>·</span>
                    <span>
                        {payee.catalogVisible
                            ? 'Показується в каталозі'
                            : 'Приховано власником'}
                    </span>
                </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
                <UiLink
                    as="a"
                    href={publicUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    variant="unstyled"
                    aria-label="Відкрити публічну сторінку в новій вкладці"
                    className="text-muted-foreground hover:text-primary inline-flex items-center gap-1 text-sm transition-colors"
                >
                    Переглянути
                    <ExternalLink className="size-4" aria-hidden />
                </UiLink>
                <UiButton
                    type="button"
                    variant="destructive-outline"
                    size="sm"
                    onClick={onRevoke}
                >
                    Прибрати з каталогу
                </UiButton>
            </div>
        </div>
    );
}

function QueueCard({
    payee,
    onApproved,
    onReject,
}: {
    payee: Business;
    onApproved: () => void;
    onReject: () => void;
}) {
    const [category, setCategory] = useState<CatalogCategory>(
        payee.catalogCategory
    );
    const [approving, setApproving] = useState(false);
    const publicUrl = `${ENV.NEXT_PUBLIC_PAY_PUBLIC_URL.replace(/\/$/, '')}/${payee.slug}`;

    const handleApprove = async () => {
        setApproving(true);
        try {
            await adminApprovePublicity(payee.slug, { category });
            toast.success('Запит схвалено');
            onApproved();
        } catch (err) {
            toast.error(getApiMessage(extractApiErrorCode(err), 'businesses'));
            setApproving(false);
        }
    };

    return (
        <div className="border-border bg-card space-y-4 rounded-xl border p-4">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-foreground truncate font-medium">
                        {formatPayeeName(payee.type, payee.name)}
                    </p>
                    <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                        <span>{BUSINESS_TYPE_LABEL[payee.type]}</span>
                        {payee.publicityRequestedAt && (
                            <>
                                <span aria-hidden>·</span>
                                <span>
                                    Подано{' '}
                                    {DATE_FMT.format(
                                        new Date(payee.publicityRequestedAt)
                                    )}
                                </span>
                            </>
                        )}
                    </div>
                </div>
                <UiLink
                    as="a"
                    href={publicUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    variant="unstyled"
                    aria-label="Відкрити публічну сторінку в новій вкладці"
                    className="text-muted-foreground hover:text-primary inline-flex shrink-0 items-center gap-1 text-sm transition-colors"
                >
                    Переглянути
                    <ExternalLink className="size-4" aria-hidden />
                </UiLink>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="sm:w-56">
                    <UiSelect
                        label="Категорія при схваленні"
                        labelSize="sm"
                        options={CATALOG_CATEGORIES.map((c) => ({
                            value: c,
                            label: CATALOG_CATEGORY_LABEL[c],
                        }))}
                        value={category}
                        onChange={(v) => setCategory(v as CatalogCategory)}
                    />
                </div>
                <div className="flex gap-2">
                    <UiButton
                        type="button"
                        variant="destructive-outline"
                        size="md"
                        onClick={onReject}
                        disabled={approving}
                    >
                        Відхилити
                    </UiButton>
                    <UiButton
                        type="button"
                        variant="filled"
                        size="md"
                        loading={approving}
                        onClick={() => void handleApprove()}
                    >
                        Схвалити
                    </UiButton>
                </div>
            </div>
        </div>
    );
}
