'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { z } from 'zod';
import { firstNameSchema, lastNameSchema } from '@neatslip/types';
import type { UserProfile } from '@neatslip/types';
import UiButton from '@/shared/ui/UiButton';
import UiInput from '@/shared/ui/UiInput';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSpinner from '@/shared/ui/UiSpinner';
import { getFieldError } from '@/shared/lib';
import { updateProfile, getMe } from '@/shared/api';
import { useAuthStore } from '@/entities/user';

import AvatarEditButton from './AvatarEditButton';
import { useAvatarUploadDialogStore } from './avatarUploadDialogStore';

const ProfileFormSchema = z.object({
    firstName: firstNameSchema,
    lastName: z.union([lastNameSchema, z.literal('')]),
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

const NAME_MESSAGES = {
    required: "Ім'я обов'язкове",
    too_small: "Ім'я має містити щонайменше 2 символи",
    too_big: 'Має містити не більше 50 символів',
    invalid_string:
        "Ім'я може містити лише літери, пробіли, дефіси та апострофи",
    invalid_format:
        "Ім'я може містити лише літери, пробіли, дефіси та апострофи",
};

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
    const [firstNameValue, lastNameValue] = form.watch([
        'firstName',
        'lastName',
    ]);

    const onSubmit = async (data: ProfileFormValues) => {
        const firstName = data.firstName.trim();
        const lastName = data.lastName.trim();

        try {
            await updateProfile({
                firstName,
                ...(lastName ? { lastName } : { lastName: '' }),
            });
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
                        error={getFieldError(
                            errors.firstName,
                            NAME_MESSAGES,
                            firstNameValue,
                        )}
                        disabled={!editable}
                        size="lg"
                    />
                </div>

                <div>
                    <label className="text-muted-foreground mb-1.5 block text-sm">
                        Прізвище
                    </label>
                    <UiInput
                        {...form.register('lastName')}
                        type="text"
                        placeholder="Ваше прізвище"
                        error={getFieldError(
                            errors.lastName,
                            NAME_MESSAGES,
                            lastNameValue,
                        )}
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
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? (
                                <UiSpinner size="sm" />
                            ) : (
                                'Зберегти'
                            )}
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
