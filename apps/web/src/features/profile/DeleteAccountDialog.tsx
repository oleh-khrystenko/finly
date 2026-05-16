'use client';

import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AxiosError } from 'axios';
import { toast } from 'sonner';
import { z } from 'zod';
import {
    UiModal,
    UiModalContent,
    UiModalHeader,
    UiModalTitle,
} from '@/shared/ui/UiModal';
import UiButton from '@/shared/ui/UiButton';
import UiPasswordInput from '@/shared/ui/UiPasswordInput';
import UiSpinner from '@/shared/ui/UiSpinner';
import { confirmDeleteAccount } from '@/shared/api';
import { useDeleteAccountDialogStore } from './deleteAccountDialogStore';

const DeleteAccountFormSchema = z.object({
    password: z.string().min(1),
});

type DeleteAccountFormValues = z.input<typeof DeleteAccountFormSchema>;

export default function DeleteAccountDialog() {
    const router = useRouter();
    const isOpen = useDeleteAccountDialogStore((s) => s.isOpen);
    const close = useDeleteAccountDialogStore((s) => s.close);

    const form = useForm<DeleteAccountFormValues>({
        resolver: zodResolver(DeleteAccountFormSchema),
        defaultValues: { password: '' },
    });

    const { errors, isSubmitting } = form.formState;
    const password = form.watch('password');

    const handleOpenChange = (open: boolean) => {
        if (!open && !isSubmitting) {
            close();
            form.reset();
        }
    };

    const onSubmit = async (data: DeleteAccountFormValues) => {
        try {
            await confirmDeleteAccount(data.password);
            close();
            form.reset();
            toast.success('Акаунт деактивовано');
            router.push('/auth/signin');
        } catch (err) {
            const code =
                err instanceof AxiosError
                    ? err.response?.data?.error?.code
                    : undefined;

            if (code === 'UNAUTHORIZED') {
                form.setError('password', {
                    type: 'server',
                    message: 'Невірний пароль',
                });
            } else if (code === 'RATE_LIMIT_EXCEEDED') {
                form.setError('password', {
                    type: 'server',
                    message: 'Забагато запитів. Спробуйте через 15 хвилин',
                });
            } else {
                form.setError('password', {
                    type: 'server',
                    message: 'Не вдалося виконати операцію. Спробуйте пізніше',
                });
            }
        }
    };

    return (
        <UiModal open={isOpen} onOpenChange={handleOpenChange}>
            <UiModalContent>
                <UiModalHeader>
                    <UiModalTitle>Видалення акаунту</UiModalTitle>
                </UiModalHeader>
                <div className="px-4 pb-6">
                    <p className="text-muted-foreground text-sm">
                        Ви впевнені? Ваш акаунт буде деактивовано. У вас буде 30
                        днів для відновлення.
                    </p>

                    <form
                        onSubmit={form.handleSubmit(onSubmit)}
                        className="mt-4 space-y-4"
                    >
                        <UiPasswordInput
                            {...form.register('password', {
                                onChange: () => {
                                    if (errors.password?.type === 'server') {
                                        form.clearErrors('password');
                                    }
                                },
                            })}
                            label="Введіть пароль для підтвердження"
                            error={
                                errors.password?.type === 'server'
                                    ? errors.password.message
                                    : undefined
                            }
                            required
                            size="lg"
                            autoFocus
                        />

                        <div className="flex justify-end gap-3">
                            <UiButton
                                type="button"
                                variant="text"
                                size="md"
                                onClick={() => handleOpenChange(false)}
                                disabled={isSubmitting}
                            >
                                Скасувати
                            </UiButton>
                            <UiButton
                                type="submit"
                                variant="destructive-outline"
                                size="md"
                                disabled={isSubmitting || !password}
                            >
                                {isSubmitting ? (
                                    <UiSpinner size="sm" />
                                ) : (
                                    'Видалити акаунт'
                                )}
                            </UiButton>
                        </div>
                    </form>
                </div>
            </UiModalContent>
        </UiModal>
    );
}
