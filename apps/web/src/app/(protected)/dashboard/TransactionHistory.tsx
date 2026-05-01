'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import {
    EXECUTION_TRANSACTION_TYPE,
    type ExecutionTransactionItem,
} from '@finly/types';
import { getExecutionTransactions } from '@/shared/api';
import { INTL_LOCALE } from '@/shared/lib';
import UiButton from '@/shared/ui/UiButton';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSpinner from '@/shared/ui/UiSpinner';

const PAGE_SIZE = 10;

const ACTION_LABELS: Record<string, string> = {
    standard_report: 'Простий звіт',
    ai_analysis: 'AI аналіз',
    deep_analysis: 'Глибокий аналіз',
    full_audit: 'Повний аудит',
    subscription_activation: 'Підписку активовано',
    pack_purchase: 'Пакет виконань придбано',
    plan_change: 'План змінено',
    billing_reset: 'Білінг скинуто',
    ai_chat: 'AI Чат',
};

interface TransactionHistoryProps {
    refreshTrigger?: number;
}

export default function TransactionHistory({
    refreshTrigger = 0,
}: TransactionHistoryProps) {
    const [transactions, setTransactions] = useState<
        ExecutionTransactionItem[]
    >([]);
    const [hasMore, setHasMore] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);

    const generationRef = useRef(0);

    const formatRelativeTime = useCallback(
        (dateStr: string | Date): string => {
            const date =
                dateStr instanceof Date ? dateStr : new Date(dateStr);
            const diffMs = Date.now() - date.getTime();
            const diffMin = Math.floor(diffMs / 60_000);

            if (diffMin < 1) return 'Щойно';
            if (diffMin < 60) return `${diffMin} хв тому`;

            const diffHours = Math.floor(diffMin / 60);
            if (diffHours < 24) return `${diffHours} год тому`;

            return date.toLocaleDateString(INTL_LOCALE);
        },
        [],
    );

    // Initial fetch — resets on refreshTrigger (e.g. after spend action)
    useEffect(() => {
        generationRef.current += 1;
        const generation = generationRef.current;

        const fetchInitial = async () => {
            setIsLoading(true);
            setIsLoadingMore(false);
            try {
                const result = await getExecutionTransactions(PAGE_SIZE);
                if (generation !== generationRef.current) return;
                setTransactions(result.items);
                setHasMore(result.hasMore);
            } catch {
                if (generation !== generationRef.current) return;
                setTransactions([]);
                setHasMore(false);
            } finally {
                if (generation === generationRef.current) {
                    setIsLoading(false);
                }
            }
        };

        void fetchInitial();
    }, [refreshTrigger]);

    const handleLoadMore = async () => {
        const lastItem = transactions[transactions.length - 1];
        if (!lastItem) return;

        const generation = generationRef.current;
        setIsLoadingMore(true);
        try {
            const cursor = new Date(lastItem.createdAt).toISOString();
            const result = await getExecutionTransactions(PAGE_SIZE, cursor);
            if (generation !== generationRef.current) return;
            setTransactions((prev) => [...prev, ...result.items]);
            setHasMore(result.hasMore);
        } catch {
            // Silent fail — keep existing data
        } finally {
            if (generation === generationRef.current) {
                setIsLoadingMore(false);
            }
        }
    };

    return (
        <UiSectionCard title="Історія операцій">
            {isLoading ? (
                <div className="mt-4 flex items-center justify-center py-8">
                    <UiSpinner size="sm" />
                </div>
            ) : transactions.length === 0 ? (
                <p className="mt-4 py-8 text-center text-sm text-muted-foreground">
                    Історії операцій ще немає. Спробуйте функції вище.
                </p>
            ) : (
                <>
                    <ul className="mt-4 space-y-2">
                        {transactions.map((transaction) => {
                            const isCredit =
                                transaction.type ===
                                EXECUTION_TRANSACTION_TYPE.CREDIT;
                            const iconColor = isCredit
                                ? 'bg-success/15 text-success'
                                : 'bg-muted text-muted-foreground';

                            const actionLabel =
                                ACTION_LABELS[transaction.action] ??
                                transaction.action;

                            return (
                                <li
                                    key={transaction.id}
                                    className="flex items-center gap-3 rounded-lg px-3 py-2"
                                >
                                    <span
                                        className={`flex size-6 shrink-0 items-center justify-center rounded-full ${iconColor}`}
                                    >
                                        {isCredit ? (
                                            <ArrowUpRight className="size-3.5" />
                                        ) : (
                                            <ArrowDownRight className="size-3.5" />
                                        )}
                                    </span>

                                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                                        {actionLabel}
                                    </span>

                                    <span
                                        className={`shrink-0 text-xs font-medium ${
                                            isCredit
                                                ? 'text-success'
                                                : 'text-muted-foreground'
                                        }`}
                                    >
                                        {isCredit ? '+' : '−'}
                                        {transaction.amount.toLocaleString(
                                            INTL_LOCALE,
                                        )}
                                    </span>

                                    <span className="shrink-0 text-xs text-muted-foreground">
                                        {formatRelativeTime(
                                            transaction.createdAt,
                                        )}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>

                    {hasMore && (
                        <div className="mt-4 flex justify-center">
                            <UiButton
                                variant="outline"
                                size="sm"
                                disabled={isLoadingMore}
                                onClick={() => void handleLoadMore()}
                            >
                                {isLoadingMore ? (
                                    <UiSpinner size="sm" />
                                ) : (
                                    'Завантажити ще'
                                )}
                            </UiButton>
                        </div>
                    )}
                </>
            )}
        </UiSectionCard>
    );
}
