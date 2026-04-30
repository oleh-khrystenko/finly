'use client';

import { useCallback, useState } from 'react';
import { AxiosError } from 'axios';
import { toast } from 'sonner';
import {
    EXECUTION_ACTION,
    EXECUTION_ACTION_COST,
    type SpendableAction,
} from '@neatslip/types';
import { spendExecutions, getApiMessage } from '@/shared/api';
import { useAuthStore } from '@/entities/user';
import { INTL_LOCALE } from '@/shared/lib';
import UiButton from '@/shared/ui/UiButton';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSpinner from '@/shared/ui/UiSpinner';

interface ActionButtonConfig {
    action: SpendableAction;
    label: string;
}

const ACTION_BUTTONS: ActionButtonConfig[] = [
    { action: EXECUTION_ACTION.STANDARD_REPORT, label: 'Простий звіт' },
    { action: EXECUTION_ACTION.AI_ANALYSIS, label: 'AI аналіз' },
    { action: EXECUTION_ACTION.DEEP_ANALYSIS, label: 'Глибокий аналіз' },
    { action: EXECUTION_ACTION.FULL_AUDIT, label: 'Повний аудит' },
];

interface SpendExecutionButtonsProps {
    onSpendSuccess?: () => void;
}

export default function SpendExecutionButtons({
    onSpendSuccess,
}: SpendExecutionButtonsProps) {
    const user = useAuthStore((s) => s.user);
    const setUser = useAuthStore((s) => s.setUser);

    const balance = user?.executions.balance ?? 0;

    const [spendingAction, setSpendingAction] = useState<SpendableAction | null>(
        null,
    );

    const handleSpend = useCallback(
        async (action: SpendableAction) => {
            setSpendingAction(action);
            try {
                const result = await spendExecutions(action);

                if (user) {
                    setUser({
                        ...user,
                        executions: {
                            ...user.executions,
                            balance: result.balance,
                        },
                    });
                }

                onSpendSuccess?.();
            } catch (error) {
                const code =
                    error instanceof AxiosError
                        ? error.response?.data?.error?.code
                        : undefined;

                if (code === 'RATE_LIMIT_EXCEEDED') {
                    const retryAfter =
                        error instanceof AxiosError
                            ? error.response?.headers?.['retry-after']
                            : undefined;
                    const minutes = retryAfter
                        ? Math.ceil(Number(retryAfter) / 60)
                        : 15;
                    toast.error(
                        getApiMessage(code, 'generic', { minutes }),
                    );
                } else if (code === 'INSUFFICIENT_EXECUTIONS') {
                    toast.error(getApiMessage(code, 'users'));
                } else if (code) {
                    toast.error(getApiMessage(code));
                } else {
                    toast.error('Сталася помилка. Спробуйте пізніше');
                }
            } finally {
                setSpendingAction(null);
            }
        },
        [user, setUser, onSpendSuccess],
    );

    const isActionInProgress = spendingAction !== null;

    return (
        <UiSectionCard title="Спробуйте функції">
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                {ACTION_BUTTONS.map(({ action, label }) => {
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
                            <span
                                className={`flex flex-col items-center justify-center gap-1 text-center ${
                                    isBusy ? 'invisible' : ''
                                }`}
                            >
                                <span className="text-xs font-medium">
                                    {label}
                                </span>
                                <span className="text-xs opacity-70">
                                    {cost.toLocaleString(INTL_LOCALE)} вик.
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
        </UiSectionCard>
    );
}
