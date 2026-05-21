'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AxiosError } from 'axios';
import { toast } from 'sonner';
import { z } from 'zod';
import { passwordSchema } from '@finly/types';

import UiButton from '@/shared/ui/UiButton';
import UiPasswordInput from '@/shared/ui/UiPasswordInput';
import UiFullPageLoader from '@/shared/ui/UiFullPageLoader';
import { getZodFieldError } from '@/shared/lib';
import { resetPassword } from '@/shared/api';

const ResetPasswordFormSchema = z.object({
    newPassword: passwordSchema,
    confirmPassword: passwordSchema,
});

type ResetPasswordFormValues = z.input<typeof ResetPasswordFormSchema>;

type PageStatus = 'form' | 'error';

const ERROR_INVALID_TOKEN =
    'Посилання для скидання недійсне або прострочене. Запросіть нове.';
const ERROR_GENERIC = 'Щось пішло не так. Спробуйте ще раз.';

function ResetPasswordContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const token = searchParams.get('token');

    const form = useForm<ResetPasswordFormValues>({
        resolver: zodResolver(ResetPasswordFormSchema),
        mode: 'onTouched',
        defaultValues: { newPassword: '', confirmPassword: '' },
    });

    const [status, setStatus] = useState<PageStatus>(token ? 'form' : 'error');
    const [errorMessage, setErrorMessage] = useState(
        token ? '' : ERROR_INVALID_TOKEN
    );

    const onSubmit = async (data: ResetPasswordFormValues) => {
        form.clearErrors('confirmPassword');

        if (data.newPassword !== data.confirmPassword) {
            form.setError('confirmPassword', {
                type: 'mismatch',
                message: 'Паролі не збігаються',
            });
            return;
        }

        try {
            await resetPassword(token!, data.newPassword, data.confirmPassword);
            toast.success('Пароль змінено. Увійдіть із новим паролем.');
            router.replace('/auth/signin');
        } catch (err) {
            setStatus('error');
            const code =
                err instanceof AxiosError
                    ? err.response?.data?.error?.code
                    : undefined;

            if (code === 'UNAUTHORIZED' || code === 'INVALID_MAGIC_LINK') {
                setErrorMessage(ERROR_INVALID_TOKEN);
            } else {
                setErrorMessage(ERROR_GENERIC);
            }
        }
    };

    if (status === 'error') {
        return (
            <div className="w-full max-w-md space-y-6 text-center">
                <div className="border-destructive rounded-lg border p-6">
                    <p className="text-foreground text-sm">{errorMessage}</p>
                </div>
                <UiButton
                    as="link"
                    href="/auth/signin"
                    variant="filled"
                    size="lg"
                >
                    Повернутись до входу
                </UiButton>
            </div>
        );
    }

    const { errors, isSubmitting } = form.formState;

    return (
        <div className="w-full max-w-md space-y-8">
            <div className="space-y-2 text-center">
                <h1 className="text-foreground text-2xl font-semibold">
                    Встановіть новий пароль
                </h1>
                <p className="text-muted-foreground text-sm">
                    Введіть новий пароль нижче.
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
                    placeholder="Новий пароль"
                    error={getZodFieldError(errors.newPassword)}
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
                    placeholder="Підтвердіть пароль"
                    error={
                        errors.confirmPassword?.type === 'mismatch'
                            ? errors.confirmPassword.message
                            : getZodFieldError(errors.confirmPassword)
                    }
                    disabled={isSubmitting}
                    size="lg"
                />

                <UiButton
                    type="submit"
                    variant="filled"
                    size="lg"
                    loading={isSubmitting}
                    className="w-full"
                >
                    Скинути пароль
                </UiButton>
            </form>

            <div className="text-center">
                <UiButton
                    as="link"
                    href="/auth/signin"
                    variant="text"
                    size="sm"
                >
                    Повернутись до входу
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
