'use client';

import { useLocale, useTranslations } from 'next-intl';

import UiLink from '@/shared/ui/UiLink';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import { useAuthStore } from '@/entities/user';

export default function AiChatTeaser() {
    const t = useTranslations('dashboard_page.ai_chat_teaser');
    const locale = useLocale();
    const user = useAuthStore((s) => s.user);

    if (!user) return null;

    return (
        <UiSectionCard
            title={t('heading')}
            headerRight={
                <UiLink
                    as="link"
                    href={`/${locale}/ai-chat`}
                    className="text-sm font-medium"
                >
                    {t('cta_link')}
                </UiLink>
            }
        >
            <p className="mt-3 text-sm text-muted-foreground">
                {t('description')}
            </p>
        </UiSectionCard>
    );
}
