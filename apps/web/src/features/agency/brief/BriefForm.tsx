'use client';

import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AxiosError } from 'axios';
import { toast } from 'sonner';
import { z } from 'zod';
import {
    SubmitBriefSchema,
    BRIEF_BUDGET,
    BRIEF_DEADLINE,
} from '@cyanship/types';

import UiButton from '@/shared/ui/UiButton';
import UiInput from '@/shared/ui/UiInput';
import UiTextarea from '@/shared/ui/UiTextarea';
import UiSelect from '@/shared/ui/UiSelect';
import UiChipGroup from '@/shared/ui/UiChipGroup';
import { submitBrief, submitAuthenticatedBrief } from '@/shared/api/agency';
import { getMe } from '@/shared/api/auth';
import { getApiMessageKey } from '@/shared/api/mapApiCode';
import { getFieldError } from '@/shared/lib';
import { useAuthStore } from '@/entities/user';
import { useBriefDialogStore } from './briefDialogStore';
import { getSource } from './lib/source';
import { useTurnstile } from './lib/useTurnstile';

const BriefFormSchema = SubmitBriefSchema.pick({
    name: true,
    email: true,
    description: true,
    budget: true,
    deadline: true,
});

type BriefFormValues = z.input<typeof BriefFormSchema>;

interface BriefFormProps {
    onSuccess: () => void;
}

export default function BriefForm({ onSuccess }: BriefFormProps) {
    const t = useTranslations('brief_form');
    const tGlobal = useTranslations();
    const locale = useLocale();

    const user = useAuthStore((s) => s.user);
    const requestAiBonus = useBriefDialogStore((s) => s.requestAiBonus);
    const isAuthenticated = requestAiBonus && !!user;

    const {
        register,
        control,
        handleSubmit,
        watch,
        formState: { errors, isSubmitting },
    } = useForm<BriefFormValues>({
        resolver: zodResolver(BriefFormSchema),
        mode: 'onTouched',
        defaultValues: {
            name: isAuthenticated
                ? [user.profile.firstName, user.profile.lastName]
                      .filter(Boolean)
                      .join(' ')
                : '',
            email: isAuthenticated ? user.email : '',
            description: '',
        },
    });

    const [nameValue, emailValue, descriptionValue] = watch([
        'name',
        'email',
        'description',
    ]);

    const { containerRef, execute: executeTurnstile, reset: resetTurnstile } = useTurnstile();

    const budgetOptions = useMemo(
        () => [
            { value: BRIEF_BUDGET.UNDER_2500, label: t('budget_under_2500') },
            {
                value: BRIEF_BUDGET.FROM_2500_TO_5000,
                label: t('budget_2500_5000'),
            },
            {
                value: BRIEF_BUDGET.FROM_5000_TO_10000,
                label: t('budget_5000_10000'),
            },
            { value: BRIEF_BUDGET.OVER_10000, label: t('budget_over_10000') },
        ],
        [t],
    );

    const deadlineOptions = useMemo(
        () => [
            { value: BRIEF_DEADLINE.ASAP, label: t('deadline_asap') },
            {
                value: BRIEF_DEADLINE.ONE_TO_THREE_MONTHS,
                label: t('deadline_1_3_months'),
            },
            { value: BRIEF_DEADLINE.FLEXIBLE, label: t('deadline_flexible') },
        ],
        [t],
    );

    const onSubmit = async (data: BriefFormValues) => {
        let captchaToken: string;
        try {
            captchaToken = await executeTurnstile();
        } catch {
            toast.error(t('captcha_not_ready'));
            return;
        }

        const { deadline, ...fields } = data;
        const payload = {
            ...fields,
            ...(deadline && { deadline }),
            source: getSource(),
            lang: locale,
            captchaToken,
        };

        try {
            if (isAuthenticated) {
                const { code } = await submitAuthenticatedBrief(payload);
                const messageKey = getApiMessageKey(code, 'agency');
                toast.success(tGlobal(messageKey));

                // Refresh auth store to get updated AI bonus state
                const profile = await getMe();
                useAuthStore.getState().setUser(profile);
            } else {
                const { code } = await submitBrief(payload);
                const messageKey = getApiMessageKey(code, 'agency');
                toast.success(tGlobal(messageKey));
            }

            onSuccess();
        } catch (err) {
            resetTurnstile();
            const code =
                err instanceof AxiosError
                    ? err.response?.data?.error?.code
                    : undefined;
            if (code) {
                const messageKey = getApiMessageKey(code, 'agency');
                toast.error(tGlobal(messageKey));
            } else {
                toast.error(tGlobal('errors.generic.unknown'));
            }
        }
    };

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
            {isAuthenticated ? (
                <>
                    <div>
                        <p className="text-sm font-medium text-foreground">
                            {t('name_label')}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {nameValue}
                        </p>
                    </div>
                    <div>
                        <p className="text-sm font-medium text-foreground">
                            {t('email_label')}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {emailValue}
                        </p>
                    </div>
                </>
            ) : (
                <>
                    <UiInput
                        {...register('name')}
                        label={t('name_label')}
                        placeholder={t('name_placeholder')}
                        error={getFieldError(
                            errors.name,
                            {
                                required: t('validation_name_required'),
                                too_small: t('validation_name_min'),
                                too_big: t('validation_name_max'),
                                invalid_string: t('validation_name_format'),
                            },
                            nameValue,
                        )}
                        disabled={isSubmitting}
                        required
                    />
                    <UiInput
                        {...register('email')}
                        label={t('email_label')}
                        type="email"
                        placeholder={t('email_placeholder')}
                        error={getFieldError(
                            errors.email,
                            {
                                required: t('validation_email_required'),
                                too_big: t('validation_email_max'),
                                invalid_string: t('validation_email_format'),
                            },
                            emailValue,
                        )}
                        disabled={isSubmitting}
                        required
                    />
                </>
            )}
            <UiTextarea
                {...register('description')}
                label={t('description_label')}
                placeholder={t('description_placeholder')}
                rows={4}
                error={getFieldError(
                    errors.description,
                    {
                        required: t('validation_description_required'),
                        too_small: t('validation_description_min'),
                        too_big: t('validation_description_max'),
                    },
                    descriptionValue,
                )}
                disabled={isSubmitting}
                required
            />
            <Controller
                name="budget"
                control={control}
                render={({ field }) => (
                    <UiSelect
                        label={t('budget_label')}
                        options={budgetOptions}
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        placeholder={t('budget_placeholder')}
                        variant="outlined"
                        error={errors.budget && t('validation_budget')}
                        disabled={isSubmitting}
                        required
                    />
                )}
            />
            <Controller
                name="deadline"
                control={control}
                render={({ field }) => (
                    <UiChipGroup
                        label={t('deadline_label')}
                        options={deadlineOptions}
                        value={field.value ?? ''}
                        onChange={field.onChange}
                    />
                )}
            />

            {/* Turnstile invisible container — challenge deferred until submit */}
            <div ref={containerRef} />

            <UiButton
                type="submit"
                variant="filled"
                size="lg"
                disabled={isSubmitting}
                className="mt-2 w-full font-semibold"
            >
                {isSubmitting ? t('submitting') : t('submit')}
            </UiButton>
        </form>
    );
}
