'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ExternalLink, Trash2 } from 'lucide-react';
import { AxiosError } from 'axios';
import { toast } from 'sonner';
import {
    type BusinessWithCounts,
    type Invoice,
    type UpdateInvoiceRequest,
} from '@finly/types';
import {
    getApiMessage,
    getBusinessBySlug,
    getInvoiceBySlug,
    resetInvoiceSlug,
    updateInvoice,
} from '@/shared/api';
import { ENV } from '@/shared/config/env';
import UiButton from '@/shared/ui/UiButton';
import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSpinner from '@/shared/ui/UiSpinner';
import {
    AmountSection,
    InvoiceQrSection,
    PurposeSection,
    SlugSection,
    ValidUntilSection,
    scheduleInvoiceDeleteWithUndo,
    useDeleteInvoiceConfirmStore,
} from '@/features/invoice-edit';
import { formatKopecksAsHryvnia } from '@/entities/invoice';

/**
 * Sprint 4 §4.6 + Sprint 9 §SP-5 — кабінет інвойсу
 * `/business/{slug}/account/{accountSlug}/invoice/{invoiceSlug}`.
 *
 * **Sprint 9 матрьошка**: invoice nested під account. "Назад до рахунку"
 * посилання — на per-account-cabinet (`/business/{biz}/account/{acc}#invoices`).
 *
 * **Preview-toggle тимчасово відсутній**: `features/invoice-public/
 * InvoicePublicView` оновлюється у Sprint 9.3 (вимагає nested `account`-shape
 * у `PublicInvoiceView` view-type). До завершення 9.3 cabinet працює без
 * preview-mode — `"Відкрити в новій вкладці"` лишається як єдиний шлях
 * подивитися як побачить клієнт.
 */

interface LoadedData {
    paramBiz: string;
    paramAcc: string;
    paramInv: string;
    business: BusinessWithCounts;
    invoice: Invoice;
}

interface ErrorState {
    paramBiz: string;
    paramAcc: string;
    paramInv: string;
    code: string;
}

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
    const params = useParams<{
        slug: string;
        accountSlug: string;
        invoiceSlug: string;
    }>();
    const openDeleteConfirm = useDeleteInvoiceConfirmStore((s) => s.open);

    const [data, setData] = useState<LoadedData | null>(null);
    const [error, setError] = useState<ErrorState | null>(null);

    const paramBiz = params.slug;
    const paramAcc = params.accountSlug;
    const paramInv = params.invoiceSlug;

    useEffect(() => {
        if (!paramBiz || !paramAcc || !paramInv) return;
        let cancelled = false;
        Promise.all([
            getBusinessBySlug(paramBiz),
            getInvoiceBySlug(paramBiz, paramAcc, paramInv),
        ])
            .then(([b, inv]) => {
                if (cancelled) return;
                setData({
                    paramBiz,
                    paramAcc,
                    paramInv,
                    business: b,
                    invoice: inv,
                });
                setError(null);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                setError({
                    paramBiz,
                    paramAcc,
                    paramInv,
                    code: extractErrorCode(err),
                });
            });
        return () => {
            cancelled = true;
        };
    }, [paramBiz, paramAcc, paramInv]);

    const isDataCurrent =
        data?.paramBiz === paramBiz &&
        data?.paramAcc === paramAcc &&
        data?.paramInv === paramInv;

    const handlePatch = useCallback(
        async (
            patch: UpdateInvoiceRequest,
            captured: {
                businessSlug: string;
                accountSlug: string;
                invoiceSlug: string;
            }
        ) => {
            try {
                const updated = await updateInvoice(
                    captured.businessSlug,
                    captured.accountSlug,
                    captured.invoiceSlug,
                    patch
                );
                setData((prev) =>
                    prev &&
                    prev.business.slug === captured.businessSlug &&
                    prev.paramAcc === captured.accountSlug &&
                    prev.invoice.slug === captured.invoiceSlug
                        ? { ...prev, invoice: updated }
                        : prev
                );
                // Sprint 15 — slug-rename змінює canonical URL інвойсу; ведемо
                // на новий slug без stale-запису в history (дзеркало business).
                if (updated.slug !== captured.invoiceSlug) {
                    router.replace(
                        `/business/${captured.businessSlug}/account/${captured.accountSlug}/invoice/${updated.slug}`
                    );
                }
                toast.success('Зміни збережено');
            } catch (err: unknown) {
                const msg = getApiMessage(extractErrorCode(err), 'invoices');
                toast.error(msg);
                throw new Error(msg);
            }
        },
        [router]
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

    if (
        error &&
        error.paramBiz === paramBiz &&
        error.paramAcc === paramAcc &&
        error.paramInv === paramInv
    ) {
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

    const { business, paramAcc: accountSlug, invoice } = data;
    const formattedAmount = formatKopecksAsHryvnia(invoice.amount);
    const publicUrl = `${ENV.NEXT_PUBLIC_PAY_PUBLIC_URL.replace(/\/$/, '')}/${business.slug}/${accountSlug}/${invoice.slug}`;

    const onSave = (patch: UpdateInvoiceRequest) =>
        handlePatch(patch, {
            businessSlug: business.slug,
            accountSlug,
            invoiceSlug: invoice.slug,
        });

    const handleResetSlug = async () => {
        const businessSlug = business.slug;
        const invoiceSlug = invoice.slug;
        try {
            const updated = await resetInvoiceSlug(
                businessSlug,
                accountSlug,
                invoiceSlug
            );
            setData((prev) =>
                prev &&
                prev.business.slug === businessSlug &&
                prev.paramAcc === accountSlug &&
                prev.invoice.slug === invoiceSlug
                    ? { ...prev, invoice: updated }
                    : prev
            );
            router.replace(
                `/business/${businessSlug}/account/${accountSlug}/invoice/${updated.slug}`
            );
            toast.success('Згенеровано нове посилання');
        } catch (err) {
            toast.error(getApiMessage(extractErrorCode(err), 'invoices'));
        }
    };

    const handleDelete = () => {
        const businessSlug = business.slug;
        const invoiceSlug = invoice.slug;
        openDeleteConfirm(invoice, () => {
            scheduleInvoiceDeleteWithUndo({
                businessSlug,
                accountSlug,
                invoiceSlug,
                onScheduled: () =>
                    router.replace(
                        `/business/${businessSlug}/account/${accountSlug}#invoices`
                    ),
                onCancelled: () =>
                    router.replace(
                        `/business/${businessSlug}/account/${accountSlug}/invoice/${invoiceSlug}`
                    ),
            });
        });
    };

    return (
        <UiPageContainer className="space-y-6 py-8 md:py-12">
            <div className="flex flex-col gap-4">
                <UiButton
                    as="link"
                    href={`/business/${business.slug}/account/${accountSlug}#invoices`}
                    variant="text"
                    size="sm"
                    IconLeft={<ArrowLeft />}
                    className="self-start px-0"
                >
                    Назад до рахунку
                </UiButton>
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <h1 className="text-foreground min-w-0 text-2xl font-bold tracking-tight md:text-3xl">
                        Інвойс{' '}
                        <span className="font-mono break-all">
                            №{invoice.slug}
                        </span>
                        {formattedAmount && (
                            <>
                                {' '}
                                <span className="text-muted-foreground">—</span>{' '}
                                {formattedAmount}
                            </>
                        )}
                    </h1>
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
                    accountSlug={accountSlug}
                    payPublicOrigin={ENV.NEXT_PUBLIC_PAY_PUBLIC_URL}
                    onSave={onSave}
                    onResetSlug={handleResetSlug}
                />
                <InvoiceQrSection
                    invoice={invoice}
                    businessSlug={business.slug}
                    accountSlug={accountSlug}
                />

                <UiSectionCard title="Небезпечна зона" variant="destructive">
                    <p className="text-muted-foreground mt-2 text-sm">
                        Видалення повне і незворотне. Клієнт, що має збережене
                        посилання, не зможе оплатити.
                    </p>
                    <div className="mt-4">
                        <UiButton
                            type="button"
                            variant="destructive-outline"
                            size="md"
                            onClick={handleDelete}
                            IconLeft={<Trash2 />}
                        >
                            Видалити інвойс
                        </UiButton>
                    </div>
                </UiSectionCard>
            </div>
        </UiPageContainer>
    );
}

function ErrorPage({ code }: { code: string }) {
    const message =
        code === 'INVOICE_NOT_FOUND' || code === 'NOT_FOUND'
            ? 'Інвойс не знайдено'
            : code === 'ACCOUNT_NOT_FOUND'
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
