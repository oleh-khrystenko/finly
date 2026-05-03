'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Briefcase, Plus } from 'lucide-react';
import { AxiosError } from 'axios';
import {
    BUSINESS_TYPE_LABEL,
    type Business,
} from '@finly/types';
import { getApiMessage, listBusinesses } from '@/shared/api';
import { ENV } from '@/shared/config/env';
import { useAuthStore } from '@/entities/user';
import { usePendingDeletesStore } from '@/features/business-edit/pendingDeletesStore';
import UiButton from '@/shared/ui/UiButton';
import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiPageHeading from '@/shared/ui/UiPageHeading';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSpinner from '@/shared/ui/UiSpinner';

function stripScheme(url: string): string {
    return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
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
    const user = useAuthStore((s) => s.user);
    const isBookkeeper = user?.worksAsBookkeeper ?? false;

    const [items, setItems] = useState<Business[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    // Optimistic delete-removal (Sprint 3 §3.8 §C2). pendingDeletes-store
    // ловить slugs, що в межах 5s-undo-вікна; UI ховає їх до того, як
    // фактичний DELETE спрацює. Subscribe-селектор повертає Set, useState
    // re-render при change.
    const pendingDeleteSlugs = usePendingDeletesStore((s) => s.slugs);

    const payHost = useMemo(
        () => stripScheme(ENV.NEXT_PUBLIC_PAY_PUBLIC_URL),
        [],
    );

    const visibleItems = useMemo(
        () =>
            items ? items.filter((i) => !pendingDeleteSlugs.has(i.slug)) : null,
        [items, pendingDeleteSlugs],
    );

    useEffect(() => {
        let cancelled = false;
        setItems(null);
        setError(null);
        listBusinesses()
            .then((res) => {
                if (!cancelled) setItems(res);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                const code =
                    err instanceof AxiosError
                        ? ((err.response?.data as
                              | { error?: { code?: string } }
                              | undefined)?.error?.code ?? 'unknown')
                        : 'unknown';
                setError(getApiMessage(code, 'businesses'));
            });
        return () => {
            cancelled = true;
        };
        // Re-fetch при перемиканні toggle — backend filter залежить від
        // `worksAsBookkeeper` стану user-а.
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

    return (
        <UiPageContainer className="space-y-8 py-12 md:py-16">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <UiPageHeading>Бізнеси</UiPageHeading>
                {visibleItems && visibleItems.length > 0 && (
                    <UiButton
                        as="link"
                        href="/business/new"
                        variant="filled"
                        size="md"
                        IconLeft={<Plus />}
                    >
                        Створити бізнес
                    </UiButton>
                )}
            </div>

            {error && (
                <UiSectionCard title="Не вдалося завантажити">
                    <p className="text-muted-foreground mt-2 text-sm">
                        {error}
                    </p>
                </UiSectionCard>
            )}

            {visibleItems && visibleItems.length === 0 && !error && (
                <EmptyState isBookkeeper={isBookkeeper} />
            )}

            {visibleItems && visibleItems.length > 0 && (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {visibleItems.map((b) => (
                        <BusinessCard
                            key={b.id}
                            business={b}
                            isBookkeeper={isBookkeeper}
                            payHost={payHost}
                        />
                    ))}
                </div>
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
            <UiButton
                as="link"
                href="/business/new"
                variant="filled"
                size="md"
                IconLeft={<Plus />}
            >
                {ctaLabel}
            </UiButton>
        </div>
    );
}

function BusinessCard({
    business,
    isBookkeeper,
    payHost,
}: {
    business: Business;
    isBookkeeper: boolean;
    payHost: string;
}) {
    const typeLabel = BUSINESS_TYPE_LABEL[business.type];
    return (
        <UiSectionCard
            title={business.name}
            headerRight={
                isBookkeeper ? (
                    <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium">
                        Клієнтський
                    </span>
                ) : undefined
            }
            className="flex flex-col gap-4 p-5 md:p-6"
        >
            <div className="space-y-1">
                <p className="text-muted-foreground text-xs">{typeLabel}</p>
                <p className="text-muted-foreground truncate text-xs">
                    {payHost}/
                    <span className="text-foreground font-mono">
                        {business.slug}
                    </span>
                </p>
            </div>
            <UiButton
                as="link"
                href={`/business/${business.slug}`}
                variant="outline"
                size="sm"
                IconRight={<ArrowRight />}
                className="w-full justify-center"
            >
                Відкрити
            </UiButton>
        </UiSectionCard>
    );
}
