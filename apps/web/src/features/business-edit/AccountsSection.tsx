'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, CreditCard, Plus, Trash2 } from 'lucide-react';
import { AxiosError } from 'axios';
import { toast } from 'sonner';
import {
    BANK_LABEL,
    type AccountWithCounts,
} from '@finly/types';
import { getApiMessage, listAccounts } from '@/shared/api';
import { pluralizeUa } from '@/shared/lib';
import UiButton from '@/shared/ui/UiButton';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSpinner from '@/shared/ui/UiSpinner';
import {
    scheduleAccountDeleteWithUndo,
    usePendingAccountDeletesStore,
} from '@/features/account-edit';

interface Props {
    businessSlug: string;
}

interface SectionData {
    paramSlug: string;
    items: AccountWithCounts[];
}

interface SectionError {
    paramSlug: string;
    message: string;
}

function extractMessage(err: unknown): string {
    const code =
        err instanceof AxiosError
            ? ((err.response?.data as { error?: { code?: string } } | undefined)
                  ?.error?.code ?? 'unknown')
            : 'unknown';
    return getApiMessage(code, 'accounts');
}

/**
 * Sprint 9 §9.2 — секція "Рахунки" на business-cabinet-page. Cards-list з
 * name + bank label + IBAN-mask + per-card "Видалити" + CTA "Додати рахунок".
 *
 * **Null-bankCode UI-rule (§SP-9 4-точок invariant):** bank-label-row
 * рендериться **лише** для `bankCode !== null` — не fallback на текст
 * "Невідомий банк". IBAN-mask `•{last4}` лишається як disambiguator.
 *
 * **Per-card delete:**
 *  - Pre-check `invoicesCount > 0` (§SP-3 two-line-of-defense) →
 *    `toast.error(ACCOUNT_HAS_INVOICES)` без 5s-timer і без actual delete-call-у.
 *  - `=== 0` → `scheduleAccountDeleteWithUndo(...)` (5s undo + actual DELETE).
 *  - **Без redirect-у** (на відміну від DangerSection account-page, що redirect-ить
 *    з per-account-page) — list уже на тій самій сторінці. `pendingAccountDeletesStore`
 *    синхронно ховає картку.
 *
 * **Optimistic-removal filter:** `usePendingAccountDeletesStore.keys.has(...)` —
 * filter-ить items, що у 5s-undo-вікні. На cancel картка повертається.
 */
export default function AccountsSection({ businessSlug }: Props) {
    const [data, setData] = useState<SectionData | null>(null);
    const [error, setError] = useState<SectionError | null>(null);
    const pendingDeleteKeys = usePendingAccountDeletesStore((s) => s.keys);

    useEffect(() => {
        let cancelled = false;
        listAccounts(businessSlug)
            .then((items) => {
                if (cancelled) return;
                setData({ paramSlug: businessSlug, items });
                setError(null);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                setError({
                    paramSlug: businessSlug,
                    message: extractMessage(err),
                });
            });
        return () => {
            cancelled = true;
        };
    }, [businessSlug]);

    const isCurrent = data?.paramSlug === businessSlug;
    const isErrorCurrent = error?.paramSlug === businessSlug;

    const visibleItems = useMemo(() => {
        if (!isCurrent || !data) return null;
        return data.items.filter(
            (a) => !pendingDeleteKeys.has(`${businessSlug}/${a.slug}`)
        );
    }, [isCurrent, data, pendingDeleteKeys, businessSlug]);

    const handleDelete = useCallback(
        (account: AccountWithCounts) => {
            if (account.invoicesCount > 0) {
                // Pre-resolved UA-plural через shared helper — той самий
                // patern, що backend `accounts.service.ts` (pluralizeUa
                // у `apps/api/src/common/intl/`). Consistency повідомлення
                // між frontend pre-check і backend race-fail-message.
                const phrase = pluralizeUa(
                    account.invoicesCount,
                    'виставлений інвойс',
                    'виставлені інвойси',
                    'виставлених інвойсів'
                );
                toast.error(
                    `Цей рахунок має ${phrase}. Спочатку видаліть їх або весь бізнес`
                );
                return;
            }
            scheduleAccountDeleteWithUndo({
                businessSlug,
                accountSlug: account.slug,
                name: account.name,
                onScheduled: () => {
                    /* per-card delete — без redirect-у, list стає на місці */
                },
                onCancelled: () => {
                    /* картка автоматично повертається через store-remove */
                },
            });
        },
        [businessSlug]
    );

    const createHref = `/business/${businessSlug}/account/new`;

    return (
        <UiSectionCard
            id="accounts"
            title="Рахунки"
            headerRight={
                visibleItems !== null && visibleItems.length > 0 ? (
                    <UiButton
                        as="link"
                        href={createHref}
                        variant="filled"
                        size="md"
                        IconLeft={<Plus />}
                    >
                        Додати рахунок
                    </UiButton>
                ) : undefined
            }
        >
            {visibleItems === null && !isErrorCurrent && (
                <div className="flex justify-center py-8">
                    <UiSpinner size="md" />
                </div>
            )}

            {isErrorCurrent && (
                <p className="text-destructive py-4 text-base">
                    {error?.message}
                </p>
            )}

            {visibleItems !== null &&
                visibleItems.length === 0 &&
                !isErrorCurrent && <EmptyState createHref={createHref} />}

            {visibleItems !== null && visibleItems.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                    {visibleItems.map((account) => (
                        <AccountCard
                            key={account.id}
                            account={account}
                            businessSlug={businessSlug}
                            onDelete={() => handleDelete(account)}
                        />
                    ))}
                </div>
            )}
        </UiSectionCard>
    );
}

interface CardProps {
    account: AccountWithCounts;
    businessSlug: string;
    onDelete: () => void;
}

function AccountCard({ account, businessSlug, onDelete }: CardProps) {
    const last4 = account.iban.slice(-4);
    const href = `/business/${businessSlug}/account/${account.slug}`;
    const invoicesLabel = pluralizeUa(
        account.invoicesCount,
        'інвойс',
        'інвойси',
        'інвойсів'
    );
    // Pattern symmetric Sprint 4 `features/account-edit/InvoiceCard`: уся
    // картка — звичайний контейнер, navigation — окрема кнопка "Відкрити".
    // Власне `<a>` за межами `shared/ui/` заборонено (`docs/conventions/
    // ui-primitives.md` Rule 1) — wrap-варіант через UiButton.
    return (
        <div className="border-border bg-card flex flex-col gap-3 rounded-lg border p-5">
            <div className="flex flex-1 flex-col gap-1">
                <p className="text-foreground text-xl font-semibold tracking-tight">
                    {account.name}
                </p>
                {account.bankCode !== null && (
                    <p className="text-muted-foreground text-base">
                        {BANK_LABEL[account.bankCode]}
                    </p>
                )}
                <p className="text-muted-foreground font-mono text-base">
                    •{last4}
                </p>
                <p className="text-muted-foreground mt-1.5 text-base">
                    {invoicesLabel}
                </p>
            </div>
            <div className="flex items-center gap-2 pt-1">
                <UiButton
                    type="button"
                    variant="destructive-outline"
                    size="sm"
                    onClick={onDelete}
                    IconLeft={<Trash2 />}
                    className="flex-1 justify-center"
                >
                    Видалити
                </UiButton>
                <UiButton
                    as="link"
                    href={href}
                    variant="filled"
                    size="sm"
                    IconRight={<ArrowRight />}
                    className="flex-1 justify-center"
                >
                    Відкрити
                </UiButton>
            </div>
        </div>
    );
}

function EmptyState({ createHref }: { createHref: string }) {
    return (
        <div className="flex flex-col items-center gap-4 py-10 text-center">
            <div className="bg-muted text-muted-foreground flex size-14 items-center justify-center rounded-full">
                <CreditCard className="size-7" />
            </div>
            <div className="space-y-1.5">
                <p className="text-foreground text-lg font-semibold">
                    Поки немає жодного рахунку
                </p>
                <p className="text-muted-foreground max-w-sm text-base">
                    Додайте перший банківський рахунок — клієнт зможе оплатити
                    через QR-код або посилання.
                </p>
            </div>
            <UiButton
                as="link"
                href={createHref}
                variant="filled"
                size="md"
                IconLeft={<Plus />}
            >
                Додати рахунок
            </UiButton>
        </div>
    );
}

