'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Plus } from 'lucide-react';
import { AxiosError } from 'axios';
import { type Invoice } from '@finly/types';
import { getApiMessage, listInvoices } from '@/shared/api';
import UiButton from '@/shared/ui/UiButton';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSpinner from '@/shared/ui/UiSpinner';
import { usePendingInvoiceDeletesStore } from '@/features/invoice-edit';
import InvoiceCard from './InvoiceCard';

interface Props {
    businessSlug: string;
    /** Public-payment-page origin для побудови copy-link URL у InvoiceCard. */
    payPublicOrigin: string;
}

const PAGE_SIZE = 10;

/**
 * Sprint 4 §4.4 — секція "Рахунки" на сторінці бізнесу `/business/{slug}`.
 *
 * **Layout.** `UiSectionCard` з `headerRight`-CTA "Виставити рахунок";
 * всередині — empty-state АБО list карток з "Завантажити ще"-trigger-button.
 *
 * **Pagination state.** Тримаємо `loaded: Invoice[]` (накопичувальний) +
 * `total: number` для знання, коли зупинятись. Кожен "Завантажити ще" робить
 * fetch з `page = поточна + 1`, потім `mergeUniqueById` зливає items з
 * existing-prev: дублі (інвойс, що з'явився повторно через паралельний
 * insert/order-shift) перезаписуються по `id`, не дублюються в UI. Map-merge
 * preserves order: existing зберігають свою позицію, нові додаються в кінець.
 *
 * **State-mutation у async callback-ах** — той самий React 19 invariant, що
 * Sprint 3 cabinet (`page.tsx`): синхронний reset перед fetch порушує
 * react-hooks/set-state-in-effect.
 */

/**
 * Merge нових items з existing з deduplication по `id`. О(N+M); preserves
 * order existing-items, нові вставляються в кінець (Map insertion-order).
 * Якщо новий item має той самий `id`, що existing — overwrite-иться (свіжіша
 * версія перемагає, логічно для optimistic-state-у).
 */
function mergeUniqueById<T extends { id: string }>(
    prev: T[],
    next: T[],
): T[] {
    const map = new Map<string, T>(prev.map((item) => [item.id, item]));
    for (const item of next) map.set(item.id, item);
    return Array.from(map.values());
}
export default function InvoicesSection({
    businessSlug,
    payPublicOrigin,
}: Props) {
    const [items, setItems] = useState<Invoice[] | null>(null);
    const [total, setTotal] = useState<number>(0);
    const [page, setPage] = useState<number>(1);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Sprint 4 §4.6 — той самий патерн, що Sprint 3 business-list:
    // pendingInvoiceDeletesStore filter-ить items, що вже у 5s-undo вікні.
    // Без цього: optimistic redirect з invoice-cabinet → fresh fetch → бачимо
    // інвойс ще присутнім у списку до того, як backend DELETE реально
    // спрацює. Subscribe-селектор повертає Set, useState re-render при change.
    const pendingDeleteKeys = usePendingInvoiceDeletesStore((s) => s.keys);

    // Initial load.
    useEffect(() => {
        let cancelled = false;
        listInvoices(businessSlug, 1, PAGE_SIZE)
            .then((res) => {
                if (cancelled) return;
                setItems(res.items);
                setTotal(res.total);
                setPage(res.page);
                setError(null);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                const code =
                    err instanceof AxiosError
                        ? ((
                              err.response?.data as
                                  | { error?: { code?: string } }
                                  | undefined
                          )?.error?.code ?? 'unknown')
                        : 'unknown';
                setError(getApiMessage(code, 'invoices'));
            });
        return () => {
            cancelled = true;
        };
    }, [businessSlug]);

    const loadMore = useCallback(async () => {
        if (loadingMore || !items) return;
        setLoadingMore(true);
        try {
            const next = await listInvoices(
                businessSlug,
                page + 1,
                PAGE_SIZE,
            );
            setItems((prev) =>
                prev ? mergeUniqueById(prev, next.items) : next.items,
            );
            setTotal(next.total);
            setPage(next.page);
        } catch (err: unknown) {
            const code =
                err instanceof AxiosError
                    ? ((
                          err.response?.data as
                              | { error?: { code?: string } }
                              | undefined
                      )?.error?.code ?? 'unknown')
                    : 'unknown';
            setError(getApiMessage(code, 'invoices'));
        } finally {
            setLoadingMore(false);
        }
    }, [businessSlug, items, loadingMore, page]);

    const visibleItems = useMemo(() => {
        if (items === null) return null;
        return items.filter(
            (i) => !pendingDeleteKeys.has(`${businessSlug}/${i.slug}`),
        );
    }, [items, pendingDeleteKeys, businessSlug]);

    // `total` приходить з backend — це source of truth по фактичному
    // remaining-count. Frontend pending-deletes тимчасово ховають N items з UI;
    // зменшуємо total відповідно, щоб "Завантажити ще ({total - items.length})"
    // не показувало від'ємні / надто великі числа.
    const hiddenInList =
        items === null
            ? 0
            : items.length - (visibleItems?.length ?? 0);
    const visibleTotal = Math.max(0, total - hiddenInList);
    const hasMore =
        visibleItems !== null && visibleItems.length < visibleTotal;

    return (
        <UiSectionCard
            id="invoices"
            title="Рахунки"
            headerRight={
                visibleItems !== null && visibleItems.length > 0 ? (
                    <UiButton
                        as="link"
                        href={`/business/${businessSlug}/invoice/new`}
                        variant="filled"
                        size="sm"
                        IconLeft={<Plus />}
                    >
                        Виставити рахунок
                    </UiButton>
                ) : undefined
            }
        >
            {visibleItems === null && !error && (
                <div className="flex justify-center py-8">
                    <UiSpinner size="md" />
                </div>
            )}

            {error && (
                <p className="text-destructive py-4 text-sm">{error}</p>
            )}

            {visibleItems !== null && visibleItems.length === 0 && !error && (
                <EmptyState businessSlug={businessSlug} />
            )}

            {visibleItems !== null && visibleItems.length > 0 && (
                <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                        {visibleItems.map((inv) => (
                            <InvoiceCard
                                key={inv.id}
                                invoice={inv}
                                businessSlug={businessSlug}
                                payPublicOrigin={payPublicOrigin}
                            />
                        ))}
                    </div>
                    {hasMore && (
                        <div className="flex justify-center pt-2">
                            <UiButton
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => void loadMore()}
                                disabled={loadingMore}
                            >
                                {loadingMore ? (
                                    <UiSpinner size="sm" />
                                ) : (
                                    `Завантажити ще (${visibleTotal - visibleItems.length})`
                                )}
                            </UiButton>
                        </div>
                    )}
                </div>
            )}
        </UiSectionCard>
    );
}

function EmptyState({ businessSlug }: { businessSlug: string }) {
    return (
        <div className="flex flex-col items-center gap-4 py-8 text-center">
            <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
                <FileText className="size-6" />
            </div>
            <div className="space-y-1">
                <p className="text-foreground text-sm font-medium">
                    Поки немає виставлених рахунків
                </p>
                <p className="text-muted-foreground max-w-sm text-xs">
                    Натисніть «Виставити рахунок» — клієнт отримає посилання з
                    сумою і призначенням, готове для оплати.
                </p>
            </div>
            <UiButton
                as="link"
                href={`/business/${businessSlug}/invoice/new`}
                variant="filled"
                size="sm"
                IconLeft={<Plus />}
            >
                Виставити рахунок
            </UiButton>
        </div>
    );
}
