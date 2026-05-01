'use client';

import UiLink from '@/shared/ui/UiLink';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import { useAuthStore } from '@/entities/user';

export default function AiChatTeaser() {
    const user = useAuthStore((s) => s.user);

    if (!user) return null;

    return (
        <UiSectionCard
            title="AI Чат"
            headerRight={
                <UiLink
                    as="link"
                    href="/ai-chat"
                    className="text-sm font-medium"
                >
                    Відкрити чат
                </UiLink>
            }
        >
            <p className="mt-3 text-sm text-muted-foreground">
                Спробуйте інтеграцію з AI — надішліть повідомлення та подивіться,
                як працює білінг виконань у реальному часі.
            </p>
        </UiSectionCard>
    );
}
