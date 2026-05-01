'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AxiosError } from 'axios';
import { toast } from 'sonner';
import { z } from 'zod';
import { passwordSchema } from '@finly/types';
import UiButton from '@/shared/ui/UiButton';
import UiPasswordInput from '@/shared/ui/UiPasswordInput';
import UiSpinner from '@/shared/ui/UiSpinner';
import { getFieldError } from '@/shared/lib';
import { changePassword, getMe } from '@/shared/api';
import { useAuthStore } from '@/entities/user';

const ChangePasswordFormSchema = z.object({
    currentPassword: z.string().min(1),
    newPassword: passwordSchema,
});

type ChangePasswordFormValues = z.input<typeof ChangePasswordFormSchema>;

interface ChangePasswordFormProps {
    onDone: () => void;
    onCancel: () => void;
}

const ChangePasswordForm = ({ onDone, onCancel }: ChangePasswordFormProps) => {
    const setUser = useAuthStore((s) => s.setUser);

    const form = useForm<ChangePasswordFormValues>({
        resolver: zodResolver(ChangePasswordFormSchema),
        mode: 'onTouched',
        defaultValues: { currentPassword: '', newPassword: '' },
    });

    const { errors, isSubmitting } = form.formState;
    const [currentPwd, newPwd] = form.watch(['currentPassword', 'newPassword']);
    const canSubmit = !!currentPwd && !!newPwd;

    const onSubmit = async (data: ChangePasswordFormValues) => {
        if (data.currentPassword === data.newPassword) {
            form.setError('newPassword', {
                type: 'same_as_current',
                message: 'Новий пароль має відрізнятися від поточного',
            });
            return;
        }

        try {
            await changePassword(data.currentPassword, data.newPassword);
            const me = await getMe();
            setUser(me);
            toast.success('Пароль змінено. Інші пристрої було відключено');
            onDone();
        } catch (err) {
            const code =
                err instanceof AxiosError
                    ? err.response?.data?.error?.code
                    : undefined;

            if (code === 'UNAUTHORIZED') {
                form.setError('currentPassword', {
                    type: 'server',
                    message: 'Невірний пароль',
                });
            } else if (code === 'RATE_LIMIT_EXCEEDED') {
                toast.error(
                    'Забагато запитів. Спробуйте через 15 хвилин',
                );
            } else {
                toast.error(
                    'Не вдалося виконати операцію. Спробуйте пізніше',
                );
            }
        }
    };

    return (
        <form onSubmit={form.handleSubmit(onSubmit)} className="mt-5 space-y-4">
            <div>
                <label className="text-muted-foreground mb-1.5 block text-sm">
                    Поточний пароль
                </label>
                <UiPasswordInput
                    {...form.register('currentPassword', {
                        onChange: () => {
                            if (errors.currentPassword?.type === 'server') {
                                form.clearErrors('currentPassword');
                            }
                            if (errors.newPassword?.type === 'same_as_current') {
                                form.clearErrors('newPassword');
                            }
                        },
                    })}
                    placeholder="Мінімум 8 символів"
                    error={
                        errors.currentPassword?.type === 'server'
                            ? errors.currentPassword.message
                            : undefined
                    }
                    required
                    size="lg"
                    showLabel="Показати пароль"
                    hideLabel="Сховати пароль"
                />
            </div>

            <div>
                <label className="text-muted-foreground mb-1.5 block text-sm">
                    Новий пароль
                </label>
                <UiPasswordInput
                    {...form.register('newPassword', {
                        onChange: () => {
                            if (errors.newPassword?.type === 'same_as_current') {
                                form.clearErrors('newPassword');
                            }
                        },
                    })}
                    placeholder="Мінімум 8 символів"
                    error={
                        errors.newPassword?.type === 'same_as_current'
                            ? errors.newPassword.message
                            : getFieldError(
                                  errors.newPassword,
                                  {
                                      required: 'Введіть пароль',
                                      too_small:
                                          'Пароль повинен містити мінімум 8 символів',
                                  },
                                  newPwd,
                              )
                    }
                    required
                    size="lg"
                    showLabel="Показати пароль"
                    hideLabel="Сховати пароль"
                />
            </div>

            <div className="flex items-center gap-3">
                <UiButton
                    type="submit"
                    variant="filled"
                    size="md"
                    disabled={isSubmitting || !canSubmit}
                >
                    {isSubmitting ? (
                        <UiSpinner size="sm" />
                    ) : (
                        'Змінити пароль'
                    )}
                </UiButton>

                <UiButton
                    type="button"
                    variant="text"
                    size="md"
                    onClick={onCancel}
                    disabled={isSubmitting}
                >
                    Скасувати
                </UiButton>
            </div>
        </form>
    );
};

export default ChangePasswordForm;
