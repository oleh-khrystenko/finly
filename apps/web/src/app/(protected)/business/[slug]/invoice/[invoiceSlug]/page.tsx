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
import { formatKopecksAsHryvnia } from '@/entities/invoice';

/**
 * Sprint 4 §4.6 — кабінет інвойсу `/business/{slug}/invoice/{invoiceSlug}`.
 *
 * **Layout повторює Sprint 3 cabinet-зону**: top toolbar (back-link, heading,
 * preview-toggle, "Відкрити в новій вкладці") + 6 секцій-карток + Danger zone.
 * Inline-edit per field через `UiEditableField` (commonший primitive у
 * `shared/ui/`).
 *
 * **State-discriminator (review fix).** `data: { paramSlug, paramInvoiceSlug,
 * business, invoice } | null` — обʼєднує business+invoice у monolithic snapshot
 * з ключем-route-params. При client-side navigation між invoice-pages одного
 * route shape (`/business/.../invoice/X` → `.../invoice/Y`):
 *   - `data` лишається старим до завершення нового fetch — але він
 *     **відкидається** render-ом, бо його `paramSlug`/`paramInvoiceSlug` ≠
 *     поточних `params`. Користувач бачить spinner, не stale рахунок.
 *   - `handlePatch`/`handleDelete` працюють з local-data (capture у closure)
 *     — гарантовано мутують саме той рахунок, що ФОП бачив на екрані.
 * Без цього discriminator-у можна було зберегти/видалити не той інвойс,
 * якщо click трапився під час param-transition.
 *
 * **Preview-toggle (SP-2)** — той самий patern, що Sprint 3: prefetch public-
 * view одразу при mount-i, instant-toggle "Кабінет / Перегляд як клієнт".
 *
 * **Delete з 5s Undo** — `scheduleInvoiceDeleteWithUndo`. Optimistic redirect
 * на `/business/{slug}#invoices`, cancel-button у toast повертає на cabinet.
 */

interface LoadedData {
    paramSlug: string;
    paramInvoiceSlug: string;
    business: BusinessWithInvoicesCount;
    invoice: Invoice;
}

interface ErrorState {
    paramSlug: string;
    paramInvoiceSlug: string;
    code: string;
}

type PublicViewState =
    | { kind: 'idle' }
    | {
          kind: 'loaded';
          businessSlug: string;
          invoiceSlug: string;
          view: PublicInvoiceView;
      }
    | { kind: 'failed'; businessSlug: string; invoiceSlug: string };

function extractErrorCode(err: unknown): string {
    if (err instanceof AxiosError) {
        return (
            (err.response?.data as { error?: { code?: string } } | undefined)
                ?.error?.code ?? 'unknown'
        );
    }
    return 'unknown';
}

export default function InvoiceCabinetPage() {
    const router = useRouter();
    const params = useParams<{ slug: string; invoiceSlug: string }>();
    const openDeleteConfirm = useDeleteInvoiceConfirmStore((s) => s.open);

    const [data, setData] = useState<LoadedData | null>(null);
    const [error, setError] = useState<ErrorState | null>(null);
    const [previewMode, setPreviewMode] = useState(false);
    const [publicView, setPublicView] = useState<PublicViewState>({
        kind: 'idle',
    });

    const paramSlug = params.slug;
    const paramInvoiceSlug = params.invoiceSlug;

    // Parallel fetch business + invoice. State-mutation у async-callback (React 19
    // invariant — той самий, що Sprint 3 cabinet).
    useEffect(() => {
        if (!paramSlug || !paramInvoiceSlug) return;
        let cancelled = false;
        Promise.all([
            getBusinessBySlug(paramSlug),
            getInvoiceBySlug(paramSlug, paramInvoiceSlug),
        ])
            .then(([b, inv]) => {
                if (cancelled) return;
                setData({
                    paramSlug,
                    paramInvoiceSlug,
                    business: b,
                    invoice: inv,
                });
                setError(null);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                setError({
                    paramSlug,
                    paramInvoiceSlug,
                    code: extractErrorCode(err),
                });
            });
        return () => {
            cancelled = true;
        };
    }, [paramSlug, paramInvoiceSlug]);

    // Prefetch public-view для preview-toggle. Тригериться лише після того, як
    // `data` стає current-for-params — інакше pre-fetch стартував би на
    // stale-біз/інвойс після param-change.
    const isDataCurrent =
        data?.paramSlug === paramSlug &&
        data?.paramInvoiceSlug === paramInvoiceSlug;
    useEffect(() => {
        if (!data || !isDataCurrent) return;
        const businessSlug = data.business.slug;
        const invoiceSlug = data.invoice.slug;
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
    }, [data, isDataCurrent]);

    const handlePatch = useCallback(
        async (
            patch: UpdateInvoiceRequest,
            // Capture identifiers через closure — мутуємо саме ту invoice, що
            // користувач бачив на екрані під час click-у. Якщо параметри
            // route змінилися між render-ом і submit-ом, нові callback-и
            // отримають новий closure після re-render-у.
            captured: { businessSlug: string; invoiceSlug: string },
        ) => {
            try {
                const updated = await updateInvoice(
                    captured.businessSlug,
                    captured.invoiceSlug,
                    patch,
                );
                // Apply update тільки якщо state ще відповідає тому інвойсу,
                // що ми patch-нули. Якщо ФОП за час fetch-у перейшов на інший
                // — silently skip setData (інвойс уже не на екрані).
                setData((prev) =>
                    prev &&
                    prev.business.slug === captured.businessSlug &&
                    prev.invoice.slug === captured.invoiceSlug
                        ? { ...prev, invoice: updated }
                        : prev,
                );
                toast.success('Зміни збережено');
            } catch (err: unknown) {
                const msg = getApiMessage(extractErrorCode(err), 'invoices');
                toast.error(msg);
                throw new Error(msg);
            }
        },
        [],
    );

    if (!isDataCurrent && !error) {
        return (
            <UiPageContainer className="py-16">
                <div className="flex justify-center">
                    <UiSpinner size="md" />
                </div>
            </UiPageContainer>
        );
    }

    if (error && error.paramSlug === paramSlug &&
        error.paramInvoiceSlug === paramInvoiceSlug) {
        return <ErrorPage code={error.code} />;
    }
    if (!data || !isDataCurrent) {
        return (
            <UiPageContainer className="py-16">
                <div className="flex justify-center">
                    <UiSpinner size="md" />
                </div>
            </UiPageContainer>
        );
    }

    const { business, invoice } = data;
    const formattedAmount = formatKopecksAsHryvnia(invoice.amount);
    const publicUrl = `${ENV.NEXT_PUBLIC_PAY_PUBLIC_URL.replace(/\/$/, '')}/${business.slug}/${invoice.slug}`;

    const onSave = (patch: UpdateInvoiceRequest) =>
        handlePatch(patch, {
            businessSlug: business.slug,
            invoiceSlug: invoice.slug,
        });

    const handleDelete = () => {
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
    };

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
                    <AmountSection invoice={invoice} onSave={onSave} />
                    <PurposeSection
                        invoice={invoice}
                        business={business}
                        onSave={onSave}
                    />
                    <ValidUntilSection invoice={invoice} onSave={onSave} />
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
