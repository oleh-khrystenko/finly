'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ExternalLink, Trash2 } from 'lucide-react';
import { AxiosError } from 'axios';
import { toast } from 'sonner';
import {
    BUSINESS_TYPE_LABEL,
    type UpdateBusinessRequest,
} from '@finly/types';
import {
    getApiMessage,
    getBusinessBySlug,
    updateBusiness,
} from '@/shared/api';
import type { BusinessWithCounts } from '@finly/types';
import { ENV } from '@/shared/config/env';
import UiButton from '@/shared/ui/UiButton';
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
                toast.success('Зміни збережено');
            } catch (err) {
                const code =
                    err instanceof AxiosError
                        ? ((
                              err.response?.data as
                                  | { error?: { code?: string } }
                                  | undefined
                          )?.error?.code ?? 'unknown')
                        : 'unknown';
                const msg = getApiMessage(code, 'businesses');
                toast.error(msg);
                throw new Error(msg);
            }
        },
        [business]
    );

    const handleDelete = useCallback(() => {
        if (!business) return;
        const slug = business.slug;
        const name = business.name;
        // Sprint 4 §SP-5 + Sprint 9: cascade видаляє Account + Invoice +
        // InvoiceSlugCounter. `invoicesCount` — total за бізнес (всі рахунки),
        // показуємо у confirm-dialog як cascade-warning.
        openDeleteConfirm(business, business.invoicesCount, () => {
            scheduleDeleteWithUndo({
                slug,
                name,
                onScheduled: () => router.replace('/business'),
                onCancelled: () => router.replace(`/business/${slug}`),
            });
        });
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

    const publicUrl = `${ENV.NEXT_PUBLIC_PAY_PUBLIC_URL.replace(/\/$/, '')}/${business.slug}`;
    const typeLabel = BUSINESS_TYPE_LABEL[business.type];

    return (
        <UiPageContainer className="space-y-6 py-8 md:py-12">
            {/* Top toolbar: back-link, heading, open-tab. */}
            <div className="flex flex-col gap-4">
                <UiButton
                    as="link"
                    href="/business"
                    variant="text"
                    size="sm"
                    IconLeft={<ArrowLeft />}
                    className="self-start px-0"
                >
                    Назад до списку
                </UiButton>
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 w-full flex-col gap-1">
                        <p className="text-muted-foreground text-xl font-medium">
                            {typeLabel}
                        </p>
                        <EditableBusinessName
                            name={business.name}
                            onSave={(name) => handlePatch({ name })}
                        />
                    </div>
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
                <RequisitesCard business={business} onSave={handlePatch} />
                <PublicSection
                    business={business}
                    payPublicOrigin={ENV.NEXT_PUBLIC_PAY_PUBLIC_URL}
                    onSave={handlePatch}
                />
                <AccountsSection businessSlug={business.slug} />

                {/* Danger zone */}
                <UiSectionCard title="Небезпечна зона">
                    <p className="text-muted-foreground mt-2 text-base">
                        Видалення повне і незворотне. Усі рахунки і виставлені
                        інвойси цього бізнесу будуть видалені. Клієнти, які
                        мають збережене посилання, не зможуть оплатити.
                    </p>
                    <div className="mt-4">
                        <UiButton
                            type="button"
                            variant="destructive-outline"
                            size="md"
                            onClick={handleDelete}
                            IconLeft={<Trash2 />}
                        >
                            Видалити бізнес
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
            ? 'Бізнес не знайдено'
            : code === 'BUSINESS_ACCESS_DENIED'
              ? 'У вас немає доступу до цього бізнесу'
              : getApiMessage(code, 'businesses');

    return (
        <UiPageContainer className="space-y-6 py-12">
            <UiSectionCard title={message}>
                <p className="text-muted-foreground mt-2 text-sm">
                    Поверніться до списку бізнесів і оберіть інший.
                </p>
                <div className="mt-4">
                    <UiButton
                        as="link"
                        href="/business"
                        variant="filled"
                        size="md"
                        IconLeft={<ArrowLeft />}
                    >
                        Повернутись до моїх бізнесів
                    </UiButton>
                </div>
            </UiSectionCard>
        </UiPageContainer>
    );
}
