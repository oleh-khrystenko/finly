'use client';

import { useTranslations } from 'next-intl';
import {
    UiModal,
    UiModalContent,
    UiModalHeader,
    UiModalTitle,
} from '@/shared/ui/UiModal';
import { useBriefDialogStore } from './briefDialogStore';
import BriefForm from './BriefForm';

export default function BriefDialog() {
    const t = useTranslations('brief_form');
    const isOpen = useBriefDialogStore((s) => s.isOpen);
    const close = useBriefDialogStore((s) => s.close);

    return (
        <UiModal open={isOpen} onOpenChange={(open) => !open && close()}>
            <UiModalContent>
                <UiModalHeader>
                    <UiModalTitle className="text-xl">{t('title')}</UiModalTitle>
                </UiModalHeader>
                <div className="px-4 pb-6">
                    <BriefForm onSuccess={close} />
                </div>
            </UiModalContent>
        </UiModal>
    );
}
