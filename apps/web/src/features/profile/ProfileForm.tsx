'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { z } from 'zod';
import { firstNameSchema, lastNameSchema } from '@finly/types';
import type { UserProfile } from '@finly/types';
import UiButton from '@/shared/ui/UiButton';
import UiInput from '@/shared/ui/UiInput';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import { getZodFieldError } from '@/shared/lib';
import { updateProfile, getMe } from '@/shared/api';
import { useAuthStore } from '@/entities/user';

import AvatarEditButton from './AvatarEditButton';
import { useAvatarUploadDialogStore } from './avatarUploadDialogStore';

const ProfileFormSchema = z.object({
    firstName: firstNameSchema,
    lastName: lastNameSchema,
});

type ProfileFormValues = z.input<typeof ProfileFormSchema>;

interface ProfileFormProps {
    user: UserProfile;
    editable: boolean;
    /**
     * When true (onboarding), the avatar edit affordance is hidden. Avatar
     * endpoints require a completed profile (no @SkipOnboarding), so surfacing
     * the control during onboarding would dead-end on the OnboardingInterceptor.
     */
    onboardingMode?: boolean;
    onSaved?: () => void;
}

const ProfileForm = ({
    user,
    editable,
    onboardingMode = false,
    onSaved,
}: ProfileFormProps) => {
    const setUser = useAuthStore((s) => s.setUser);
    const openAvatarDialog = useAvatarUploadDialogStore((s) => s.open);

    const form = useForm<ProfileFormValues>({
        resolver: zodResolver(ProfileFormSchema),
        mode: 'onTouched',
        defaultValues: {
            firstName: user.profile.firstName ?? '',
            lastName: user.profile.lastName ?? '',
        },
    });

    const { errors, isSubmitting, isDirty } = form.formState;

    const onSubmit = async (data: ProfileFormValues) => {
        const firstName = data.firstName.trim();
        const lastName = data.lastName.trim();

        try {
            await updateProfile({ firstName, lastName });
            const me = await getMe();
            setUser(me);
            form.reset({
                firstName: me.profile.firstName ?? '',
                lastName: me.profile.lastName ?? '',
            });
            toast.success('Профіль оновлено');
            onSaved?.();
        } catch {
            toast.error('Не вдалося зберегти профіль');
        }
    };

    const handleCancel = () => {
        form.reset();
    };

    return (
        <UiSectionCard title="Особисті дані">
            {!onboardingMode && (
                <div className="mt-5 flex justify-start">
                    <AvatarEditButton
                        user={user}
                        editable={editable}
                        ariaLabel="Редагувати фото профілю"
                        onPress={openAvatarDialog}
                    />
                </div>
            )}

            <dl className="mt-5">
                <dt className="text-muted-foreground text-sm">
                    Електронна пошта
                </dt>
                <dd className="text-foreground mt-1">{user.email}</dd>
            </dl>

            <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="mt-4 space-y-4"
            >
                <div>
                    <label className="text-muted-foreground mb-1.5 block text-sm">
                        Ім&apos;я
                        <span className="text-destructive ml-1">*</span>
                    </label>
                    <UiInput
                        {...form.register('firstName')}
                        type="text"
                        placeholder="Ваше ім'я"
                        error={getZodFieldError(errors.firstName)}
                        disabled={!editable}
                        size="lg"
                    />
                </div>

                <div>
                    <label className="text-muted-foreground mb-1.5 block text-sm">
                        Прізвище
                        <span className="text-destructive ml-1">*</span>
                    </label>
                    <UiInput
                        {...form.register('lastName')}
                        type="text"
                        placeholder="Ваше прізвище"
                        error={getZodFieldError(errors.lastName)}
                        disabled={!editable}
                        size="lg"
                    />
                </div>

                {editable && isDirty && (
                    <div className="flex items-center gap-3">
                        <UiButton
                            type="submit"
                            variant="filled"
                            size="md"
                            loading={isSubmitting}
                        >
                            Зберегти
                        </UiButton>
                        <UiButton
                            type="button"
                            variant="text"
                            size="md"
                            onClick={handleCancel}
                            disabled={isSubmitting}
                        >
                            Скасувати
                        </UiButton>
                    </div>
                )}
            </form>
        </UiSectionCard>
    );
};

export default ProfileForm;
