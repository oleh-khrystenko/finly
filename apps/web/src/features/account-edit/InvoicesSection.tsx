'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Plus } from 'lucide-react';
import { AxiosError } from 'axios';
import { type Invoice, type SlugPreset } from '@finly/types';
import { getApiMessage, listInvoices } from '@/shared/api';
import UiButton from '@/shared/ui/UiButton';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSpinner from '@/shared/ui/UiSpinner';
import { usePendingInvoiceDeletesStore } from '@/features/invoice-edit';
import InvoiceCard from './InvoiceCard';
import InvoiceNumberingMenu from './InvoiceNumberingMenu';

interface Props {
    businessSlug: string;
    accountSlug: string;
    /**
     * Template з batch-fetched `Business` на parent-page. Lifted-down до
     * `InvoiceCard` для inheritance fallback (`paymentPurpose ?? template`).
     */
    businessPaymentPurposeTemplate: string;
    /** Public-payment-page origin для побудови copy-link URL. */
    payPublicOrigin: string;
    /**
     * Sprint 15 §UI — формат нумерації нових інвойсів цього рахунку, керований
     * gear-меню у хедері (демоут зі старої окремої "Налаштування інвойсів").
     */
    invoiceSlugPresetDefault: SlugPreset | null;
    onSavePreset: (preset: SlugPreset | null) => Promise<void>;
}

const PAGE_SIZE = 10;

/**
 * Sprint 4 §4.4 + Sprint 9 §SP-5/§SP-6 — секція "Інвойси" на account-cabinet-
 * page. До Sprint 9 жила на business-cabinet (Sprint 4 §4.4); переїхала разом
 * з per-account-нумерацією інвойсів.
 *
 * **List-fetch:** `listInvoices(businessSlug, accountSlug, page, limit)` —
 * 3-сегментний URL `/businesses/me/{biz}/accounts/{acc}/invoices`.
 *
 * **State-discriminator** (review fix). `data: { paramBiz, paramAcc, items,
 * total, page } | null` — items ключуються route-param-ами. Якщо змінився
 * хоча б один з business/account — старі items відкидаються render-ом до
 * завершення нового fetch.
 *
 * **Pagination state.** `loaded: Invoice[]` (накопичувальний) + `total`;
 * `mergeUniqueById` зливає items з existing-prev (dedup по `id`).
 */

function mergeUniqueById<T extends { id: string }>(prev: T[], next: T[]): T[] {
    const map = new Map<string, T>(prev.map((item) => [item.id, item]));
    for (const item of next) map.set(item.id, item);
    return Array.from(map.values());
}

interface SectionData {
    paramBiz: string;
    paramAcc: string;
    items: Invoice[];
    total: number;
    page: number;
}

interface SectionError {
    paramBiz: string;
    paramAcc: string;
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
    accountSlug,
    businessPaymentPurposeTemplate,
    payPublicOrigin,
    invoiceSlugPresetDefault,
    onSavePreset,
}: Props) {
    const [data, setData] = useState<SectionData | null>(null);
    const [error, setError] = useState<SectionError | null>(null);
    const [loadingMore, setLoadingMore] = useState(false);

    // Sprint 4 §4.6 + Sprint 9 §SP-10 — 3-сегментний key.
    const pendingDeleteKeys = usePendingInvoiceDeletesStore((s) => s.keys);

    useEffect(() => {
        let cancelled = false;
        listInvoices(businessSlug, accountSlug, 1, PAGE_SIZE)
            .then((res) => {
                if (cancelled) return;
                setData({
                    paramBiz: businessSlug,
                    paramAcc: accountSlug,
                    items: res.items,
                    total: res.total,
                    page: res.page,
                });
                setError(null);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                setError({
                    paramBiz: businessSlug,
                    paramAcc: accountSlug,
                    message: extractMessage(err),
                });
            });
        return () => {
            cancelled = true;
        };
    }, [businessSlug, accountSlug]);

    const isCurrent =
        data?.paramBiz === businessSlug && data?.paramAcc === accountSlug;
    const isErrorCurrent =
        error?.paramBiz === businessSlug && error?.paramAcc === accountSlug;

    const loadMore = useCallback(async () => {
        if (
            loadingMore ||
            !data ||
            data.paramBiz !== businessSlug ||
            data.paramAcc !== accountSlug
        ) {
            return;
        }
        const capturedBiz = businessSlug;
        const capturedAcc = accountSlug;
        setLoadingMore(true);
        try {
            const next = await listInvoices(
                capturedBiz,
                capturedAcc,
                data.page + 1,
                PAGE_SIZE
            );
            setData((prev) =>
                prev &&
                prev.paramBiz === capturedBiz &&
                prev.paramAcc === capturedAcc
                    ? {
                          paramBiz: capturedBiz,
                          paramAcc: capturedAcc,
                          items: mergeUniqueById(prev.items, next.items),
                          total: next.total,
                          page: next.page,
                      }
                    : prev
            );
            setError((prev) =>
                prev &&
                prev.paramBiz === capturedBiz &&
                prev.paramAcc === capturedAcc
                    ? null
                    : prev
            );
        } catch (err: unknown) {
            setError({
                paramBiz: capturedBiz,
                paramAcc: capturedAcc,
                message: extractMessage(err),
            });
        } finally {
            setLoadingMore(false);
        }
    }, [businessSlug, accountSlug, data, loadingMore]);

    const visibleItems = useMemo(() => {
        if (!isCurrent || !data) return null;
        return data.items.filter(
            (i) =>
                !pendingDeleteKeys.has(
                    `${businessSlug}/${accountSlug}/${i.slug}`
                )
        );
    }, [isCurrent, data, pendingDeleteKeys, businessSlug, accountSlug]);

    const total = isCurrent && data ? data.total : 0;
    const hiddenInList =
        visibleItems === null || data === null
            ? 0
            : data.items.length - visibleItems.length;
    const visibleTotal = Math.max(0, total - hiddenInList);
    const hasMore = visibleItems !== null && visibleItems.length < visibleTotal;

    const createInvoiceHref = `/business/${businessSlug}/account/${accountSlug}/invoice/new`;

    return (
        <UiSectionCard
            id="invoices"
            title="Інвойси"
            headerRight={
                <div className="flex items-center gap-2">
                    <InvoiceNumberingMenu
                        value={invoiceSlugPresetDefault}
                        onSave={onSavePreset}
                    />
                    {visibleItems !== null && visibleItems.length > 0 && (
                        <UiButton
                            as="link"
                            href={createInvoiceHref}
                            variant="filled"
                            size="md"
                            aria-label="Виставити інвойс"
                            IconLeft={<Plus />}
                        >
                            <span className="hidden sm:inline">
                                Виставити інвойс
                            </span>
                        </UiButton>
                    )}
                </div>
            }
        >
            {visibleItems === null && !isErrorCurrent && (
                <div className="flex justify-center py-8">
                    <UiSpinner size="md" />
                </div>
            )}

            {isErrorCurrent && (
                <p className="text-destructive py-4 text-base">
                    {error?.message}
                </p>
            )}

            {visibleItems !== null &&
                visibleItems.length === 0 &&
                !isErrorCurrent && (
                    <EmptyState createHref={createInvoiceHref} />
                )}

            {visibleItems !== null && visibleItems.length > 0 && (
                <div className="mt-4 space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                        {visibleItems.map((inv) => (
                            <InvoiceCard
                                key={inv.id}
                                invoice={inv}
                                businessSlug={businessSlug}
                                accountSlug={accountSlug}
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
                                size="md"
                                onClick={() => void loadMore()}
                                loading={loadingMore}
                            >
                                {`Завантажити ще (${visibleTotal - visibleItems.length})`}
                            </UiButton>
                        </div>
                    )}
                </div>
            )}
        </UiSectionCard>
    );
}

function EmptyState({ createHref }: { createHref: string }) {
    return (
        <div className="flex flex-col items-center gap-4 py-10 text-center">
            <div className="bg-muted text-muted-foreground flex size-14 items-center justify-center rounded-full">
                <FileText className="size-7" />
            </div>
            <div className="space-y-1.5">
                <p className="text-foreground text-lg font-semibold">
                    Поки немає виставлених інвойсів
                </p>
                <p className="text-muted-foreground max-w-sm text-base">
                    Натисніть «Виставити інвойс» — клієнт отримає посилання з
                    сумою і призначенням, готове для оплати.
                </p>
            </div>
            <UiButton
                as="link"
                href={createHref}
                variant="filled"
                size="md"
                IconLeft={<Plus />}
            >
                Виставити інвойс
            </UiButton>
        </div>
    );
}
