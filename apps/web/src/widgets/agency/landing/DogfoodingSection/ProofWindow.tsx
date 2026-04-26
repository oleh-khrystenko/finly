'use client';

import { useState, useEffect } from 'react';
import { ProofAuth, ProofBilling, ProofUsage } from '@/features/agency/proof';
import type { ProofTabKey } from './types';

type ProofWindowVariant = 'card' | 'embedded';

interface ProofWindowProps {
    activeTab: ProofTabKey;
    title?: string;
    onRequestAuth: () => void;
    variant?: ProofWindowVariant;
}

const panels: Record<ProofTabKey, React.ComponentType<{ onRequestAuth?: () => void }>> = {
    auth: ProofAuth,
    billing: ProofBilling,
    usage: ProofUsage,
};

const variantStyles: Record<ProofWindowVariant, string> = {
    card: 'flex-1 overflow-y-auto rounded-xl border border-border bg-card p-8',
    embedded: 'flex-1',
};

const ProofWindow = ({ activeTab, title, onRequestAuth, variant = 'card' }: ProofWindowProps) => {
    const [displayedTab, setDisplayedTab] = useState(activeTab);
    const [visible, setVisible] = useState(true);

    // Trigger fade-out immediately when activeTab changes (state-during-render pattern)
    if (activeTab !== displayedTab && visible) {
        setVisible(false);
    }

    // After fade-out completes, swap panel and fade back in
    useEffect(() => {
        if (visible) return;

        const timeout = setTimeout(() => {
            setDisplayedTab(activeTab);
            setVisible(true);
        }, 150);

        return () => clearTimeout(timeout);
    }, [visible, activeTab]);

    const Panel = panels[displayedTab];

    return (
        <div className={`flex flex-col ${variantStyles[variant]}`}>
            {title && <h3 className="mb-6 text-center text-2xl font-semibold text-foreground">{title}</h3>}
            <div
                className="flex flex-1 flex-col items-center justify-center transition-opacity duration-150"
                style={{ opacity: visible ? 1 : 0 }}
            >
                <Panel onRequestAuth={onRequestAuth} />
            </div>
        </div>
    );
};

export default ProofWindow;
