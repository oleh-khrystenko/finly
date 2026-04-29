'use client';

import { Suspense, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AxiosError } from 'axios';
import { toast } from 'sonner';
import { z } from 'zod';
import { passwordSchema } from '@neatslip/types';

import UiButton from '@/shared/ui/UiButton';
import UiPasswordInput from '@/shared/ui/UiPasswordInput';
import UiSpinner from '@/shared/ui/UiSpinner';
import UiFullPageLoader from '@/shared/ui/UiFullPageLoader';
import { getFieldError } from '@/shared/lib';
import { resetPassword } from '@/shared/api';

const ResetPasswordFormSchema = z.object({
    newPassword: passwordSchema,
    confirmPassword: passwordSchema,
});

type ResetPasswordFormValues = z.input<typeof ResetPasswordFormSchema>;

type PageStatus = 'form' | 'error';

function ResetPasswordContent() {
    const t = useTranslations('auth_page.reset_password');
    const router = useRouter();
    const { locale } = useParams<{ locale: string }>();
    const searchParams = useSearchParams();
    const token = searchParams.get('token');

    const form = useForm<ResetPasswordFormValues>({
        resolver: zodResolver(ResetPasswordFormSchema),
        mode: 'onTouched',
        defaultValues: { newPassword: '', confirmPassword: '' },
    });

    const [status, setStatus] = useState<PageStatus>(token ? 'form' : 'error');
    const [errorMessage, setErrorMessage] = useState(
        token ? '' : t('error_invalid_token')
    );

    const onSubmit = async (data: ResetPasswordFormValues) => {
        form.clearErrors('confirmPassword');

        if (data.newPassword !== data.confirmPassword) {
            form.setError('confirmPassword', {
                type: 'mismatch',
                message: t('passwords_mismatch'),
            });
            return;
        }

        try {
            await resetPassword(token!, data.newPassword, data.confirmPassword);
            toast.success(t('success_toast'));
            router.replace(`/${locale}/auth/signin`);
        } catch (err) {
            setStatus('error');
            const code =
                err instanceof AxiosError
                    ? err.response?.data?.error?.code
                    : undefined;

            if (code === 'UNAUTHORIZED' || code === 'INVALID_MAGIC_LINK') {
                setErrorMessage(t('error_invalid_token'));
            } else {
                setErrorMessage(t('error_generic'));
            }
        }
    };

    if (status === 'error') {
        return (
            <div className="w-full max-w-md space-y-6 text-center">
                <div className="border-destructive rounded-lg border p-6">
                    <p className="text-foreground text-sm">
                        {errorMessage}
                    </p>
                </div>
                <UiButton
                    as="link"
                    href={`/${locale}/auth/signin`}
                    variant="filled"
                    size="lg"
                >
                    {t('back_to_signin')}
                </UiButton>
            </div>
        );
    }

    const { errors, isSubmitting } = form.formState;
    const [newPwd, confirmPwd] = form.watch(['newPassword', 'confirmPassword']);

    return (
        <div className="w-full max-w-md space-y-8">
            <div className="space-y-2 text-center">
                <h1 className="text-foreground text-2xl font-semibold">
                    {t('heading')}
                </h1>
                <p className="text-muted-foreground text-sm">
                    {t('description')}
                </p>
            </div>

            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <UiPasswordInput
                    {...form.register('newPassword', {
                        onChange: () => {
                            if (errors.confirmPassword?.type === 'mismatch') {
                                form.clearErrors('confirmPassword');
                            }
                        },
                    })}
                    placeholder={t('new_password_placeholder')}
                    error={getFieldError(
                        errors.newPassword,
                        {
                            required: t('password_required'),
                            too_small: t('password_too_short'),
                        },
                        newPwd,
                    )}
                    disabled={isSubmitting}
                    autoFocus
                    size="lg"
                />

                <UiPasswordInput
                    {...form.register('confirmPassword', {
                        onChange: () => {
                            if (errors.confirmPassword?.type === 'mismatch') {
                                form.clearErrors('confirmPassword');
                            }
                        },
                    })}
                    placeholder={t('confirm_password_placeholder')}
                    error={
                        errors.confirmPassword?.type === 'mismatch'
                            ? errors.confirmPassword.message
                            : getFieldError(
                                  errors.confirmPassword,
                                  {
                                      required: t('password_required'),
                                      too_small: t('password_too_short'),
                                  },
                                  confirmPwd,
                              )
                    }
                    disabled={isSubmitting}
                    size="lg"
                />

                <UiButton
                    type="submit"
                    variant="filled"
                    size="lg"
                    disabled={isSubmitting}
                    className="w-full"
                >
                    {isSubmitting ? (
                        <UiSpinner size="sm" />
                    ) : (
                        t('submit_button')
                    )}
                </UiButton>
            </form>

            <div className="text-center">
                <UiButton
                    as="link"
                    href={`/${locale}/auth/signin`}
                    variant="text"
                    size="sm"
                >
                    {t('back_to_signin')}
                </UiButton>
            </div>
        </div>
    );
}

export default function ResetPasswordPage() {
    return (
        <Suspense fallback={<UiFullPageLoader />}>
            <ResetPasswordContent />
        </Suspense>
    );
}
