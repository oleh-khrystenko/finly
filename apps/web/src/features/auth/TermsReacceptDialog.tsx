'use client';

import { useState } from 'react';
import { CURRENT_TERMS_VERSION } from '@finly/types';
import {
    UiModal,
    UiModalContent,
    UiModalHeader,
    UiModalTitle,
} from '@/shared/ui/UiModal';
import UiButton from '@/shared/ui/UiButton';
import UiCheckbox from '@/shared/ui/UiCheckbox';
import UiLink from '@/shared/ui/UiLink';
import { acceptTerms } from '@/shared/api';
import { performLogout, useAuthStore } from '@/entities/user';
import { useTermsReacceptDialogStore } from './termsReacceptDialogStore';

const REQUIRED_ERROR = 'Необхідно прийняти оновлені умови для продовження.';
const GENERIC_ERROR = 'Щось пішло не так. Спробуйте ще раз.';

function TermsReacceptForm({ onClose }: { onClose: () => void }) {
    const [agreed, setAgreed] = useState(false);
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [declining, setDeclining] = useState(false);

    const handleSubmit = async () => {
        if (!agreed) {
            setError(REQUIRED_ERROR);
            return;
        }
        setSubmitting(true);
        try {
            await acceptTerms();
            const store = useAuthStore.getState();
            if (store.user) {
                store.setUser({
                    ...store.user,
                    termsVersion: CURRENT_TERMS_VERSION,
                });
            }
            onClose();
        } catch {
            setError(GENERIC_ERROR);
            setSubmitting(false);
        }
    };

    // Діалог не закриваємо: `performLogout` перезавантажує сторінку, і стан
    // overlay-store згасає разом з нею. Якби навігація чомусь не сталася,
    // відкритий діалог — правильний стан: умови не прийняті, вихід не відбувся.
    const handleDecline = () => {
        setDeclining(true);
        void performLogout();
    };

    return (
        <>
            <UiModalHeader>
                <UiModalTitle className="text-xl">Оновлені умови</UiModalTitle>
            </UiModalHeader>
            <div className="space-y-6 px-4 pb-6">
                <p className="text-muted-foreground text-sm">
                    Наші Умови використання або Політика конфіденційності були
                    оновлені. Перегляньте та прийміть зміни для продовження
                    роботи.
                </p>

                <UiCheckbox
                    checked={agreed}
                    onChange={(v) => {
                        setAgreed(v);
                        if (v) setError('');
                    }}
                    error={error}
                >
                    Я погоджуюсь з оновленими{' '}
                    <UiLink
                        href="/terms"
                        target="_blank"
                        rel="noopener noreferrer"
                        variant="primary-underline"
                        onClick={(e) => e.stopPropagation()}
                    >
                        Умовами використання
                    </UiLink>{' '}
                    та{' '}
                    <UiLink
                        href="/privacy"
                        target="_blank"
                        rel="noopener noreferrer"
                        variant="primary-underline"
                        onClick={(e) => e.stopPropagation()}
                    >
                        Політикою конфіденційності
                    </UiLink>
                </UiCheckbox>

                <div className="space-y-3">
                    <UiButton
                        variant="filled"
                        size="lg"
                        className="w-full justify-center"
                        loading={submitting}
                        disabled={declining}
                        onClick={handleSubmit}
                    >
                        Прийняти та продовжити
                    </UiButton>
                    <UiButton
                        variant="text"
                        size="md"
                        // `min-h-11` — touch-target 44×44 за responsive.md §2:
                        // baseline у примітиві покриває лише `icon`/`link`,
                        // а `text size="md"` дає 40px.
                        className="min-h-11 w-full justify-center"
                        loading={declining}
                        disabled={submitting}
                        onClick={handleDecline}
                    >
                        Відмовитись і вийти
                    </UiButton>
                </div>
            </div>
        </>
    );
}

export default function TermsReacceptDialog() {
    const isOpen = useTermsReacceptDialogStore((s) => s.isOpen);
    const close = useTermsReacceptDialogStore((s) => s.close);

    return (
        <UiModal open={isOpen}>
            <UiModalContent
                hideCloseButton
                onEscapeKeyDown={(e) => e.preventDefault()}
                onInteractOutside={(e) => e.preventDefault()}
            >
                {isOpen && <TermsReacceptForm onClose={close} />}
            </UiModalContent>
        </UiModal>
    );
}
