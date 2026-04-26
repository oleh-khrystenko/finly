'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { UiConfirmDialog } from '@/shared/ui/UiConfirmDialog';
import { resetBilling } from '@/shared/api/payments';
import { getMe } from '@/shared/api';
import { useAuthStore } from '@/entities/user';
import { useBillingResetDialogStore } from './billingResetDialogStore';

export default function BillingResetDialog() {
    const t = useTranslations('billing_page.reset');
    const isOpen = useBillingResetDialogStore((s) => s.isOpen);
    const close = useBillingResetDialogStore((s) => s.close);
    const [loading, setLoading] = useState(false);

    const handleConfirm = async () => {
        setLoading(true);
        try {
            await resetBilling();
            const me = await getMe();
            useAuthStore.getState().setUser(me);
            close();
            toast.success(t('success'));
        } catch {
            toast.error(t('error'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <UiConfirmDialog
            open={isOpen}
            onOpenChange={(open) => !open && close()}
            title={t('dialog_title')}
            description={t('dialog_description')}
            confirmLabel={t('dialog_confirm')}
            cancelLabel={t('dialog_cancel')}
            variant="destructive"
            loading={loading}
            onConfirm={handleConfirm}
        />
    );
}
