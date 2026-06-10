'use client';

import { useEffect, useMemo, useState } from 'react';
import { CreditCard, Plus } from 'lucide-react';
import { AxiosError } from 'axios';
import { BANK_LABEL, type AccountWithCounts } from '@finly/types';
import { getApiMessage, listAccounts } from '@/shared/api';
import UiButton from '@/shared/ui/UiButton';
import UiNavCard from '@/shared/ui/UiNavCard';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSpinner from '@/shared/ui/UiSpinner';
import {
    makeAccountKey,
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
 * Sprint 9 §9.2 — секція "Реквізити" на business-cabinet-page. Cards-list з
 * name + bank label + IBAN-mask + CTA "Додати реквізити". Картка — навігаційна
 * (`UiNavCard`): єдина дія "Відкрити". Видалення живе на власній сторінці
 * реквізитів (`DangerSection`), не на картці у списку.
 *
 * **Null-bankCode UI-rule (§SP-9 4-точок invariant):** bank-label-row
 * рендериться **лише** для `bankCode !== null` — не fallback на текст
 * "Невідомий банк". IBAN-mask `•{last4}` лишається як disambiguator.
 *
 * **Optimistic-removal filter:** `usePendingAccountDeletesStore.keys.has(...)` —
 * filter-ить items, що у 5s-undo-вікні. Account-page після delete redirect-ить
 * сюди; картка лишається схованою до кінця undo-вікна (або повертається на cancel).
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
            (a) => !pendingDeleteKeys.has(makeAccountKey(businessSlug, a.slug))
        );
    }, [isCurrent, data, pendingDeleteKeys, businessSlug]);

    const createHref = `/business/${businessSlug}/account/new`;

    return (
        <UiSectionCard
            id="accounts"
            title="Реквізити"
            headerRight={
                visibleItems !== null && visibleItems.length > 0 ? (
                    <UiButton
                        as="link"
                        href={createHref}
                        variant="filled"
                        size="md"
                        IconLeft={<Plus />}
                    >
                        Додати реквізити
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
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    {visibleItems.map((account) => (
                        <AccountCard
                            key={account.id}
                            account={account}
                            businessSlug={businessSlug}
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
}

function AccountCard({ account, businessSlug }: CardProps) {
    const name = account.name;
    const mask = `•${account.iban.slice(-4)}`;
    const href = `/business/${businessSlug}/account/${account.slug}`;
    const bankLabel =
        account.bankCode !== null ? BANK_LABEL[account.bankCode] : null;
    // «банк •останні4» — банк-лейбл + маска одним рядком (маска mono як цифрова
    // частина). На нерозпізнаному IBAN банку немає — лишається сама маска.
    const bankAndMask = (
        <>
            {bankLabel ? `${bankLabel} ` : null}
            <span className="font-mono">{mask}</span>
        </>
    );
    const bankAndMaskText = bankLabel ? `${bankLabel} ${mask}` : mask;
    // Title — власна назва; за її відсутності піднімаємо «банк •останні4» у
    // заголовок, а вторинний рядок не дублюємо.
    const title = name !== null ? name : bankAndMask;
    const titleText = name !== null ? name : bankAndMaskText;
    return (
        <UiNavCard
            href={href}
            surface="muted"
            ariaLabel={`Відкрити реквізити ${titleText}`}
            title={title}
            titleAttr={titleText}
            meta={
                <>
                    {name !== null && <p>{bankAndMask}</p>}
                    <p>
                        Рахунки:{' '}
                        <span
                            className={
                                account.invoicesCount > 0
                                    ? 'text-foreground'
                                    : undefined
                            }
                        >
                            {account.invoicesCount} шт
                        </span>
                    </p>
                </>
            }
        />
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
                    Поки немає жодних реквізитів
                </p>
                <p className="text-muted-foreground max-w-sm text-base">
                    Додайте перші реквізити, і клієнт зможе оплатити через
                    QR-код або посилання.
                </p>
            </div>
            <UiButton
                as="link"
                href={createHref}
                variant="filled"
                size="md"
                IconLeft={<Plus />}
            >
                Додати реквізити
            </UiButton>
        </div>
    );
}
