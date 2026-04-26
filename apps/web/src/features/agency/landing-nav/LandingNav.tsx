'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useHeaderNavStore } from '@/entities/navigation';
import { useBriefDialogStore } from '@/features/agency/brief';
import { DEMO_VIDEO_ENABLED } from '@/shared/config/env';

const allNavKeys = [
    { key: 'approach', href: '#problem' },
    { key: 'proof', href: '#dogfooding' },
    { key: 'demo', href: '#demo', enabled: DEMO_VIDEO_ENABLED },
    { key: 'workflow', href: '#workflow' },
    { key: 'pricing', href: '#pricing' },
    { key: 'get_started', href: '#footer-cta' },
] as const;

const navKeys = allNavKeys.filter((item) => !('enabled' in item) || item.enabled);

export default function LandingNav() {
    const tNav = useTranslations('landing_page.nav');
    const tHeader = useTranslations('components.header');
    const setNav = useHeaderNavStore((s) => s.setNav);
    const clearNav = useHeaderNavStore((s) => s.clearNav);

    useEffect(() => {
        const items = navKeys.map(({ key, href }) => ({
            href,
            label: tNav(key),
        }));

        setNav(items, {
            label: tHeader('get_started'),
            onClick: () => useBriefDialogStore.getState().open(),
        });

        return () => clearNav();
    }, [tNav, tHeader, setNav, clearNav]);

    return null;
}
