'use client';

import UiButton from '@/shared/ui/UiButton';
import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSpinner from '@/shared/ui/UiSpinner';

/**
 * Sprint 29 — спільний екран очікування і невдачі для адмін-сторінок системного
 * отримувача: спінер, поки дані летять, і картка з поверненням, коли запису
 * немає або запит зірвався. Три сторінки slice-у показують той самий екран, тож
 * розкладка живе в одному місці, а не трьома копіями.
 */
export function AdminLoadFallback({
    phase,
    notFoundTitle,
    errorTitle,
    backHref,
    backLabel,
}: {
    phase: 'loading' | 'not-found' | 'error';
    /** Що саме не знайдено: «Отримувача не знайдено» / «Реквізити не знайдено». */
    notFoundTitle: string;
    /** Збій запиту — окремий текст, бо це не «запису немає», а «спробуйте ще». */
    errorTitle: string;
    backHref: string;
    backLabel: string;
}) {
    if (phase === 'loading') {
        return (
            <UiPageContainer narrow>
                <div className="flex flex-1 items-center justify-center">
                    <UiSpinner size="md" />
                </div>
            </UiPageContainer>
        );
    }

    return (
        <UiPageContainer narrow className="justify-center">
            <UiSectionCard
                title={phase === 'not-found' ? notFoundTitle : errorTitle}
            >
                <div className="mt-4">
                    <UiButton
                        as="link"
                        href={backHref}
                        variant="filled"
                        size="md"
                    >
                        {backLabel}
                    </UiButton>
                </div>
            </UiSectionCard>
        </UiPageContainer>
    );
}
