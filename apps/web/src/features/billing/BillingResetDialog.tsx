'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { UiConfirmDialog } from '@/shared/ui/UiConfirmDialog';
import { resetBilling } from '@/shared/api/payments';
import { getMe } from '@/shared/api';
import { useAuthStore } from '@/entities/user';
import { useBillingResetDialogStore } from './billingResetDialogStore';

export default function BillingResetDialog() {
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
            toast.success('Білінг успішно скинуто');
        } catch {
            toast.error('Не вдалося скинути білінг');
        } finally {
            setLoading(false);
        }
    };

    return (
        <UiConfirmDialog
            open={isOpen}
            onOpenChange={(open) => !open && close()}
            title="Скинути білінг?"
            description="Підписку, доступ та історію платежів буде видалено. Цю дію неможливо скасувати."
            confirmLabel="Скинути"
            cancelLabel="Скасувати"
            variant="destructive"
            loading={loading}
            onConfirm={handleConfirm}
        />
    );
}
