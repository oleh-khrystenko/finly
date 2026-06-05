'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { AxiosError } from 'axios';
import { toast } from 'sonner';
import {
    deriveAccountLabel,
    type AccountWithCounts,
    type BusinessWithCounts,
    type UpdateAccountRequest,
} from '@finly/types';
import {
    getAccountBySlug,
    getApiMessage,
    getBusinessBySlug,
    resetAccountSlug,
    updateAccount,
} from '@/shared/api';
import { ENV } from '@/shared/config/env';
import UiButton from '@/shared/ui/UiButton';
import UiBreadcrumb from '@/shared/ui/UiBreadcrumb';
import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSpinner from '@/shared/ui/UiSpinner';
import {
    DangerSection,
    EditableAccountName,
    InvoicesSection,
    PublicSection,
    QrSection,
    RequisitesSection,
    scheduleAccountDeleteWithUndo,
    useDeleteAccountConfirmStore,
} from '@/features/account-edit';

/**
 * Sprint 9 §9.2 §6 — кабінет рахунку
 * `/business/{slug}/account/{accountSlug}`.
 *
 * **Секції** (порядок: share-артефакти → робочий контент → довідка → danger):
 *  1. PublicSection (посилання на публічну сторінку рахунку + slug-edit)
 *  2. QrSection (рівно 2 NBU QR — primary + legacy — + URL-код)
 *  3. InvoicesSection (список інвойсів + gear-меню нумерації у хедері)
 *  4. RequisitesSection (банк-label + IBAN readonly + copy; об'єднана)
 *  5. DangerSection (cascade-видалення з confirm-dialog)
 *
 * **Delete-flow:** `<DeleteAccountConfirmDialog>` → confirm → `schedule...WithUndo`
 * з optimistic redirect на `/business/{slug}` (де AccountsSection автоматично
 * ховає картку через `pendingAccountDeletesStore`). Коли у реквізитах є рахунки,
 * dialog вимагає ввести їхню кількість (cascade-gate).
 *
 * **State-discriminator (review fix)** — `data: { paramBiz, paramAcc, business,
 * account } | null` — race-protection при швидкому переході між кабінетами
 * різних account-ів (того самого або різних бізнесів).
 */

interface LoadedData {
    paramBiz: string;
    paramAcc: string;
    business: BusinessWithCounts;
    account: AccountWithCounts;
}

interface ErrorState {
    paramBiz: string;
    paramAcc: string;
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

export default function AccountCabinetPage() {
    const router = useRouter();
    const params = useParams<{ slug: string; accountSlug: string }>();
    const openDeleteConfirm = useDeleteAccountConfirmStore((s) => s.open);

    const [data, setData] = useState<LoadedData | null>(null);
    const [error, setError] = useState<ErrorState | null>(null);

    const paramBiz = params.slug;
    const paramAcc = params.accountSlug;

    useEffect(() => {
        if (!paramBiz || !paramAcc) return;
        let cancelled = false;
        Promise.all([
            getBusinessBySlug(paramBiz),
            getAccountBySlug(paramBiz, paramAcc),
        ])
            .then(([b, a]) => {
                if (cancelled) return;
                setData({
                    paramBiz,
                    paramAcc,
                    business: b,
                    account: a,
                });
                setError(null);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                setError({
                    paramBiz,
                    paramAcc,
                    code: extractErrorCode(err),
                });
            });
        return () => {
            cancelled = true;
        };
    }, [paramBiz, paramAcc]);

    const handlePatch = useCallback(
        async (
            patch: UpdateAccountRequest,
            captured: { businessSlug: string; accountSlug: string }
        ) => {
            try {
                const updated = await updateAccount(
                    captured.businessSlug,
                    captured.accountSlug,
                    patch
                );
                setData((prev) =>
                    prev &&
                    prev.business.slug === captured.businessSlug &&
                    prev.account.slug === captured.accountSlug
                        ? {
                              ...prev,
                              account: {
                                  ...updated,
                                  invoicesCount: prev.account.invoicesCount,
                              },
                          }
                        : prev
                );
                // Sprint 15 — slug-rename змінює canonical URL; старий
                // `/business/{biz}/account/{old}` стає stale. `replace` веде на
                // новий slug без stale-запису в history (дзеркало business-page).
                if (updated.slug !== captured.accountSlug) {
                    router.replace(
                        `/business/${captured.businessSlug}/account/${updated.slug}`
                    );
                }
                toast.success('Зміни збережено');
            } catch (err: unknown) {
                const msg = getApiMessage(extractErrorCode(err), 'accounts');
                toast.error(msg);
                throw new Error(msg);
            }
        },
        [router]
    );

    const isDataCurrent =
        data?.paramBiz === paramBiz && data?.paramAcc === paramAcc;

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
        error.paramAcc === paramAcc
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

    const { business, account } = data;

    const onSaveAccount = (patch: UpdateAccountRequest) =>
        handlePatch(patch, {
            businessSlug: business.slug,
            accountSlug: account.slug,
        });

    const handleResetSlug = async () => {
        const businessSlug = business.slug;
        const accountSlug = account.slug;
        try {
            const updated = await resetAccountSlug(businessSlug, accountSlug);
            setData((prev) =>
                prev &&
                prev.business.slug === businessSlug &&
                prev.account.slug === accountSlug
                    ? {
                          ...prev,
                          account: {
                              ...updated,
                              invoicesCount: prev.account.invoicesCount,
                          },
                      }
                    : prev
            );
            router.replace(`/business/${businessSlug}/account/${updated.slug}`);
            toast.success('Згенеровано нове посилання');
        } catch (err) {
            toast.error(getApiMessage(extractErrorCode(err), 'accounts'));
        }
    };

    const last4 = account.iban.slice(-4);

    const handleDelete = () => {
        openDeleteConfirm(account, account.invoicesCount, () => {
            scheduleAccountDeleteWithUndo({
                businessSlug: business.slug,
                accountSlug: account.slug,
                name: deriveAccountLabel({
                    name: account.name,
                    bankCode: account.bankCode,
                    ibanMask: `•${last4}`,
                }),
                onScheduled: () =>
                    router.replace(`/business/${business.slug}`),
                onCancelled: () =>
                    router.replace(
                        `/business/${business.slug}/account/${account.slug}`
                    ),
            });
        });
    };

    return (
        <UiPageContainer className="space-y-6 py-8 md:py-12">
            <div className="flex flex-col gap-4">
                <UiBreadcrumb
                    items={[
                        { label: 'Усі бізнеси', href: '/business' },
                        { label: 'Бізнес', href: `/business/${business.slug}` },
                        { label: 'Реквізити' },
                    ]}
                />
                <EditableAccountName
                    account={account}
                    onSave={(name) => onSaveAccount({ name })}
                />
            </div>

            <div className="space-y-4">
                <PublicSection
                    account={account}
                    businessSlug={business.slug}
                    payPublicOrigin={ENV.NEXT_PUBLIC_PAY_PUBLIC_URL}
                    onSave={onSaveAccount}
                    onResetSlug={handleResetSlug}
                />
                <QrSection account={account} businessSlug={business.slug} />
                <InvoicesSection
                    businessSlug={business.slug}
                    accountSlug={account.slug}
                    businessPaymentPurposeTemplate={
                        business.paymentPurposeTemplate
                    }
                    payPublicOrigin={ENV.NEXT_PUBLIC_PAY_PUBLIC_URL}
                    invoiceSlugPresetDefault={account.invoiceSlugPresetDefault}
                    onSavePreset={(preset) =>
                        onSaveAccount({ invoiceSlugPresetDefault: preset })
                    }
                />
                <RequisitesSection account={account} />
                <DangerSection onDelete={handleDelete} />
            </div>
        </UiPageContainer>
    );
}

function ErrorPage({ code }: { code: string }) {
    const message =
        code === 'ACCOUNT_NOT_FOUND' || code === 'NOT_FOUND'
            ? 'Реквізити не знайдено'
            : code === 'ACCOUNT_ACCESS_DENIED'
              ? 'У вас немає доступу до цих реквізитів'
              : code === 'BUSINESS_NOT_FOUND'
                ? 'Бізнес не знайдено'
                : code === 'BUSINESS_ACCESS_DENIED'
                  ? 'У вас немає доступу до цього бізнесу'
                  : getApiMessage(code, 'accounts');

    return (
        <UiPageContainer className="space-y-6 py-12">
            <UiSectionCard title={message}>
                <p className="text-muted-foreground mt-2 text-sm">
                    Поверніться до бізнесу і оберіть інші реквізити.
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
