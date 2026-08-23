'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import UiButton from '@/shared/ui/UiButton';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import { deleteUserAccount, getAccountDeletionPreview } from '@/shared/api';
import { useAuthStore } from '@/entities/user';
import { accountActionErrorMessage } from './lib/accountActionError';
import { useDeleteAccountDialogStore } from './deleteAccountDialogStore';

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;

/**
 * Sprint 31 — кнопка більше не запускає жодної дії: вона лише тягне перелік того,
 * що зникне, і відкриває модалку. Лист і деактивація йдуть уже звідти, після
 * вписаних кількостей.
 *
 * Пауза перед повторним надсиланням рахується від позначки `accountDeletion-
 * RequestedAt`, а не від локального лічильника: інакше перезавантаження сторінки
 * скидало б її до нуля, а сама позначка живе у профілі.
 */
const DangerZone = () => {
    const user = useAuthStore((s) => s.user);
    const setUser = useAuthStore((s) => s.setUser);
    const openDeleteDialog = useDeleteAccountDialogStore((s) => s.open);

    const [loading, setLoading] = useState(false);
    const [now, setNow] = useState(() => Date.now());

    const requestedAt = user?.accountDeletionRequestedAt
        ? new Date(user.accountDeletionRequestedAt).getTime()
        : null;
    const isPendingDeletion =
        requestedAt !== null && now - requestedAt < MAGIC_LINK_TTL_MS;
    const cooldownSec = isPendingDeletion
        ? Math.ceil(
              Math.max(0, RESEND_COOLDOWN_MS - (now - requestedAt!)) / 1000
          )
        : 0;

    useEffect(() => {
        if (!isPendingDeletion) return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [isPendingDeletion]);

    const handleOpen = async () => {
        setLoading(true);
        try {
            openDeleteDialog(await getAccountDeletionPreview());
        } catch (err) {
            toast.error(accountActionErrorMessage(err));
        } finally {
            setLoading(false);
        }
    };

    const handleResend = async () => {
        setLoading(true);
        try {
            const result = await deleteUserAccount();
            // Відповідь розбирається, а не приймається на віру: лист іде лише
            // тому, у кого пароля немає. Якщо пароль з'явився після першого
            // надсилання, підтвердження тепер паролем — ведемо людину туди,
            // замість обіцяти лист, якого не буде.
            if (!result.requiresMagicLink) {
                if (user) {
                    setUser({ ...user, accountDeletionRequestedAt: null });
                }
                openDeleteDialog(await getAccountDeletionPreview());
                return;
            }
            if (user) {
                setUser({ ...user, accountDeletionRequestedAt: new Date() });
            }
            setNow(Date.now());
            toast.success('Посилання надіслано на вашу пошту');
        } catch (err) {
            toast.error(accountActionErrorMessage(err));
        } finally {
            setLoading(false);
        }
    };

    return (
        <UiSectionCard title="Небезпечна зона" variant="destructive">
            <div className="mt-5">
                <h3 className="text-foreground text-sm font-medium">
                    Видалення акаунту
                </h3>
                <p className="text-muted-foreground mt-1 text-sm">
                    Перед підтвердженням ви побачите повний перелік того, що
                    зникне. Після видалення у вас є 30 днів для відновлення
                    акаунту.
                </p>

                {isPendingDeletion && (
                    <div className="border-primary/30 bg-primary/10 mt-4 rounded-lg border p-4">
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
                    onClick={() =>
                        void (isPendingDeletion ? handleResend() : handleOpen())
                    }
                    loading={loading}
                    disabled={isPendingDeletion && cooldownSec > 0}
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
