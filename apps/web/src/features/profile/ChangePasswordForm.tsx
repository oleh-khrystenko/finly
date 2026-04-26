'use client';

import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AxiosError } from 'axios';
import { toast } from 'sonner';
import { z } from 'zod';
import { passwordSchema } from '@cyanship/types';
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
    const t = useTranslations('profile_page.security');
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
                message: t('password_same_as_current'),
            });
            return;
        }

        try {
            await changePassword(data.currentPassword, data.newPassword);
            const me = await getMe();
            setUser(me);
            toast.success(t('password_changed'));
            onDone();
        } catch (err) {
            const code =
                err instanceof AxiosError
                    ? err.response?.data?.error?.code
                    : undefined;

            if (code === 'UNAUTHORIZED') {
                form.setError('currentPassword', {
                    type: 'server',
                    message: t('password_invalid'),
                });
            } else if (code === 'RATE_LIMIT_EXCEEDED') {
                toast.error(t('error_rate_limit'));
            } else {
                toast.error(t('error_generic'));
            }
        }
    };

    return (
        <form onSubmit={form.handleSubmit(onSubmit)} className="mt-5 space-y-4">
            <div>
                <label className="text-muted-foreground mb-1.5 block text-sm">
                    {t('current_password_label')}
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
                    placeholder={t('password_placeholder')}
                    error={
                        errors.currentPassword?.type === 'server'
                            ? errors.currentPassword.message
                            : undefined
                    }
                    required
                    size="lg"
                    showLabel={t('show_password')}
                    hideLabel={t('hide_password')}
                />
            </div>

            <div>
                <label className="text-muted-foreground mb-1.5 block text-sm">
                    {t('new_password_label')}
                </label>
                <UiPasswordInput
                    {...form.register('newPassword', {
                        onChange: () => {
                            if (errors.newPassword?.type === 'same_as_current') {
                                form.clearErrors('newPassword');
                            }
                        },
                    })}
                    placeholder={t('password_placeholder')}
                    error={
                        errors.newPassword?.type === 'same_as_current'
                            ? errors.newPassword.message
                            : getFieldError(
                                  errors.newPassword,
                                  {
                                      required: t('password_required'),
                                      too_small: t('password_too_short'),
                                  },
                                  newPwd,
                              )
                    }
                    required
                    size="lg"
                    showLabel={t('show_password')}
                    hideLabel={t('hide_password')}
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
                        t('change_password')
                    )}
                </UiButton>

                <UiButton
                    type="button"
                    variant="text"
                    size="md"
                    onClick={onCancel}
                    disabled={isSubmitting}
                >
                    {t('cancel')}
                </UiButton>
            </div>
        </form>
    );
};

export default ChangePasswordForm;
