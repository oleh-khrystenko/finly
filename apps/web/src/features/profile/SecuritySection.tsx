'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AxiosError } from 'axios';
import { toast } from 'sonner';
import { z } from 'zod';
import { Pencil, ShieldCheck, ShieldOff } from 'lucide-react';
import type { UserProfile } from '@cyanship/types';
import { passwordSchema } from '@cyanship/types';
import UiButton from '@/shared/ui/UiButton';
import UiPasswordInput from '@/shared/ui/UiPasswordInput';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSpinner from '@/shared/ui/UiSpinner';
import { setPassword, getMe } from '@/shared/api';
import { useAuthStore } from '@/entities/user';
import ChangePasswordForm from './ChangePasswordForm';

const SetPasswordFormSchema = z.object({
    password: z.string(),
});

type SetPasswordFormValues = z.input<typeof SetPasswordFormSchema>;

export type ProfileMode = 'new' | 'set-password' | null;

interface SecuritySectionProps {
    user: UserProfile;
    mode: ProfileMode;
}

const SecuritySection = ({ user, mode }: SecuritySectionProps) => {
    const t = useTranslations('profile_page.security');
    const setUser = useAuthStore((s) => s.setUser);

    const [editing, setEditing] = useState(false);

    const form = useForm<SetPasswordFormValues>({
        resolver: zodResolver(SetPasswordFormSchema),
        defaultValues: { password: '' },
    });

    const { errors, isSubmitting } = form.formState;
    const password = form.watch('password');

    const hasPassword = user.hasPassword;

    const isSetMode =
        !hasPassword &&
        (mode === 'new' ||
            mode === 'set-password' ||
            mode === null);

    const isChangeMode = hasPassword && (mode === null || mode === undefined);

    const isPasswordOptional = mode === 'new' || mode === 'set-password';

    const isViewMode = isChangeMode && !editing;

    const onSetPassword = async (data: SetPasswordFormValues) => {
        if (isPasswordOptional && !data.password) {
            return;
        }

        const result = passwordSchema.safeParse(data.password);
        if (!result.success) {
            form.setError('password', {
                type: 'validate',
                message: t('password_too_short'),
            });
            return;
        }

        try {
            await setPassword(data.password);
            const me = await getMe();
            setUser(me);
            toast.success(t('password_set'));
            form.reset();
        } catch (err) {
            const code =
                err instanceof AxiosError
                    ? err.response?.data?.error?.code
                    : undefined;

            if (code === 'RATE_LIMIT_EXCEEDED') {
                toast.error(t('error_rate_limit'));
            } else {
                toast.error(t('error_generic'));
            }
        }
    };

    return (
        <UiSectionCard
            title={t('heading')}
            headerRight={
                isViewMode ? (
                    <UiButton
                        variant="text"
                        size="sm"
                        IconLeft={<Pencil />}
                        onClick={() => setEditing(true)}
                    >
                        {t('edit_button')}
                    </UiButton>
                ) : undefined
            }
        >
            {isSetMode && (
                <p className="text-muted-foreground mt-1 text-sm">
                    {isPasswordOptional
                        ? t('set_password_optional')
                        : t('set_password')}
                </p>
            )}

            {/* View mode — password status */}
            {isViewMode && (
                <dl className="mt-5">
                    <div className="flex items-center gap-2">
                        <dt className="text-muted-foreground text-sm">
                            {t('password_label')}
                        </dt>
                        <dd className="flex items-center gap-1.5">
                            <ShieldCheck className="size-4 text-success" />
                            <span className="text-success text-sm font-medium">
                                {t('password_active')}
                            </span>
                        </dd>
                    </div>
                </dl>
            )}

            {/* Set password mode */}
            {isSetMode && (
                <form onSubmit={form.handleSubmit(onSetPassword)} className="mt-5 space-y-4">
                    <div className="flex items-center gap-2">
                        <ShieldOff className="size-4 text-muted-foreground" />
                        <span className="text-muted-foreground text-sm">
                            {t('password_not_set')}
                        </span>
                    </div>
                    <UiPasswordInput
                        {...form.register('password', {
                            onChange: () => {
                                if (errors.password) {
                                    form.clearErrors('password');
                                }
                            },
                        })}
                        placeholder={t('password_placeholder')}
                        error={errors.password?.message}
                        required={!isPasswordOptional}
                        size="lg"
                        showLabel={t('show_password')}
                        hideLabel={t('hide_password')}
                    />
                    <UiButton
                        type="submit"
                        variant="filled"
                        size="md"
                        disabled={
                            isSubmitting ||
                            (!isPasswordOptional && !password)
                        }
                    >
                        {isSubmitting ? (
                            <UiSpinner size="sm" />
                        ) : (
                            t('set_password')
                        )}
                    </UiButton>
                </form>
            )}

            {/* Change password form */}
            {isChangeMode && editing && (
                <ChangePasswordForm
                    onDone={() => setEditing(false)}
                    onCancel={() => setEditing(false)}
                />
            )}
        </UiSectionCard>
    );
};

export default SecuritySection;
