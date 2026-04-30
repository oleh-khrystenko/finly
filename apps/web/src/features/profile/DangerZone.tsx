'use client';

import { useEffect, useState } from 'react';
import { AxiosError } from 'axios';
import { toast } from 'sonner';
import UiButton from '@/shared/ui/UiButton';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import { deleteAccount } from '@/shared/api';
import { useAuthStore } from '@/entities/user';
import { useDeleteAccountDialogStore } from './deleteAccountDialogStore';

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
const RESEND_COOLDOWN_SEC = 60;

const DangerZone = () => {
    const user = useAuthStore((s) => s.user);
    const setUser = useAuthStore((s) => s.setUser);
    const openDeleteDialog = useDeleteAccountDialogStore((s) => s.open);

    const [loading, setLoading] = useState(false);
    const [cooldownSec, setCooldownSec] = useState(0);

    useEffect(() => {
        if (cooldownSec <= 0) return;
        const timer = setInterval(() => {
            setCooldownSec((prev) => Math.max(0, prev - 1));
        }, 1000);
        return () => clearInterval(timer);
    }, [cooldownSec]);

    const requestedAt = user?.accountDeletionRequestedAt
        ? new Date(user.accountDeletionRequestedAt)
        : null;
    const isPendingDeletion =
        requestedAt !== null &&
        Date.now() - requestedAt.getTime() < MAGIC_LINK_TTL_MS;

    const handleDelete = async () => {
        setLoading(true);
        try {
            const result = await deleteAccount();

            if (result.requiresPassword) {
                openDeleteDialog();
            } else if (result.requiresMagicLink) {
                if (user) {
                    setUser({
                        ...user,
                        accountDeletionRequestedAt: new Date(),
                    });
                }
                setCooldownSec(RESEND_COOLDOWN_SEC);
                toast.success(
                    'Посилання для підтвердження надіслано на пошту',
                );
            }
        } catch (error) {
            const code =
                error instanceof AxiosError
                    ? error.response?.data?.error?.code
                    : undefined;

            if (code === 'RATE_LIMIT_EXCEEDED') {
                toast.error('Забагато запитів. Спробуйте через 15 хвилин');
            } else if (code === 'EMAIL_SEND_FAILED') {
                toast.error(
                    'Не вдалося виконати операцію. Спробуйте пізніше',
                );
            } else {
                toast.error('Невірний пароль');
            }
        } finally {
            setLoading(false);
        }
    };

    const resendDisabled = loading || cooldownSec > 0;

    return (
        <UiSectionCard title="Небезпечна зона" variant="destructive">
            <div className="mt-5">
                <h3 className="text-foreground text-sm font-medium">
                    Видалення акаунту
                </h3>
                <p className="text-muted-foreground mt-1 text-sm">
                    Після видалення у вас є 30 днів для відновлення акаунту.
                </p>

                {isPendingDeletion && (
                    <div className="mt-4 rounded-lg border border-primary/30 bg-primary/10 p-4">
                        <p className="text-primary text-sm font-medium">
                            Перевірте пошту
                        </p>
                        <p className="text-primary mt-1 text-sm">
                            Посилання для підтвердження видалення акаунту
                            надіслано на вашу адресу. Посилання дійсне 15
                            хвилин.
                        </p>
                    </div>
                )}

                <UiButton
                    variant="destructive-outline"
                    size="md"
                    className="mt-4"
                    onClick={() => void handleDelete()}
                    disabled={isPendingDeletion ? resendDisabled : loading}
                >
                    {isPendingDeletion
                        ? cooldownSec > 0
                            ? `Надіслати повторно (${cooldownSec}с)`
                            : 'Надіслати повторно'
                        : 'Видалити акаунт'}
                </UiButton>
            </div>
        </UiSectionCard>
    );
};

export default DangerZone;
