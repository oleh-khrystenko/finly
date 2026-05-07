'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ExternalLink, Trash2 } from 'lucide-react';
import { AxiosError } from 'axios';
import { toast } from 'sonner';
import {
    type Invoice,
    type PublicInvoiceView,
    type UpdateInvoiceRequest,
} from '@finly/types';
import {
    getApiMessage,
    getBusinessBySlug,
    getInvoiceBySlug,
    getPublicInvoiceView,
    updateInvoice,
    type BusinessWithInvoicesCount,
} from '@/shared/api';
import { ENV } from '@/shared/config/env';
import UiButton from '@/shared/ui/UiButton';
import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSpinner from '@/shared/ui/UiSpinner';
import UiSwitch from '@/shared/ui/UiSwitch';
import {
    AmountSection,
    InvoiceQrSection,
    PurposeSection,
    SlugSection,
    ValidUntilSection,
    scheduleInvoiceDeleteWithUndo,
    useDeleteInvoiceConfirmStore,
} from '@/features/invoice-edit';
import { InvoicePublicView } from '@/features/invoice-public';
import { formatKopecksAsHryvnia } from '@/features/invoices';

type PublicViewState =
    | { kind: 'idle' }
    | {
          kind: 'loaded';
          businessSlug: string;
          invoiceSlug: string;
          view: PublicInvoiceView;
      }
    | { kind: 'failed'; businessSlug: string; invoiceSlug: string };

/**
 * Sprint 4 §4.6 — кабінет інвойсу `/business/{slug}/invoice/{invoiceSlug}`.
 *
 * **Layout повторює Sprint 3 cabinet-зону**: top toolbar (back-link, heading,
 * preview-toggle, "Відкрити в новій вкладці") + 6 секцій-карток + Danger zone.
 * Inline-edit per field через `UiEditableField` (commonший primitive у
 * `shared/ui/`).
 *
 * **Preview-toggle (SP-2)** — той самий patern, що Sprint 3: prefetch public-
 * view одразу при mount-i, instant-toggle "Кабінет / Перегляд як клієнт".
 * `state.businessSlug + invoiceSlug` як discriminator-key — ловить stale-
 * state при швидкому переході між інвойсами.
 *
 * **Delete з 5s Undo** — `scheduleInvoiceDeleteWithUndo` (той самий patern,
 * що Sprint 3 для бізнесу). Optimistic redirect на `/business/{slug}#invoices`,
 * cancel-button у toast повертає на cabinet інвойсу.
 */
export default function InvoiceCabinetPage() {
    const router = useRouter();
    const params = useParams<{ slug: string; invoiceSlug: string }>();
    const openDeleteConfirm = useDeleteInvoiceConfirmStore((s) => s.open);

    const [business, setBusiness] = useState<
        BusinessWithInvoicesCount | null
    >(null);
    const [invoice, setInvoice] = useState<Invoice | null>(null);
    const [error, setError] = useState<{ code: string } | null>(null);
    const [previewMode, setPreviewMode] = useState(false);
    const [publicView, setPublicView] = useState<PublicViewState>({
        kind: 'idle',
    });

    // Parallel fetch business + invoice. State-mutation у async-callback (React 19
    // invariant — той самий, що Sprint 3 cabinet).
    useEffect(() => {
        if (!params.slug || !params.invoiceSlug) return;
        let cancelled = false;
        Promise.all([
            getBusinessBySlug(params.slug),
            getInvoiceBySlug(params.slug, params.invoiceSlug),
        ])
            .then(([b, inv]) => {
                if (cancelled) return;
                setBusiness(b);
                setInvoice(inv);
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
                setError({ code });
            });
        return () => {
            cancelled = true;
        };
    }, [params.slug, params.invoiceSlug]);

    // Prefetch public-view для preview-toggle.
    useEffect(() => {
        if (!business || !invoice) return;
        const businessSlug = business.slug;
        const invoiceSlug = invoice.slug;
        let cancelled = false;
        getPublicInvoiceView(businessSlug, invoiceSlug)
            .then((view) => {
                if (!cancelled) {
                    setPublicView({
                        kind: 'loaded',
                        businessSlug,
                        invoiceSlug,
                        view,
                    });
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setPublicView({
                        kind: 'failed',
                        businessSlug,
                        invoiceSlug,
                    });
                }
            });
        return () => {
            cancelled = true;
        };
    }, [business, invoice]);

    const handlePatch = useCallback(
        async (patch: UpdateInvoiceRequest) => {
            if (!business || !invoice) return;
            try {
                const updated = await updateInvoice(
                    business.slug,
                    invoice.slug,
                    patch,
                );
                setInvoice(updated);
                toast.success('Зміни збережено');
            } catch (err: unknown) {
                const code =
                    err instanceof AxiosError
                        ? ((
                              err.response?.data as
                                  | { error?: { code?: string } }
                                  | undefined
                          )?.error?.code ?? 'unknown')
                        : 'unknown';
                const msg = getApiMessage(code, 'invoices');
                toast.error(msg);
                throw new Error(msg);
            }
        },
        [business, invoice],
    );

    const handleDelete = useCallback(() => {
        if (!business || !invoice) return;
        const businessSlug = business.slug;
        const invoiceSlug = invoice.slug;
        // Sprint 4 §4.6 — той самий 2-step Sprint 3 patern: confirm-modal →
        // 5s-undo. Modal = first guardrail (захист від accidental click);
        // undo = recovery-window (5s, browser-unload-cancel).
        openDeleteConfirm(invoice, () => {
            scheduleInvoiceDeleteWithUndo({
                businessSlug,
                invoiceSlug,
                onScheduled: () =>
                    router.replace(`/business/${businessSlug}#invoices`),
                onCancelled: () =>
                    router.replace(
                        `/business/${businessSlug}/invoice/${invoiceSlug}`,
                    ),
            });
        });
    }, [business, invoice, openDeleteConfirm, router]);

    if ((business === null || invoice === null) && !error) {
        return (
            <UiPageContainer className="py-16">
                <div className="flex justify-center">
                    <UiSpinner size="md" />
                </div>
            </UiPageContainer>
        );
    }

    if (error) return <ErrorPage code={error.code} />;
    if (!business || !invoice) return null;

    const formattedAmount = formatKopecksAsHryvnia(invoice.amount);
    const publicUrl = `${ENV.NEXT_PUBLIC_PAY_PUBLIC_URL.replace(/\/$/, '')}/${business.slug}/${invoice.slug}`;

    return (
        <UiPageContainer className="space-y-6 py-8 md:py-12">
            {/* Top toolbar */}
            <div className="flex flex-col gap-4">
                <UiButton
                    as="link"
                    href={`/business/${business.slug}#invoices`}
                    variant="text"
                    size="sm"
                    IconLeft={<ArrowLeft />}
                    className="self-start px-0"
                >
                    Назад до бізнесу
                </UiButton>
                <div className="flex flex-wrap items-start justify-between gap-3">
                    {/*
                     * Plan §4.6: "заголовок 'Рахунок №… — {amount-formatted}'".
                     * `№{slug}` через `font-mono`-span → ФОП-у легше
                     * ідентифікувати конкретний інвойс при кількох рахунках
                     * на одному бізнесі. Amount-частина після em-dash —
                     * необов'язкова (signage-mode: amount=null → опускаємо
                     * другий сегмент).
                     */}
                    <h1 className="text-foreground text-2xl font-bold tracking-tight md:text-3xl">
                        Рахунок{' '}
                        <span className="font-mono">№{invoice.slug}</span>
                        {formattedAmount && (
                            <>
                                {' '}
                                <span className="text-muted-foreground">
                                    —
                                </span>{' '}
                                {formattedAmount}
                            </>
                        )}
                    </h1>
                    <div className="flex flex-wrap items-center gap-3">
                        <label
                            htmlFor="invoice-preview-toggle"
                            className="flex cursor-pointer items-center gap-2"
                        >
                            <UiSwitch
                                id="invoice-preview-toggle"
                                size="sm"
                                checked={previewMode}
                                onChange={setPreviewMode}
                            />
                            <span className="text-muted-foreground text-sm">
                                Перегляд як клієнт
                            </span>
                        </label>
                        <UiButton
                            as="a"
                            href={publicUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            variant="outline"
                            size="sm"
                            IconRight={<ExternalLink />}
                        >
                            Відкрити в новій вкладці
                        </UiButton>
                    </div>
                </div>
            </div>

            {previewMode ? (
                <InvoicePreviewPanel
                    state={publicView}
                    expectedBusinessSlug={business.slug}
                    expectedInvoiceSlug={invoice.slug}
                />
            ) : (
                <div className="space-y-4">
                    <AmountSection invoice={invoice} onSave={handlePatch} />
                    <PurposeSection
                        invoice={invoice}
                        business={business}
                        onSave={handlePatch}
                    />
                    <ValidUntilSection
                        invoice={invoice}
                        onSave={handlePatch}
                    />
                    <SlugSection
                        invoice={invoice}
                        businessSlug={business.slug}
                        payPublicOrigin={ENV.NEXT_PUBLIC_PAY_PUBLIC_URL}
                    />
                    <InvoiceQrSection
                        invoice={invoice}
                        businessSlug={business.slug}
                    />

                    <UiSectionCard title="Небезпечна зона">
                        <p className="text-muted-foreground mt-2 text-sm">
                            Видалення повне і незворотне. Клієнт, що має
                            збережене посилання, не зможе оплатити.
                        </p>
                        <div className="mt-4">
                            <UiButton
                                type="button"
                                variant="destructive-outline"
                                size="md"
                                onClick={handleDelete}
                                IconLeft={<Trash2 />}
                            >
                                Видалити рахунок
                            </UiButton>
                        </div>
                    </UiSectionCard>
                </div>
            )}
        </UiPageContainer>
    );
}

function InvoicePreviewPanel({
    state,
    expectedBusinessSlug,
    expectedInvoiceSlug,
}: {
    state: PublicViewState;
    expectedBusinessSlug: string;
    expectedInvoiceSlug: string;
}) {
    const isCurrent =
        state.kind !== 'idle' &&
        state.businessSlug === expectedBusinessSlug &&
        state.invoiceSlug === expectedInvoiceSlug;

    return (
        <div className="border-border bg-background rounded-xl border">
            {state.kind === 'loaded' && isCurrent ? (
                <InvoicePublicView
                    amount={state.view.amount}
                    amountLocked={state.view.amountLocked}
                    paymentPurpose={state.view.paymentPurpose}
                    validUntil={state.view.validUntil}
                    invoiceSlug={state.view.slug}
                    business={state.view.business}
                    nbuLinks={state.view.nbuLinks}
                />
            ) : state.kind === 'failed' && isCurrent ? (
                <p className="text-muted-foreground p-8 text-center text-sm">
                    Не вдалося завантажити перегляд. Натисніть «Відкрити в
                    новій вкладці» для перевірки.
                </p>
            ) : (
                <div className="flex justify-center py-16">
                    <UiSpinner size="md" />
                </div>
            )}
        </div>
    );
}

function ErrorPage({ code }: { code: string }) {
    const message =
        code === 'INVOICE_NOT_FOUND' || code === 'NOT_FOUND'
            ? 'Рахунок не знайдено'
            : code === 'BUSINESS_NOT_FOUND'
              ? 'Бізнес не знайдено'
              : code === 'BUSINESS_ACCESS_DENIED'
                ? 'У вас немає доступу до цього бізнесу'
                : getApiMessage(code, 'invoices');

    return (
        <UiPageContainer className="space-y-6 py-12">
            <UiSectionCard title={message}>
                <p className="text-muted-foreground mt-2 text-sm">
                    Поверніться до бізнесу і оберіть інший рахунок.
                </p>
                <div className="mt-4">
                    <UiButton
                        as="link"
                        href="/business"
                        variant="filled"
                        size="md"
                        IconLeft={<ArrowLeft />}
                    >
                        До списку бізнесів
                    </UiButton>
                </div>
            </UiSectionCard>
        </UiPageContainer>
    );
}
