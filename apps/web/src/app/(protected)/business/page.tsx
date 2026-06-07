'use client';

import { type ReactNode, useEffect, useState } from 'react';
import { Briefcase, Plus } from 'lucide-react';
import { AxiosError } from 'axios';
import {
    BUSINESS_TYPE_LABEL,
    type BusinessWithCounts,
} from '@finly/types';
import { getApiMessage, listBusinesses } from '@/shared/api';
import { taxIdFieldConfig } from '@/entities/business';
import { useAuthStore } from '@/entities/user';
import { usePendingDeletesStore } from '@/features/business-edit/pendingDeletesStore';
import UiButton from '@/shared/ui/UiButton';
import UiNavCard from '@/shared/ui/UiNavCard';
import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiPageHeading from '@/shared/ui/UiPageHeading';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSpinner from '@/shared/ui/UiSpinner';

function extractApiErrorCode(err: unknown): string {
    if (!(err instanceof AxiosError)) return 'unknown';
    const data = err.response?.data as { error?: { code?: string } } | undefined;
    return data?.error?.code ?? 'unknown';
}

/**
 * Sprint 3 §3.6 — список бізнесів.
 *
 * **Client Component** (sprint plan §3.6 інваріант): auth — in-memory access
 * token, недоступний у Server Components без окремого refresh-flow proxy.
 * Filtering за `worksAsBookkeeper` робить backend (`getOwnedAndManaged` —
 * §3.2); frontend не дублює.
 *
 * Empty/filled states з різним текстом для bookkeeper-режиму, щоб ФОП не
 * плутався, чому "його" бізнес не видно.
 */
export default function BusinessListPage() {
    const isBookkeeper = useAuthStore(
        (s) => s.user?.worksAsBookkeeper ?? false
    );
    const [items, setItems] = useState<BusinessWithCounts[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    // Optimistic delete-removal (Sprint 3 §3.8 §C2). pendingDeletes-store
    // ловить slugs, що в межах 5s-undo-вікна; UI ховає їх до того, як
    // фактичний DELETE спрацює.
    const pendingDeleteSlugs = usePendingDeletesStore((s) => s.slugs);

    // Re-fetch при перемиканні toggle — backend filter залежить від
    // `worksAsBookkeeper` стану user-а. State-mutation тільки в async-callback-ах
    // (.then/.catch) — синхронний reset перед fetch порушує react-hooks/
    // set-state-in-effect (React 19) і без нього UX навіть кращий: items
    // залишаються видимими під час фонового re-fetch (stale-while-revalidate),
    // без flash спінера. Initial mount — `items === null` показує спінер до
    // першої відповіді.
    useEffect(() => {
        let cancelled = false;
        listBusinesses()
            .then((res) => {
                if (cancelled) return;
                setItems(res);
                setError(null);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                setError(getApiMessage(extractApiErrorCode(err), 'businesses'));
            });
        return () => {
            cancelled = true;
        };
    }, [isBookkeeper]);

    if (items === null && !error) {
        return (
            <UiPageContainer className="py-16">
                <div className="flex justify-center">
                    <UiSpinner size="md" />
                </div>
            </UiPageContainer>
        );
    }

    const visibleItems = (items ?? []).filter(
        (i) => !pendingDeleteSlugs.has(i.slug)
    );
    const isEmpty = visibleItems.length === 0;

    return (
        <UiPageContainer className="space-y-6 py-10 md:py-14">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <UiPageHeading>Отримувачі</UiPageHeading>
                {!isEmpty && (
                    <CreateBusinessButton>Створити отримувача</CreateBusinessButton>
                )}
            </div>

            {error && (
                <UiSectionCard title="Не вдалося завантажити">
                    <p className="text-muted-foreground mt-2 text-sm">
                        {error}
                    </p>
                </UiSectionCard>
            )}

            {isEmpty && !error && <EmptyState isBookkeeper={isBookkeeper} />}

            {!isEmpty && (
                <BusinessGrid items={visibleItems} isBookkeeper={isBookkeeper} />
            )}
        </UiPageContainer>
    );
}

function EmptyState({ isBookkeeper }: { isBookkeeper: boolean }) {
    const title = isBookkeeper
        ? 'У вас поки немає отримувачів клієнтів'
        : 'У вас поки немає отримувачів';
    const description = isBookkeeper
        ? 'Додайте отримувача клієнта, щоб згенерувати посилання на оплату для нього'
        : 'Створіть першого отримувача, щоб згенерувати посилання на оплату';
    const ctaLabel = isBookkeeper
        ? 'Додати отримувача клієнта'
        : 'Створити першого отримувача';

    return (
        <div className="border-border bg-card flex flex-col items-center gap-4 rounded-xl border p-10 text-center md:p-16">
            <div className="bg-muted text-muted-foreground flex size-16 items-center justify-center rounded-full">
                <Briefcase className="size-8" />
            </div>
            <div className="space-y-1">
                <h2 className="text-foreground text-lg font-semibold">
                    {title}
                </h2>
                <p className="text-muted-foreground max-w-md text-sm">
                    {description}
                </p>
            </div>
            <CreateBusinessButton>{ctaLabel}</CreateBusinessButton>
        </div>
    );
}

/**
 * Кнопка-перехід на `/business/new`. Використовуємо `as="link"` (anchor-семантика
 * для middle/Ctrl-click → нова вкладка, контекстного меню, hover-URL); pending-
 * спінер під час client-side навігації приходить безкоштовно з `useLinkStatus`
 * усередині `UiButton`.
 */
function CreateBusinessButton({ children }: { children: ReactNode }) {
    return (
        <UiButton
            as="link"
            href="/business/new"
            variant="filled"
            size="md"
            IconLeft={<Plus />}
        >
            {children}
        </UiButton>
    );
}

function BusinessGrid({
    items,
    isBookkeeper,
}: {
    items: BusinessWithCounts[];
    isBookkeeper: boolean;
}) {
    return (
        <div className="grid gap-4 sm:grid-cols-2">
            {items.map((business) => (
                <BusinessCard
                    key={business.id}
                    business={business}
                    isBookkeeper={isBookkeeper}
                />
            ))}
        </div>
    );
}

function BusinessCard({
    business,
    isBookkeeper,
}: {
    business: BusinessWithCounts;
    isBookkeeper: boolean;
}) {
    const typeLabel = BUSINESS_TYPE_LABEL[business.type];
    const { accountsCount, invoicesCount } = business;
    // Type-aware податковий код: «РНОКПП» для individual/fop, «ЄДРПОУ» для
    // tov/organization — той самий single-source label, що у формі створення
    // та cabinet-edit (`taxIdFieldConfig`), щоб копія не дрейфувала.
    const taxIdLabel = taxIdFieldConfig(business.type).label;
    // Sprint 9 §Risk #7 mitigation — два counter-и (реквізити + рахунки усього)
    // на business-картці, щоб ФОП розумів обсяг без drill-down-у у per-account-page.
    return (
        <UiNavCard
            href={`/business/${business.slug}${accountsCount > 0 ? '#accounts' : ''}`}
            ariaLabel={`Відкрити отримувача ${business.name}`}
            eyebrow={typeLabel}
            badge={isBookkeeper ? <CardBadge>Клієнтський</CardBadge> : undefined}
            title={business.name}
            titleAttr={business.name}
            meta={
                <>
                    <p>
                        {taxIdLabel}:{' '}
                        <span className="text-foreground font-mono">
                            {business.taxId}
                        </span>
                    </p>
                    <p>
                        Реквізити:{' '}
                        <CountValue count={accountsCount} />
                    </p>
                    <p>
                        Рахунки: <CountValue count={invoicesCount} />
                    </p>
                </>
            }
        />
    );
}

/**
 * Значення лічильника: біле (`text-foreground`) коли є що показати, сіре
 * (успадковане muted) на нулі — порожнє не підсвічуємо.
 */
function CountValue({ count }: { count: number }) {
    return (
        <span className={count > 0 ? 'text-foreground' : undefined}>
            {count} шт
        </span>
    );
}

/** Нейтральний pill-бейдж для top-right слота навігаційної картки. */
function CardBadge({ children }: { children: ReactNode }) {
    return (
        <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium">
            {children}
        </span>
    );
}
