'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';

import {
    EXECUTION_ACTION,
    EXECUTION_ACTION_COST,
    type ExecutionTransactionItem,
    type SpendableAction,
} from '@cyanship/types';
import { spendExecutions, getExecutionTransactions } from '@/shared/api';
import { useAuthStore } from '@/entities/user';
import UiButton from '@/shared/ui/UiButton';
import UiSpinner from '@/shared/ui/UiSpinner';

interface ProofUsageProps {
    onRequestAuth?: () => void;
}

const ACTION_BUTTONS: { action: SpendableAction; labelKey: string }[] = [
    { action: EXECUTION_ACTION.STANDARD_REPORT, labelKey: 'generate_report' },
    { action: EXECUTION_ACTION.AI_ANALYSIS, labelKey: 'run_analysis' },
];

const ProofUsage = ({ onRequestAuth }: ProofUsageProps) => {
    const t = useTranslations('landing_page.dogfooding.proof_usage');

    const user = useAuthStore((s) => s.user);
    const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
    const isLoading = useAuthStore((s) => s.isLoading);
    const setUser = useAuthStore((s) => s.setUser);

    const balance = user?.executions.balance ?? 0;

    const [transactions, setTransactions] = useState<ExecutionTransactionItem[]>([]);
    const [isLoadingTransactions, setIsLoadingTransactions] = useState(false);
    const [spendingAction, setSpendingAction] = useState<SpendableAction | null>(null);

    const fetchTransactions = useCallback(async () => {
        setIsLoadingTransactions(true);
        try {
            const { items } = await getExecutionTransactions(10);
            setTransactions(items);
        } catch {
            // Silent fail — transactions are supplementary
        } finally {
            setIsLoadingTransactions(false);
        }
    }, []);

    // Fetch transactions when authenticated
    useEffect(() => {
        if (!isAuthenticated) return;
        void fetchTransactions();
    }, [isAuthenticated, fetchTransactions]);

    const handleSpend = async (action: SpendableAction) => {
        if (!isAuthenticated) {
            onRequestAuth?.();
            return;
        }

        setSpendingAction(action);
        try {
            const result = await spendExecutions(action);

            // Update balance in auth store
            if (user) {
                setUser({
                    ...user,
                    executions: { ...user.executions, balance: result.balance },
                });
            }

            // Prepend new transaction
            setTransactions((prev) => [result.transaction, ...prev].slice(0, 10));
        } catch {
            toast.error(t('insufficient_balance'));
        } finally {
            setSpendingAction(null);
        }
    };

    const formatRelativeTime = (dateStr: string | Date) => {
        const date = dateStr instanceof Date ? dateStr : new Date(dateStr);
        const diffMs = Date.now() - date.getTime();
        const diffMin = Math.floor(diffMs / 60_000);

        if (diffMin < 1) return t('time_just_now');
        if (diffMin < 60) return t('time_minutes_ago', { count: diffMin });
        const diffHours = Math.floor(diffMin / 60);
        if (diffHours < 24) return t('time_hours_ago', { count: diffHours });
        return date.toLocaleDateString();
    };

    // Auth loading
    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <UiSpinner size="md" />
            </div>
        );
    }

    // Not authenticated
    if (!isAuthenticated) {
        return (
            <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
                <p className="text-sm text-muted-foreground">
                    {t('not_authenticated')}
                </p>
                <UiButton
                    variant="outline"
                    size="sm"
                    onClick={() => onRequestAuth?.()}
                >
                    {t('sign_in_button')}
                </UiButton>
            </div>
        );
    }

    const isActionInProgress = spendingAction !== null;

    return (
        <div className="w-full space-y-5">
            {/* Balance indicator */}
            <div className="rounded-xl border border-border p-5 text-center">
                <p className="text-sm font-medium text-muted-foreground">
                    {t('balance_label')}
                </p>
                <p className="mt-1 text-3xl font-bold tracking-tight text-foreground">
                    {t('balance_executions', { count: balance.toLocaleString('en-US') })}
                </p>
            </div>

            {/* Action buttons */}
            <div className="grid grid-cols-2 gap-3">
                {ACTION_BUTTONS.map(({ action, labelKey }) => {
                    const cost = EXECUTION_ACTION_COST[action];
                    const isBusy = spendingAction === action;
                    const canAfford = balance >= cost;

                    return (
                        <UiButton
                            key={action}
                            variant={canAfford ? 'filled' : 'outline'}
                            size="sm"
                            className="relative w-full justify-center"
                            disabled={isActionInProgress || !canAfford}
                            onClick={() => handleSpend(action)}
                        >
                            <span className={`flex flex-wrap items-center justify-center gap-x-1 ${isBusy ? 'invisible' : ''}`}>
                                <span>{t(labelKey)}</span>
                                <span className="opacity-70">
                                    ({t('cost_label', { cost: cost.toLocaleString('en-US') })})
                                </span>
                            </span>
                            {isBusy && (
                                <UiSpinner
                                    size="sm"
                                    className="absolute inset-0 m-auto"
                                />
                            )}
                        </UiButton>
                    );
                })}
            </div>

            {/* Transaction log */}
            <div>
                <h4 className="mb-3 text-sm font-semibold text-foreground">
                    {t('transactions_title')}
                </h4>

                {isLoadingTransactions ? (
                    <div className="flex items-center justify-center py-6">
                        <UiSpinner size="sm" />
                    </div>
                ) : transactions.length === 0 ? (
                    <p className="py-6 text-center text-xs text-muted-foreground">
                        {t('no_transactions')}
                    </p>
                ) : (
                    <ul className="max-h-[192px] space-y-1 overflow-y-auto">
                        {transactions.map((tx) => {
                            const isCredit = tx.type === 'credit';

                            return (
                                <li
                                    key={tx.id}
                                    className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm"
                                >
                                    <span
                                        className={`flex size-6 shrink-0 items-center justify-center rounded-full ${
                                            isCredit
                                                ? 'bg-success/15 text-success'
                                                : 'bg-muted text-muted-foreground'
                                        }`}
                                    >
                                        {isCredit ? (
                                            <ArrowUpRight className="size-3.5" />
                                        ) : (
                                            <ArrowDownRight className="size-3.5" />
                                        )}
                                    </span>

                                    <span className="min-w-0 flex-1 truncate text-foreground">
                                        {t(`actions.${tx.action}`, {
                                            defaultValue: tx.action,
                                        })}
                                    </span>

                                    <span
                                        className={`shrink-0 text-xs font-medium ${
                                            isCredit ? 'text-success' : 'text-muted-foreground'
                                        }`}
                                    >
                                        {isCredit ? '+' : '-'}
                                        {tx.amount.toLocaleString('en-US')}
                                    </span>

                                    <span className="shrink-0 text-xs text-muted-foreground">
                                        {formatRelativeTime(tx.createdAt)}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </div>
    );
};

export default ProofUsage;
