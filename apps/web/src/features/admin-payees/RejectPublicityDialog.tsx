'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
    UiModal,
    UiModalContent,
    UiModalHeader,
    UiModalTitle,
} from '@/shared/ui/UiModal';
import UiButton from '@/shared/ui/UiButton';
import UiTextarea from '@/shared/ui/UiTextarea';
import { useAutoCancelOnRouteChange } from '@/shared/lib';
import {
    adminRejectPublicity,
    extractApiErrorCode,
    getApiMessage,
} from '@/shared/api';
import { useRejectPublicityStore } from './rejectPublicityStore';

/**
 * Sprint 29 — відхилення запиту на публічність із причиною. Причина показується
 * користувачу, тож обовʼязкова. Монтується один раз у `app/overlays.tsx`.
 *
 * `useAutoCancelOnRouteChange` закриває діалог на зміні маршруту: стор несе
 * route-local контекст (slug отримувача і `onRejected`-колбек зі сторінки черги),
 * тож відкрите вікно, що пережило навігацію, відхилило б запит отримувача A вже
 * на чужій сторінці. Симетрично до сусідніх діалогів slice-у.
 */
export default function RejectPublicityDialog() {
    const { isOpen, slug, payeeName, mode, onRejected, close } =
        useRejectPublicityStore();
    const isRevoke = mode === 'approved';
    const [reason, setReason] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    useAutoCancelOnRouteChange(isOpen, close);

    useEffect(() => {
        if (isOpen) {
            setReason('');
            setError(null);
        }
    }, [isOpen]);

    const handleOpenChange = (open: boolean) => {
        if (!open && !loading) close();
    };

    const handleReject = async () => {
        if (!slug) return;
        // Причина обовʼязкова: її побачить отримувач. Замість мертвої кнопки
        // (forms.md) лишаємо клік активним і показуємо причину під полем.
        if (reason.trim().length === 0) {
            setError('Вкажіть причину, її побачить отримувач.');
            return;
        }
        setLoading(true);
        try {
            await adminRejectPublicity(slug, { reason: reason.trim() });
            toast.success(
                isRevoke ? 'Отримувача прибрано з каталогу' : 'Запит відхилено'
            );
            onRejected?.();
            close();
        } catch (err) {
            toast.error(getApiMessage(extractApiErrorCode(err), 'businesses'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <UiModal open={isOpen} onOpenChange={handleOpenChange}>
            <UiModalContent>
                <UiModalHeader>
                    <UiModalTitle>
                        {isRevoke ? 'Прибрати з каталогу' : 'Відхилити запит'}
                    </UiModalTitle>
                </UiModalHeader>
                <div className="space-y-5 px-4 pb-6">
                    <p className="text-muted-foreground text-sm">
                        {isRevoke
                            ? `Причину побачить ${payeeName}. Отримувач зникне з каталогу, його публічні сторінки і QR працюватимуть далі.`
                            : `Причину побачить ${payeeName}. Поясніть, що виправити, щоб подати заявку знову.`}
                    </p>
                    <UiTextarea
                        label="Причина"
                        rows={3}
                        value={reason}
                        onChange={(e) => {
                            setReason(e.target.value);
                            if (error) setError(null);
                        }}
                        error={error ?? undefined}
                        placeholder="Не вдалося підтвердити реальність отримувача"
                    />
                    <div className="flex justify-end gap-3">
                        <UiButton
                            type="button"
                            variant="text"
                            size="md"
                            onClick={() => handleOpenChange(false)}
                            disabled={loading}
                        >
                            Назад
                        </UiButton>
                        <UiButton
                            type="button"
                            variant="destructive-outline"
                            size="md"
                            loading={loading}
                            onClick={() => void handleReject()}
                        >
                            {isRevoke ? 'Прибрати' : 'Відхилити'}
                        </UiButton>
                    </div>
                </div>
            </UiModalContent>
        </UiModal>
    );
}
