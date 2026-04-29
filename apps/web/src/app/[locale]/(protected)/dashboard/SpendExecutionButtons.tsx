'use client';

import { useCallback, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AxiosError } from 'axios';
import { toast } from 'sonner';
import {
    EXECUTION_ACTION,
    EXECUTION_ACTION_COST,
    type SpendableAction,
} from '@neatslip/types';
import { spendExecutions, getApiMessageKey } from '@/shared/api';
import { useAuthStore } from '@/entities/user';
import { toIntlLocale } from '@/shared/lib';
import UiButton from '@/shared/ui/UiButton';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSpinner from '@/shared/ui/UiSpinner';

interface ActionButtonConfig {
    action: SpendableAction;
    labelKey: string;
}

const ACTION_BUTTONS: ActionButtonConfig[] = [
    { action: EXECUTION_ACTION.STANDARD_REPORT, labelKey: 'standard_report' },
    { action: EXECUTION_ACTION.AI_ANALYSIS, labelKey: 'ai_analysis' },
    { action: EXECUTION_ACTION.DEEP_ANALYSIS, labelKey: 'deep_analysis' },
    { action: EXECUTION_ACTION.FULL_AUDIT, labelKey: 'full_audit' },
];

interface SpendExecutionButtonsProps {
    onSpendSuccess?: () => void;
}

export default function SpendExecutionButtons({
    onSpendSuccess,
}: SpendExecutionButtonsProps) {
    const t = useTranslations('dashboard_page.spend');
    const tGlobal = useTranslations();
    const locale = useLocale();

    const user = useAuthStore((s) => s.user);
    const setUser = useAuthStore((s) => s.setUser);

    const balance = user?.executions.balance ?? 0;

    const [spendingAction, setSpendingAction] = useState<SpendableAction | null>(
        null
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
                        tGlobal(getApiMessageKey(code, 'generic'), { minutes })
                    );
                } else if (code === 'INSUFFICIENT_EXECUTIONS') {
                    toast.error(
                        tGlobal(getApiMessageKey(code, 'users'))
                    );
                } else if (code) {
                    toast.error(
                        tGlobal(getApiMessageKey(code))
                    );
                } else {
                    toast.error(
                        tGlobal('errors.generic.unknown')
                    );
                }
            } finally {
                setSpendingAction(null);
            }
        },
        [user, setUser, tGlobal, onSpendSuccess]
    );

    const isActionInProgress = spendingAction !== null;

    return (
        <UiSectionCard title={t('heading')}>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
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
                            <span
                                className={`flex flex-col items-center justify-center gap-1 text-center ${
                                    isBusy ? 'invisible' : ''
                                }`}
                            >
                                <span className="text-xs font-medium">
                                    {t(labelKey)}
                                </span>
                                <span className="text-xs opacity-70">
                                    {t('cost_label', {
                                        cost: cost.toLocaleString(
                                            toIntlLocale(locale)
                                        ),
                                    })}
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
