'use client';

import { useTranslations } from 'next-intl';
import { UserPlus, CreditCard, Activity, type LucideIcon } from 'lucide-react';
import { composeClasses } from '@/shared/lib';
import type { ProofTabKey } from './types';

interface ProofTabsProps {
    activeTab: ProofTabKey | null;
    onTabChange: (tab: ProofTabKey) => void;
}

const tabs: { key: ProofTabKey; icon: LucideIcon; labelKey: string }[] = [
    { key: 'auth', icon: UserPlus, labelKey: 'step_1' },
    { key: 'billing', icon: CreditCard, labelKey: 'step_2' },
    { key: 'usage', icon: Activity, labelKey: 'step_3' },
];

const ProofTabs = ({ activeTab, onTabChange }: ProofTabsProps) => {
    const t = useTranslations('landing_page.dogfooding');

    return (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {tabs.map(({ key, icon: Icon, labelKey }) => {
                const isActive = activeTab === key;

                return (
                    <button
                        key={key}
                        type="button"
                        onClick={() => onTabChange(key)}
                        className={composeClasses(
                            'flex w-full cursor-pointer items-center gap-4 p-4 text-left transition-colors',
                            isActive
                                ? 'bg-primary/5'
                                : 'bg-card hover:bg-accent'
                        )}
                    >
                        <div
                            className={composeClasses(
                                'flex size-10 shrink-0 items-center justify-center rounded-lg',
                                isActive
                                    ? 'bg-primary text-primary-foreground'
                                    : 'border border-border bg-secondary text-muted-foreground'
                            )}
                        >
                            <Icon className="size-4" />
                        </div>
                        <span className="text-foreground">
                            {t(labelKey)}
                        </span>
                        <span className="ml-auto whitespace-nowrap text-xs text-primary lg:hidden">
                            {t('proof_shell.try_it')}
                        </span>
                    </button>
                );
            })}
        </div>
    );
};

export default ProofTabs;
