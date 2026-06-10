'use client';

import { type ReactNode, useEffect, useState } from 'react';
import { Briefcase, Plus } from 'lucide-react';
import { BUSINESS_TYPE_LABEL, type BusinessWithCounts } from '@finly/types';
import {
    extractApiErrorCode,
    getApiMessage,
    listBusinesses,
} from '@/shared/api';
import { taxIdFieldConfig } from '@/entities/business';
import { useBookkeeperMode } from '@/entities/user';
import { usePendingDeletesStore } from '@/features/business-edit/pendingDeletesStore';
import UiButton from '@/shared/ui/UiButton';
import UiChipGroup from '@/shared/ui/UiChipGroup';
import UiNavCard from '@/shared/ui/UiNavCard';
import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiPageHeading from '@/shared/ui/UiPageHeading';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSpinner from '@/shared/ui/UiSpinner';

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
 *
 * Контекст «власні / клієнтські» перемикається segmented-control-ом
 * (`UiChipGroup`) над списком — `useBookkeeperMode` робить optimistic-flip
 * `worksAsBookkeeper` + PATCH. Прапор персистентний, тож вибір лишається
 * дефолтним контекстом на наступний логін.
 */
// Роль-фреймінг замість «Власні/Клієнтські»: новачок не мусить розуміти
// модель «отримувачів», він просто відповідає «хто я зараз». Рядок-підказка
// під табами пояснює активний контекст звичайною мовою (і ненав'язливо
// вчить, що «отримувач» = бізнес).
const CONTEXT_OPTIONS = [
    { value: 'own', label: 'Я власник' },
    { value: 'client', label: 'Я бухгалтер' },
];
const CONTEXT_HINT: Record<'own' | 'client', string> = {
    own: 'Бізнеси, якими ви володієте.',
    client: 'Бізнеси клієнтів, для яких ви ведете облік.',
};

export default function BusinessListPage() {
    const { isBookkeeper, setBookkeeper } = useBookkeeperMode();
    const [items, setItems] = useState<BusinessWithCounts[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    // Optimistic delete-removal (Sprint 3 §3.8 §C2). pendingDeletes-store
    // ловить slugs, що в межах 5s-undo-вікна; UI ховає їх до того, як
    // фактичний DELETE спрацює.
    const pendingDeleteSlugs = usePendingDeletesStore((s) => s.slugs);

    // Re-fetch при зміні контексту. Передаємо `context` явно у запит, щоб
    // GET не залежав від того, чи встиг паралельний PATCH `worksAsBookkeeper`
    // закомітитись — інакше read-after-write race лишав список у старому
    // контексті. `cancelled`-guard відкидає out-of-order відповіді при швидких
    // перемиканнях (застосовується лише результат останнього effect-у).
    //
    // State-mutation тільки в async-callback-ах (.then/.catch) — синхронний
    // reset перед fetch порушує react-hooks/set-state-in-effect (React 19) і
    // без нього UX кращий: items лишаються видимими під час фонового re-fetch
    // (stale-while-revalidate), без flash спінера. Initial mount —
    // `items === null` показує спінер до першої відповіді.
    const context = isBookkeeper ? 'client' : 'own';
    useEffect(() => {
        let cancelled = false;
        listBusinesses(context)
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
    }, [context]);

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
                    <CreateBusinessButton>
                        Створити отримувача
                    </CreateBusinessButton>
                )}
            </div>

            {/* Контекст списку: власні бізнеси (ownerId=я) проти клієнтських
                (ownerless, я в managers). Зміна сегмента = optimistic-flip
                worksAsBookkeeper + PATCH; backend фільтрує за прапором, тож
                цей же вибір персиститься як дефолтний контекст. */}
            <div className="space-y-2">
                <UiChipGroup
                    size="sm"
                    options={CONTEXT_OPTIONS}
                    value={context}
                    onChange={(value) => void setBookkeeper(value === 'client')}
                />
                <p className="text-muted-foreground text-sm" aria-live="polite">
                    {CONTEXT_HINT[context]}
                </p>
            </div>

            {error && (
                <UiSectionCard title="Не вдалося завантажити">
                    <p className="text-muted-foreground mt-2 text-sm">
                        {error}
                    </p>
                </UiSectionCard>
            )}

            {isEmpty && !error && <EmptyState isBookkeeper={isBookkeeper} />}

            {!isEmpty && <BusinessGrid items={visibleItems} />}
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

function BusinessGrid({ items }: { items: BusinessWithCounts[] }) {
    return (
        <div className="grid gap-4 sm:grid-cols-2">
            {items.map((business) => (
                <BusinessCard key={business.id} business={business} />
            ))}
        </div>
    );
}

function BusinessCard({ business }: { business: BusinessWithCounts }) {
    const typeLabel = BUSINESS_TYPE_LABEL[business.type];
    const { accountsCount, invoicesCount } = business;
    // Type-aware податковий код: «РНОКПП» для individual/fop, «ЄДРПОУ» для
    // tov/organization — той самий single-source label, що у формі створення
    // та cabinet-edit (`taxIdFieldConfig`), щоб копія не дрейфувала.
    const taxIdLabel = taxIdFieldConfig(business.type).label;
    // Sprint 19 — заблокований реконсиляцією бізнес: публічна сторінка і QR
    // погашені (backend), у кабінеті показуємо окремим станом «доступ
    // призупинено». Користувач може відкрити, щоб видалити, або поновити доступ.
    const blocked = business.accessBlockedAt != null;
    // Sprint 9 §Risk #7 mitigation — два counter-и (реквізити + рахунки усього)
    // на business-картці, щоб ФОП розумів обсяг без drill-down-у у per-account-page.
    return (
        <UiNavCard
            href={`/business/${business.slug}${accountsCount > 0 ? '#accounts' : ''}`}
            ariaLabel={`Відкрити отримувача ${business.name}`}
            eyebrow={typeLabel}
            title={business.name}
            titleAttr={business.name}
            surface={blocked ? 'muted' : 'card'}
            badge={
                blocked ? (
                    <span className="bg-warning/15 text-warning shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium">
                        Доступ призупинено
                    </span>
                ) : undefined
            }
            meta={
                <>
                    {blocked && (
                        <p className="text-warning">
                            Публічна сторінка неактивна. Поновіть доступ або
                            видаліть отримувача.
                        </p>
                    )}
                    <p>
                        {taxIdLabel}:{' '}
                        <span className="text-foreground font-mono">
                            {business.taxId}
                        </span>
                    </p>
                    <p>
                        Реквізити: <CountValue count={accountsCount} />
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
