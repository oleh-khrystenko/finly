'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AxiosError } from 'axios';
import { toast } from 'sonner';
import { z } from 'zod';
import { Pencil, ShieldCheck, ShieldOff } from 'lucide-react';
import type { UserProfile } from '@finly/types';
import { passwordSchema } from '@finly/types';
import UiButton from '@/shared/ui/UiButton';
import UiPasswordInput from '@/shared/ui/UiPasswordInput';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import { setPassword, getMe } from '@/shared/api';
import { mapValidationCode } from '@/shared/lib';
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
    const setUser = useAuthStore((s) => s.setUser);

    const [editing, setEditing] = useState(false);

    const form = useForm<SetPasswordFormValues>({
        resolver: zodResolver(SetPasswordFormSchema),
        defaultValues: { password: '' },
    });

    const { errors, isSubmitting } = form.formState;

    const hasPassword = user.hasPassword;

    const isSetMode =
        !hasPassword &&
        (mode === 'new' || mode === 'set-password' || mode === null);

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
                message:
                    result.error.issues[0]?.message ??
                    'INVALID_PASSWORD_TOO_SHORT',
            });
            return;
        }

        try {
            await setPassword(data.password);
            const me = await getMe();
            setUser(me);
            toast.success('Пароль встановлено');
            form.reset();
        } catch (err) {
            const code =
                err instanceof AxiosError
                    ? err.response?.data?.error?.code
                    : undefined;

            if (code === 'RATE_LIMIT_EXCEEDED') {
                toast.error('Забагато запитів. Спробуйте через 15 хвилин');
            } else {
                toast.error('Не вдалося виконати операцію. Спробуйте пізніше');
            }
        }
    };

    return (
        <UiSectionCard
            title="Безпека"
            headerRight={
                isViewMode ? (
                    <UiButton
                        variant="text"
                        size="sm"
                        IconLeft={<Pencil />}
                        onClick={() => setEditing(true)}
                    >
                        Змінити
                    </UiButton>
                ) : undefined
            }
        >
            {isSetMode && (
                <p className="text-muted-foreground mt-1 text-sm">
                    {isPasswordOptional
                        ? 'Встановити пароль (опціонально)'
                        : 'Встановити пароль'}
                </p>
            )}

            {/* View mode — password status */}
            {isViewMode && (
                <dl className="mt-5">
                    <div className="flex items-center gap-2">
                        <dt className="text-muted-foreground text-sm">
                            Пароль
                        </dt>
                        <dd className="flex items-center gap-1.5">
                            <ShieldCheck className="text-success size-4" />
                            <span className="text-success text-sm font-medium">
                                Встановлено
                            </span>
                        </dd>
                    </div>
                </dl>
            )}

            {/* Set password mode */}
            {isSetMode && (
                <form
                    onSubmit={form.handleSubmit(onSetPassword)}
                    className="mt-5 space-y-4"
                >
                    <div className="flex items-center gap-2">
                        <ShieldOff className="text-muted-foreground size-4" />
                        <span className="text-muted-foreground text-sm">
                            Пароль не встановлено
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
                        placeholder="Мінімум 8 символів"
                        error={mapValidationCode(errors.password?.message)}
                        required={!isPasswordOptional}
                        size="lg"
                        showLabel="Показати пароль"
                        hideLabel="Сховати пароль"
                    />
                    <UiButton
                        type="submit"
                        variant="filled"
                        size="md"
                        loading={isSubmitting}
                    >
                        Встановити пароль
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
