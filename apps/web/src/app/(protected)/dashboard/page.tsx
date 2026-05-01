'use client';

import { useCallback, useState } from 'react';
import { getFullName, getInitials } from '@finly/types';
import { useAuthStore } from '@/entities/user';
import { INTL_LOCALE } from '@/shared/lib';
import { UiAvatar } from '@/shared/ui/UiAvatar';
import { PAYMENTS_SUBSCRIPTION_ENABLED } from '@/shared/config/env';
import UiLink from '@/shared/ui/UiLink';
import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import AiChatTeaser from './AiChatTeaser';
import SubscriptionStatus from './SubscriptionStatus';
import SpendExecutionButtons from './SpendExecutionButtons';
import TransactionHistory from './TransactionHistory';

export default function DashboardPage() {
    const user = useAuthStore((s) => s.user);
    const [txVersion, setTxVersion] = useState(0);
    const handleSpendSuccess = useCallback(
        () => setTxVersion((v) => v + 1),
        [],
    );

    if (!user) return null;

    const fullName = getFullName(user.profile.firstName, user.profile.lastName);
    const initials = getInitials(fullName, user.email);
    const balance = user.executions.balance;
    const formattedBalance = balance.toLocaleString(INTL_LOCALE);

    return (
        <UiPageContainer className="space-y-8 py-12 md:py-16">
            {/* ── Greeting ── */}
            <div className="flex items-center gap-4">
                <UiAvatar
                    size="xl"
                    src={user.profile.avatar}
                    alt={fullName}
                    fallback={initials}
                />
                <div className="flex flex-col gap-0.5">
                    <h1 className="text-foreground text-2xl font-bold tracking-tight md:text-3xl">
                        Вітаємо, {user.profile.firstName ?? ''}
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        {user.email}
                    </p>
                </div>
            </div>

            {/* ── Execution Balance ── */}
            <UiSectionCard
                title="Баланс"
                headerRight={
                    balance === 0 ? (
                        <UiLink
                            as="link"
                            href="/billing"
                            className="text-sm font-medium"
                        >
                            Поповнити
                        </UiLink>
                    ) : undefined
                }
            >
                <p className="mt-2">
                    <span className="text-3xl font-bold tracking-tight text-foreground md:text-4xl">
                        {formattedBalance}
                    </span>
                    <span className="ml-2 text-sm text-muted-foreground">
                        виконань
                    </span>
                </p>
            </UiSectionCard>

            {/* ── Subscription Status ── */}
            {PAYMENTS_SUBSCRIPTION_ENABLED && <SubscriptionStatus />}

            {/* ── AI Chat Teaser ── */}
            <AiChatTeaser />

            {/* ── Spend Execution Buttons ── */}
            <SpendExecutionButtons onSpendSuccess={handleSpendSuccess} />

            {/* ── Transaction History ── */}
            <TransactionHistory refreshTrigger={txVersion} />
        </UiPageContainer>
    );
}
