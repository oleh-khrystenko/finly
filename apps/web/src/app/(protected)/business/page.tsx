'use client';

import { type ReactNode, useEffect, useState } from 'react';
import {
    ArrowRight,
    Briefcase,
    CreditCard,
    ExternalLink,
    FileText,
    Plus,
} from 'lucide-react';
import { AxiosError } from 'axios';
import {
    BUSINESS_TYPE_LABEL,
    type BusinessWithCounts,
} from '@finly/types';
import { getApiMessage, listBusinesses } from '@/shared/api';
import { ENV } from '@/shared/config/env';
import { useAuthStore } from '@/entities/user';
import { usePendingDeletesStore } from '@/features/business-edit/pendingDeletesStore';
import UiButton from '@/shared/ui/UiButton';
import UiLink from '@/shared/ui/UiLink';
import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiPageHeading from '@/shared/ui/UiPageHeading';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSpinner from '@/shared/ui/UiSpinner';

// `PAY_ORIGIN` — повний `https://pay.finly.com.ua` для href справжнього посилання.
// `PAY_HOST` — той самий host без схеми для display ("чистий" вигляд). Обчислюємо
// один раз на module-load (ENV frozen).
const PAY_ORIGIN = ENV.NEXT_PUBLIC_PAY_PUBLIC_URL.replace(/\/$/, '');
const PAY_HOST = PAY_ORIGIN.replace(/^https?:\/\//, '');

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
        <UiPageContainer className="space-y-8 py-12 md:py-16">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <UiPageHeading>Бізнеси</UiPageHeading>
                {!isEmpty && (
                    <CreateBusinessButton>Створити бізнес</CreateBusinessButton>
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
        ? 'У вас поки немає клієнтських бізнесів'
        : 'У вас поки немає бізнесів';
    const description = isBookkeeper
        ? 'Додайте бізнес клієнта, щоб згенерувати посилання на оплату для нього'
        : 'Створіть перший бізнес, щоб згенерувати посилання на оплату';
    const ctaLabel = isBookkeeper
        ? 'Додати бізнес клієнта'
        : 'Створити перший бізнес';

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
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
    const publicHref = `${PAY_ORIGIN}/${business.slug}`;
    // Sprint 9 §Risk #7 mitigation — два counter-и (рахунки + інвойси усього)
    // на business-картці, щоб ФОП з 1 рахунком розумів обсяг без drill-down-у
    // у per-account-page.
    return (
        <article className="border-border bg-card hover:border-foreground/15 flex flex-col gap-3 rounded-xl border p-5 transition-colors md:p-6">
            <div className="flex items-center justify-between gap-2">
                <p className="text-muted-foreground truncate text-xs font-medium">
                    {typeLabel}
                </p>
                {isBookkeeper && (
                    <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium">
                        Клієнтський
                    </span>
                )}
            </div>

            <h2
                className="text-foreground line-clamp-2 text-base leading-snug font-semibold break-words"
                title={business.name}
            >
                {business.name}
            </h2>

            <UiLink
                href={publicHref}
                target="_blank"
                rel="noopener noreferrer"
                variant="muted"
                aria-label={`Відкрити публічну сторінку ${business.name} у новій вкладці`}
                className="group inline-flex min-w-0 items-center gap-1.5 text-xs"
            >
                <span className="truncate">
                    {PAY_HOST}/
                    <span className="text-foreground font-mono">
                        {business.slug}
                    </span>
                </span>
                <ExternalLink
                    aria-hidden
                    className="size-3.5 shrink-0 opacity-60 transition-opacity group-hover:opacity-100"
                />
            </UiLink>

            <div className="mt-auto flex flex-col gap-3 pt-2">
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                    <p className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                        <CreditCard className="size-3.5" aria-hidden />
                        Реквізити: {accountsCount} шт
                    </p>
                    {invoicesCount > 0 && (
                        <p className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                            <FileText className="size-3.5" aria-hidden />
                            Рахунки: {invoicesCount} шт
                        </p>
                    )}
                </div>
                <UiButton
                    as="link"
                    href={`/business/${business.slug}${
                        accountsCount > 0 ? '#accounts' : ''
                    }`}
                    variant="outline"
                    size="sm"
                    IconRight={<ArrowRight />}
                    className="w-full justify-center"
                >
                    Відкрити
                </UiButton>
            </div>
        </article>
    );
}
