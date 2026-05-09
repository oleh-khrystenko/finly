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
    /**
     * Template з batch-fetched `Business` на parent-page. Lifted-down до
     * `InvoiceCard` для inheritance fallback (`paymentPurpose ?? template`) —
     * mirror backend-резолвера `effectiveInvoicePurpose`. Section не робить
     * власного fetch business-document-у; template приходить з cabinet-page,
     * де `Business` вже завантажений для решти секцій.
     */
    businessPaymentPurposeTemplate: string;
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
 * **State-discriminator (review fix).** `data: { paramSlug, items, total,
 * page } | null` — items ключуються route-param-ом. Якщо `businessSlug`
 * змінився між page-навігаціями (cabinet → інший cabinet → той самий список
 * через soft-back), старі items відкидаються render-ом до завершення нового
 * fetch. Без discriminator-у: попередня сторінка показувалася за свіжою
 * URL до завершення async-fetch, що ламає UX і race-condition безпеку.
 *
 * **Pagination state.** `loaded: Invoice[]` (накопичувальний) + `total: number`
 * для знання, коли зупинятись. Кожен "Завантажити ще" робить fetch з
 * `page = поточна + 1`, потім `mergeUniqueById` зливає items з existing-prev:
 * дублі (інвойс, що з'явився повторно через паралельний insert/order-shift)
 * перезаписуються по `id`, не дублюються в UI. Map-merge preserves order:
 * existing зберігають свою позицію, нові додаються в кінець.
 */

/**
 * Merge нових items з existing з deduplication по `id`. О(N+M); preserves
 * order existing-items, нові вставляються в кінець (Map insertion-order).
 * Якщо новий item має той самий `id`, що existing — overwrite-иться (свіжіша
 * версія перемагає, логічно для optimistic-state-у).
 */
function mergeUniqueById<T extends { id: string }>(prev: T[], next: T[]): T[] {
    const map = new Map<string, T>(prev.map((item) => [item.id, item]));
    for (const item of next) map.set(item.id, item);
    return Array.from(map.values());
}

interface SectionData {
    paramSlug: string;
    items: Invoice[];
    total: number;
    page: number;
}

interface SectionError {
    paramSlug: string;
    message: string;
}

function extractMessage(err: unknown): string {
    const code =
        err instanceof AxiosError
            ? ((err.response?.data as { error?: { code?: string } } | undefined)
                  ?.error?.code ?? 'unknown')
            : 'unknown';
    return getApiMessage(code, 'invoices');
}

export default function InvoicesSection({
    businessSlug,
    businessPaymentPurposeTemplate,
    payPublicOrigin,
}: Props) {
    const [data, setData] = useState<SectionData | null>(null);
    const [error, setError] = useState<SectionError | null>(null);
    const [loadingMore, setLoadingMore] = useState(false);

    // Sprint 4 §4.6 — pendingInvoiceDeletesStore filter-ить items, що вже у
    // 5s-undo вікні. Без цього: optimistic redirect з invoice-cabinet →
    // fresh fetch → бачимо інвойс ще присутнім у списку до того, як backend
    // DELETE реально спрацює.
    const pendingDeleteKeys = usePendingInvoiceDeletesStore((s) => s.keys);

    // Initial / re-fetch на зміну businessSlug.
    useEffect(() => {
        let cancelled = false;
        listInvoices(businessSlug, 1, PAGE_SIZE)
            .then((res) => {
                if (cancelled) return;
                setData({
                    paramSlug: businessSlug,
                    items: res.items,
                    total: res.total,
                    page: res.page,
                });
                setError(null);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                setError({
                    paramSlug: businessSlug,
                    message: extractMessage(err),
                });
            });
        return () => {
            cancelled = true;
        };
    }, [businessSlug]);

    const isCurrent = data?.paramSlug === businessSlug;
    const isErrorCurrent = error?.paramSlug === businessSlug;

    const loadMore = useCallback(async () => {
        if (loadingMore || !data || data.paramSlug !== businessSlug) return;
        const captured = businessSlug;
        setLoadingMore(true);
        try {
            const next = await listInvoices(captured, data.page + 1, PAGE_SIZE);
            // Apply тільки якщо state ще відповідає тому самому бізнесу —
            // інакше fetch може долетіти після page-navigation і записати
            // чужі items.
            setData((prev) =>
                prev && prev.paramSlug === captured
                    ? {
                          paramSlug: captured,
                          items: mergeUniqueById(prev.items, next.items),
                          total: next.total,
                          page: next.page,
                      }
                    : prev
            );
            // Review fix — попередня помилка ("Завантажити ще" failed → toast),
            // якщо вона стосувалася того самого бізнесу, при наступному
            // успішному loadMore має зникнути. Без цього error-плашка
            // лишалася над свіжим списком (initial-load очищала помилку,
            // loadMore ні — асиметрія state-flow-у).
            setError((prev) =>
                prev && prev.paramSlug === captured ? null : prev
            );
        } catch (err: unknown) {
            setError({
                paramSlug: captured,
                message: extractMessage(err),
            });
        } finally {
            setLoadingMore(false);
        }
    }, [businessSlug, data, loadingMore]);

    const visibleItems = useMemo(() => {
        if (!isCurrent || !data) return null;
        return data.items.filter(
            (i) => !pendingDeleteKeys.has(`${businessSlug}/${i.slug}`)
        );
    }, [isCurrent, data, pendingDeleteKeys, businessSlug]);

    // `total` приходить з backend — це source of truth по фактичному
    // remaining-count. Frontend pending-deletes тимчасово ховають N items з UI;
    // зменшуємо total відповідно, щоб "Завантажити ще ({total - items.length})"
    // не показувало від'ємні / надто великі числа.
    const total = isCurrent && data ? data.total : 0;
    const hiddenInList =
        visibleItems === null || data === null
            ? 0
            : data.items.length - visibleItems.length;
    const visibleTotal = Math.max(0, total - hiddenInList);
    const hasMore = visibleItems !== null && visibleItems.length < visibleTotal;

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
            {visibleItems === null && !isErrorCurrent && (
                <div className="flex justify-center py-8">
                    <UiSpinner size="md" />
                </div>
            )}

            {isErrorCurrent && (
                <p className="text-destructive py-4 text-sm">
                    {error?.message}
                </p>
            )}

            {visibleItems !== null &&
                visibleItems.length === 0 &&
                !isErrorCurrent && <EmptyState businessSlug={businessSlug} />}

            {visibleItems !== null && visibleItems.length > 0 && (
                <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                        {visibleItems.map((inv) => (
                            <InvoiceCard
                                key={inv.id}
                                invoice={inv}
                                businessSlug={businessSlug}
                                businessPaymentPurposeTemplate={
                                    businessPaymentPurposeTemplate
                                }
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
