'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CURRENT_TERMS_VERSION } from '@neatslip/types';
import {
    UiModal,
    UiModalContent,
    UiModalHeader,
    UiModalTitle,
} from '@/shared/ui/UiModal';
import UiButton from '@/shared/ui/UiButton';
import UiCheckbox from '@/shared/ui/UiCheckbox';
import UiLink from '@/shared/ui/UiLink';
import UiSpinner from '@/shared/ui/UiSpinner';
import { acceptTerms } from '@/shared/api';
import { useAuthStore } from '@/entities/user';
import { useTermsReacceptDialogStore } from './termsReacceptDialogStore';

function TermsReacceptForm({ onClose }: { onClose: () => void }) {
    const t = useTranslations('components.terms_reaccept');
    const locale = useLocale();

    const [agreed, setAgreed] = useState(false);
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async () => {
        if (!agreed) {
            setError(t('required'));
            return;
        }
        setSubmitting(true);
        try {
            await acceptTerms();
            const store = useAuthStore.getState();
            if (store.user) {
                store.setUser({ ...store.user, termsVersion: CURRENT_TERMS_VERSION });
            }
            onClose();
        } catch {
            setError(t('error'));
            setSubmitting(false);
        }
    };

    return (
        <>
            <UiModalHeader>
                <UiModalTitle className="text-xl">{t('title')}</UiModalTitle>
            </UiModalHeader>
            <div className="space-y-6 px-4 pb-6">
                <p className="text-muted-foreground text-sm">
                    {t('description')}
                </p>

                <UiCheckbox
                    checked={agreed}
                    onChange={(v) => {
                        setAgreed(v);
                        if (v) setError('');
                    }}
                    error={error}
                >
                    {t.rich('agree', {
                        terms: (chunks) => (
                            <UiLink
                                href={`/${locale}/terms`}
                                target="_blank"
                                rel="noopener noreferrer"
                                variant="primary-underline"
                                onClick={(e) => e.stopPropagation()}
                            >
                                {chunks}
                            </UiLink>
                        ),
                        privacy: (chunks) => (
                            <UiLink
                                href={`/${locale}/privacy`}
                                target="_blank"
                                rel="noopener noreferrer"
                                variant="primary-underline"
                                onClick={(e) => e.stopPropagation()}
                            >
                                {chunks}
                            </UiLink>
                        ),
                    })}
                </UiCheckbox>

                <UiButton
                    variant="filled"
                    size="lg"
                    className="w-full justify-center"
                    disabled={submitting}
                    onClick={handleSubmit}
                >
                    {submitting ? <UiSpinner size="sm" /> : t('button')}
                </UiButton>
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
