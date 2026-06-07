'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
    BUSINESS_TYPE_LABEL,
    type UpdateBusinessRequest,
} from '@finly/types';
import {
    extractApiErrorCode,
    getApiMessage,
    getBusinessBySlug,
    resetBusinessSlug,
    updateBusiness,
} from '@/shared/api';
import type { BusinessWithCounts } from '@finly/types';
import { ENV } from '@/shared/config/env';
import UiButton from '@/shared/ui/UiButton';
import UiBreadcrumb from '@/shared/ui/UiBreadcrumb';
import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSpinner from '@/shared/ui/UiSpinner';
import {
    AccountsSection,
    EditableBusinessName,
    PublicSection,
    RequisitesCard,
    scheduleDeleteWithUndo,
    useDeleteBusinessConfirmStore,
} from '@/features/business-edit';

/**
 * Sprint 3 §3.8 + Sprint 9 §SP-5 + Sprint 13 — кабінет бізнесу `/business/{slug}`.
 *
 * **Sprint 13 структура (5 елементів)**:
 *   1. Heading area — eyebrow (type) + `EditableBusinessName` (inline-edit h1)
 *      + "Відкрити в новій вкладці". Замінює стару BasicSection-картку, що
 *      повністю дублювала heading.
 *   2. `RequisitesCard` — merged-картка з трьома рядками: РНОКПП + (умовно
 *      для fop/tov) Оподаткування + Призначення переказу.
 *   3. PublicSection (slug, public URL).
 *   4. AccountsSection (cards-list рахунків + CTA "Додати рахунок").
 *   5. Danger zone — видалення бізнесу з cascade-toast.
 *
 * **`onSave` для taxId / taxation**: PATCH `/businesses/me/{slug}` приймає
 * top-level `taxId`. Backend reject-не зміну `taxId` якщо вона не відповідає
 * формату для типу (`tax_id_format_mismatch_type` 400).
 */
export default function BusinessSlugPage() {
    const router = useRouter();
    const params = useParams<{ slug: string }>();
    const openDeleteConfirm = useDeleteBusinessConfirmStore((s) => s.open);

    const [business, setBusiness] = useState<BusinessWithCounts | null>(null);
    const [error, setError] = useState<{ code: string } | null>(null);

    useEffect(() => {
        if (!params.slug) return;
        let cancelled = false;
        getBusinessBySlug(params.slug)
            .then((fetched) => {
                if (cancelled) return;
                setBusiness(fetched);
                setError(null);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                setError({ code: extractApiErrorCode(err) });
            });
        return () => {
            cancelled = true;
        };
    }, [params.slug]);

    const handlePatch = useCallback(
        async (patch: UpdateBusinessRequest) => {
            if (!business) return;
            try {
                const updated = await updateBusiness(business.slug, patch);
                // PATCH-endpoint повертає `Business` без `accountsCount` /
                // `invoicesCount` (counters не змінюються від settings-edit).
                // Зберігаємо старі значення.
                setBusiness({
                    ...updated,
                    accountsCount: business.accountsCount,
                    invoicesCount: business.invoicesCount,
                });
                // Sprint 14: якщо slug змінився — URL `/business/{old}` стає
                // stale (effect не re-fetch-не на тому самому params, refresh
                // дасть 404). `replace` не залишає старий URL у history.
                if (updated.slug !== business.slug) {
                    router.replace(`/business/${updated.slug}`);
                }
                toast.success('Зміни збережено');
            } catch (err) {
                const msg = getApiMessage(
                    extractApiErrorCode(err),
                    'businesses'
                );
                toast.error(msg);
                throw new Error(msg);
            }
        },
        [business, router]
    );

    const handleResetSlug = useCallback(async () => {
        if (!business) return;
        const currentSlug = business.slug;
        try {
            const updated = await resetBusinessSlug(currentSlug);
            setBusiness({
                ...updated,
                accountsCount: business.accountsCount,
                invoicesCount: business.invoicesCount,
            });
            router.replace(`/business/${updated.slug}`);
            toast.success('Згенеровано нове посилання');
        } catch (err) {
            toast.error(getApiMessage(extractApiErrorCode(err), 'businesses'));
        }
    }, [business, router]);

    const handleDelete = useCallback(() => {
        if (!business) return;
        const slug = business.slug;
        const name = business.name;
        // Cascade видаляє Account + Invoice + counters/history. Обидва
        // лічильники (total за бізнес) йдуть у confirm-dialog як cascade-gate.
        openDeleteConfirm(
            business,
            business.accountsCount,
            business.invoicesCount,
            () => {
                scheduleDeleteWithUndo({
                    slug,
                    name,
                    onScheduled: () => router.replace('/business'),
                    onCancelled: () => router.replace(`/business/${slug}`),
                });
            }
        );
    }, [business, openDeleteConfirm, router]);

    if (business === null && !error) {
        return (
            <UiPageContainer className="py-16">
                <div className="flex justify-center">
                    <UiSpinner size="md" />
                </div>
            </UiPageContainer>
        );
    }

    if (error) {
        return <ErrorPage code={error.code} />;
    }

    if (!business) return null;

    const typeLabel = BUSINESS_TYPE_LABEL[business.type];

    return (
        <UiPageContainer className="space-y-6 py-8 md:py-12">
            {/* Top toolbar: breadcrumb + identity heading. */}
            <div className="flex flex-col gap-4">
                <UiBreadcrumb
                    items={[
                        { label: 'Усі отримувачі', href: '/business' },
                        { label: 'Отримувач' },
                    ]}
                />
                <div className="flex min-w-0 flex-col gap-1">
                    <p className="text-muted-foreground text-xl font-semibold tracking-wide uppercase">
                        {typeLabel}
                    </p>
                    <EditableBusinessName
                        name={business.name}
                        onSave={(name) => handlePatch({ name })}
                    />
                </div>
            </div>

            <div className="space-y-4">
                <PublicSection
                    business={business}
                    payPublicOrigin={ENV.NEXT_PUBLIC_PAY_PUBLIC_URL}
                    onSave={handlePatch}
                    onResetSlug={handleResetSlug}
                />
                <AccountsSection businessSlug={business.slug} />
                <RequisitesCard business={business} onSave={handlePatch} />

                {/* Danger zone */}
                <UiSectionCard title="Небезпечна зона" variant="destructive">
                    <p className="text-muted-foreground mt-2 text-base">
                        Видалення повне і незворотне. Усі реквізити і
                        виставлені рахунки цього отримувача будуть видалені.
                        Клієнти, які мають збережене посилання, не зможуть
                        оплатити.
                    </p>
                    <div className="mt-4">
                        <UiButton
                            type="button"
                            variant="destructive-outline"
                            size="md"
                            onClick={handleDelete}
                            IconLeft={<Trash2 />}
                        >
                            Видалити отримувача
                        </UiButton>
                    </div>
                </UiSectionCard>
            </div>
        </UiPageContainer>
    );
}

function ErrorPage({ code }: { code: string }) {
    const message =
        code === 'BUSINESS_NOT_FOUND' || code === 'NOT_FOUND'
            ? 'Отримувача не знайдено'
            : code === 'BUSINESS_ACCESS_DENIED'
              ? 'У вас немає доступу до цього отримувача'
              : getApiMessage(code, 'businesses');

    return (
        <UiPageContainer className="space-y-6 py-12">
            <UiSectionCard title={message}>
                <p className="text-muted-foreground mt-2 text-sm">
                    Поверніться до списку отримувачів і оберіть іншого.
                </p>
                <div className="mt-4">
                    <UiButton
                        as="link"
                        href="/business"
                        variant="filled"
                        size="md"
                        IconLeft={<ArrowLeft />}
                    >
                        Повернутись до моїх отримувачів
                    </UiButton>
                </div>
            </UiSectionCard>
        </UiPageContainer>
    );
}
