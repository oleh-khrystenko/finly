'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { AxiosError } from 'axios';
import { toast } from 'sonner';
import {
    type AccountWithCounts,
    type AutoSlugMode,
    type BusinessWithCounts,
    type Invoice,
    type UpdateInvoiceRequest,
} from '@finly/types';
import {
    getAccountBySlug,
    getApiMessage,
    getBusinessBySlug,
    getInvoiceBySlug,
    resetInvoiceSlug,
    updateInvoice,
} from '@/shared/api';
import { OwnershipBadge } from '@/entities/business';
import { useAuthStore } from '@/entities/user';
import { ENV } from '@/shared/config/env';
import UiButton from '@/shared/ui/UiButton';
import UiBreadcrumb from '@/shared/ui/UiBreadcrumb';
import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSpinner from '@/shared/ui/UiSpinner';
import {
    PaymentDetailsCard,
    SlugSection,
    scheduleInvoiceDeleteWithUndo,
    useDeleteInvoiceConfirmStore,
} from '@/features/invoice-edit';

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
 * preview-mode.
 */

interface LoadedData {
    paramBiz: string;
    paramAcc: string;
    paramInv: string;
    business: BusinessWithCounts;
    account: AccountWithCounts;
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
    const userId = useAuthStore((s) => s.user?.id);
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
            getAccountBySlug(paramBiz, paramAcc),
            getInvoiceBySlug(paramBiz, paramAcc, paramInv),
        ])
            .then(([b, acc, inv]) => {
                if (cancelled) return;
                setData({
                    paramBiz,
                    paramAcc,
                    paramInv,
                    business: b,
                    account: acc,
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

    const { business, account, paramAcc: accountSlug, invoice } = data;

    const onSave = (patch: UpdateInvoiceRequest) =>
        handlePatch(patch, {
            businessSlug: business.slug,
            accountSlug,
            invoiceSlug: invoice.slug,
        });

    const handleResetSlug = async (mode: AutoSlugMode) => {
        const businessSlug = business.slug;
        const invoiceSlug = invoice.slug;
        try {
            const updated = await resetInvoiceSlug(
                businessSlug,
                accountSlug,
                invoiceSlug,
                mode
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
                <div className="flex items-center justify-between gap-3">
                    <UiBreadcrumb
                        items={[
                            { label: 'Усі отримувачі', href: '/business' },
                            {
                                label: 'Отримувач',
                                href: `/business/${business.slug}`,
                            },
                            {
                                label: 'Реквізити',
                                href: `/business/${business.slug}/account/${accountSlug}`,
                            },
                            { label: 'Рахунок' },
                        ]}
                    />
                    {userId && (
                        <OwnershipBadge isOwner={business.ownerId === userId} />
                    )}
                </div>
                <h1 className="text-foreground min-w-0 font-mono text-3xl font-bold tracking-tight break-all md:text-4xl">
                    {invoice.slug}
                </h1>
            </div>

            <div className="space-y-4">
                <SlugSection
                    invoice={invoice}
                    businessSlug={business.slug}
                    accountSlug={accountSlug}
                    payPublicOrigin={ENV.NEXT_PUBLIC_PAY_PUBLIC_URL}
                    accessSuspended={business.accessBlockedAt != null}
                    defaultMode={account.invoiceSlugPresetDefault}
                    onSave={onSave}
                    onResetSlug={handleResetSlug}
                />
                <PaymentDetailsCard
                    invoice={invoice}
                    business={business}
                    onSave={onSave}
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
                            Видалити рахунок
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
            ? 'Рахунок не знайдено'
            : code === 'ACCOUNT_NOT_FOUND'
              ? 'Реквізити не знайдено'
              : code === 'BUSINESS_NOT_FOUND'
                ? 'Отримувача не знайдено'
                : code === 'BUSINESS_ACCESS_DENIED'
                  ? 'У вас немає доступу до цього отримувача'
                  : getApiMessage(code, 'invoices');

    return (
        <UiPageContainer className="space-y-6 py-12">
            <UiSectionCard title={message}>
                <p className="text-muted-foreground mt-2 text-sm">
                    Поверніться до отримувача і оберіть інші реквізити.
                </p>
                <div className="mt-4">
                    <UiButton
                        as="link"
                        href="/business"
                        variant="filled"
                        size="md"
                        IconLeft={<ArrowLeft />}
                    >
                        До списку отримувачів
                    </UiButton>
                </div>
            </UiSectionCard>
        </UiPageContainer>
    );
}
