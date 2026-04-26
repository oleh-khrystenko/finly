'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Mail } from 'lucide-react';
import { AxiosError } from 'axios';
import { toast } from 'sonner';
import { z } from 'zod';
import { CheckEmailSchema } from '@cyanship/types';
import type { MagicLinkPurpose } from '@cyanship/types';
import UiButton from '@/shared/ui/UiButton';
import UiLink from '@/shared/ui/UiLink';
import UiCheckbox from '@/shared/ui/UiCheckbox';
import UiInput from '@/shared/ui/UiInput';
import UiPasswordInput from '@/shared/ui/UiPasswordInput';
import UiSpinner from '@/shared/ui/UiSpinner';
import { GoogleIcon } from '@/shared/icons';
import { ENV } from '@/shared/config';
import {
    checkEmail,
    loginWithPassword,
    sendMagicLink,
    restoreAccount,
    getMe,
    getApiMessageKey,
} from '@/shared/api';
import { saveRedirect, consumeRedirect, getFieldError } from '@/shared/lib';
import { useAuthStore } from '@/entities/user';
import SessionExpiredHandler from '@/features/auth/SessionExpiredHandler';

const EmailFormSchema = CheckEmailSchema;
type EmailFormValues = z.input<typeof EmailFormSchema>;

const PasswordFormSchema = z.object({
    password: z.string().min(1),
});
type PasswordFormValues = z.input<typeof PasswordFormSchema>;

type SigninState =
    | 'email'
    | 'loading'
    | 'password'
    | 'magic-link-sent'
    | 'recovery'
    | 'error';

function SigninContent() {
    const t = useTranslations('auth_page.signin');
    const tRecovery = useTranslations('auth_page.recovery');
    const tErrors = useTranslations();
    const locale = useLocale();
    const router = useRouter();
    const searchParams = useSearchParams();
    const redirect = searchParams.get('redirect');
    const initialEmail = searchParams.get('email');
    const initialStep = searchParams.get('step');
    const startWithPassword = !!(initialEmail && initialStep === 'password');

    const setUser = useAuthStore((s) => s.setUser);

    const emailForm = useForm<EmailFormValues>({
        resolver: zodResolver(EmailFormSchema),
        mode: 'onTouched',
        defaultValues: { email: startWithPassword ? initialEmail! : '' },
    });

    const passwordForm = useForm<PasswordFormValues>({
        resolver: zodResolver(PasswordFormSchema),
        mode: 'onTouched',
        defaultValues: { password: '' },
    });

    const [state, setState] = useState<SigninState>(startWithPassword ? 'password' : 'email');
    const [email, setEmail] = useState(startWithPassword ? initialEmail : '');
    const [errorMessage, setErrorMessage] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [showMagicLinkSuggestion, setShowMagicLinkSuggestion] =
        useState(false);
    const [deletedAt, setDeletedAt] = useState<string | null>(null);
    const [deletedDaysLeft, setDeletedDaysLeft] = useState(0);
    const [resendCountdown, setResendCountdown] = useState(0);
    const [resending, setResending] = useState(false);
    const [agreedToTerms, setAgreedToTerms] = useState(startWithPassword);
    const [termsError, setTermsError] = useState('');
    const lastPurposeRef = useRef<MagicLinkPurpose>('login');
    const timerRef = useRef<ReturnType<typeof setInterval>>(null);

    useEffect(() => {
        if (redirect) saveRedirect(redirect);
    }, [redirect]);

    const startResendTimer = useCallback(() => {
        setResendCountdown(60);
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = setInterval(() => {
            setResendCountdown((prev) => {
                if (prev <= 1) {
                    clearInterval(timerRef.current!);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
    }, []);

    useEffect(() => {
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, []);

    const handleResend = async () => {
        setResending(true);
        try {
            await sendMagicLink(email, locale, lastPurposeRef.current);
            startResendTimer();
        } catch {
            // dedup на бекенді — не показуємо помилку
        } finally {
            setResending(false);
        }
    };

    const handleError = (err: unknown, fallbackKey?: string) => {
        const code =
            err instanceof AxiosError
                ? err.response?.data?.error?.code
                : undefined;

        if (code === 'RATE_LIMIT_EXCEEDED') {
            const retryAfter =
                err instanceof AxiosError
                    ? err.response?.headers?.['retry-after']
                    : undefined;
            const minutes = retryAfter
                ? Math.ceil(Number(retryAfter) / 60)
                : 15;
            setErrorMessage(t('too_many_attempts', { minutes }));
        } else if (code) {
            setErrorMessage(
                tErrors(getApiMessageKey(code, fallbackKey ?? 'auth'))
            );
        } else {
            setErrorMessage(t('error_generic'));
        }
    };

    const handleTermsChange = (checked: boolean) => {
        setAgreedToTerms(checked);
        if (checked) setTermsError('');
    };

    const handleGoogleSignin = () => {
        if (!agreedToTerms) {
            setTermsError(t('terms_required'));
            return;
        }
        window.location.href = `${ENV.NEXT_PUBLIC_API_URL}/auth/google`;
    };

    const onEmailSubmit = async (data: EmailFormValues) => {
        if (!agreedToTerms) {
            setTermsError(t('terms_required'));
            return;
        }
        setEmail(data.email);
        setState('loading');
        setErrorMessage('');

        try {
            const { hasPassword, isNewUser } = await checkEmail(data.email);

            if (hasPassword) {
                setState('password');
            } else {
                const purpose = isNewUser ? 'register' : 'login';
                lastPurposeRef.current = purpose;
                await sendMagicLink(data.email, locale, purpose, redirect ?? undefined);
                startResendTimer();
                setState('magic-link-sent');
            }
        } catch (err) {
            handleError(err);
            setState('error');
        }
    };

    const onPasswordSubmit = async (data: PasswordFormValues) => {
        passwordForm.clearErrors('root');
        setShowMagicLinkSuggestion(false);

        try {
            const result = await loginWithPassword(email, data.password);

            if (result.accountDeleted) {
                const deleted = result.user.deletedAt
                    ? new Date(result.user.deletedAt)
                    : new Date();
                const gracePeriodEnd = new Date(deleted);
                gracePeriodEnd.setDate(gracePeriodEnd.getDate() + 30);
                const daysLeft = Math.max(
                    0,
                    Math.ceil(
                        (gracePeriodEnd.getTime() - Date.now()) /
                            (1000 * 60 * 60 * 24)
                    )
                );

                setDeletedAt(deleted.toLocaleDateString(locale));
                setDeletedDaysLeft(daysLeft);
                document.cookie = 'bid_account_deleted=true; path=/';
                setState('recovery');
            } else {
                const me = await getMe();
                setUser(me);
                router.push(consumeRedirect(`/${locale}/dashboard`));
            }
        } catch (err) {
            const code =
                err instanceof AxiosError
                    ? err.response?.data?.error?.code
                    : undefined;

            if (code === 'RATE_LIMIT_EXCEEDED') {
                setShowMagicLinkSuggestion(true);
                const retryAfter =
                    err instanceof AxiosError
                        ? err.response?.headers?.['retry-after']
                        : undefined;
                const minutes = retryAfter
                    ? Math.ceil(Number(retryAfter) / 60)
                    : 15;
                passwordForm.setError('root.serverError', {
                    message: t('too_many_attempts', { minutes }),
                });
            } else if (code === 'UNAUTHORIZED') {
                passwordForm.setError('root.serverError', {
                    message: t('invalid_credentials'),
                });
            } else {
                const message = code
                    ? tErrors(getApiMessageKey(code, 'auth'))
                    : t('error_generic');
                passwordForm.setError('root.serverError', { message });
            }
        }
    };

    const handleForgotPassword = async () => {
        setSubmitting(true);
        try {
            lastPurposeRef.current = 'reset-password';
            await sendMagicLink(email, locale, 'reset-password');
            toast.success(t('forgot_password_sent'));
            startResendTimer();
            setState('magic-link-sent');
        } catch {
            toast.success(t('forgot_password_sent'));
            setState('magic-link-sent');
        } finally {
            setSubmitting(false);
        }
    };

    const handleRestore = async () => {
        setSubmitting(true);
        try {
            await restoreAccount();
            document.cookie = 'bid_account_deleted=; path=/; max-age=0';
            toast.success(tRecovery('restored'));
            const me = await getMe();
            setUser(me);
            router.push(consumeRedirect(`/${locale}/dashboard`));
        } catch (err) {
            setSubmitting(false);
            handleError(err);
            setState('error');
        }
    };

    const handleSendMagicLinkFromPassword = async () => {
        setSubmitting(true);
        try {
            lastPurposeRef.current = 'login';
            await sendMagicLink(email, locale, 'login');
            startResendTimer();
            setState('magic-link-sent');
            setShowMagicLinkSuggestion(false);
        } catch {
            setState('magic-link-sent');
            setShowMagicLinkSuggestion(false);
        } finally {
            setSubmitting(false);
        }
    };

    const goBackToEmail = () => {
        setState('email');
        passwordForm.reset();
        setErrorMessage('');
        setTermsError('');
        setSubmitting(false);
        setShowMagicLinkSuggestion(false);
    };

    // --- Header ---
    const renderHeader = () => (
        <div className="text-center">
            <h1 className="text-foreground text-3xl font-bold">
                {state === 'recovery'
                    ? tRecovery('title')
                    : t('heading')}
            </h1>
            {state === 'email' && (
                <p className="text-muted-foreground mt-2">
                    {t('subheading')}
                </p>
            )}
        </div>
    );

    // --- State: email ---
    const renderEmailState = () => (
        <>
            <UiCheckbox
                checked={agreedToTerms}
                onChange={handleTermsChange}
                size="sm"
                error={termsError}
            >
                {t.rich('terms_agree', {
                    terms: (chunks) => (
                        <UiLink
                            href={`/${locale}/terms`}
                            target="_blank"
                            rel="noopener noreferrer"
                            variant="primary-underline"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {chunks}
                        </UiLink>
                    ),
                    privacy: (chunks) => (
                        <UiLink
                            href={`/${locale}/privacy`}
                            target="_blank"
                            rel="noopener noreferrer"
                            variant="primary-underline"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {chunks}
                        </UiLink>
                    ),
                })}
            </UiCheckbox>

            <UiButton
                variant="text"
                size="lg"
                className="w-full justify-center gap-3 border border-border bg-card text-foreground hover:bg-secondary hover:text-foreground"
                IconLeft={<GoogleIcon />}
                onClick={handleGoogleSignin}
            >
                {t('google_button')}
            </UiButton>

            <div className="flex items-center gap-4">
                <div className="h-px flex-1 bg-border" />
                <span className="text-muted-foreground text-sm">
                    {t('or_divider')}
                </span>
                <div className="h-px flex-1 bg-border" />
            </div>

            <form onSubmit={emailForm.handleSubmit(onEmailSubmit)} className="space-y-4">
                <UiInput
                    {...emailForm.register('email')}
                    type="email"
                    placeholder={t('email_placeholder')}
                    error={getFieldError(
                        emailForm.formState.errors.email,
                        {
                            required: t('validation_email_required'),
                            invalid_string: t('validation_email_format'),
                        },
                    )}
                    required
                    IconLeft={<Mail />}
                    size="lg"
                />

                <UiButton
                    type="submit"
                    variant="filled"
                    size="lg"
                    className="w-full justify-center"
                    disabled={emailForm.formState.isSubmitting}
                >
                    {t('continue_button')}
                </UiButton>
            </form>
        </>
    );

    // --- State: loading ---
    const renderLoadingState = () => (
        <div className="flex justify-center py-8">
            <UiSpinner size="lg" />
        </div>
    );

    // --- State: password ---
    const isPasswordBusy = passwordForm.formState.isSubmitting || submitting;

    const renderPasswordState = () => (
        <form onSubmit={passwordForm.handleSubmit(onPasswordSubmit)} className="space-y-4">
            <div className="relative">
                <UiInput
                    type="email"
                    value={email}
                    readOnly
                    IconLeft={<Mail />}
                    size="lg"
                    className="pr-20"
                />
                <UiButton
                    variant="text"
                    size="sm"
                    onClick={goBackToEmail}
                    className="text-primary absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium hover:underline"
                >
                    {t('change_email')}
                </UiButton>
            </div>

            <UiPasswordInput
                {...passwordForm.register('password', {
                    onChange: () => passwordForm.clearErrors('root'),
                })}
                placeholder={t('password_placeholder')}
                error={
                    passwordForm.formState.errors.password
                        ? t('validation_password')
                        : passwordForm.formState.errors.root?.serverError?.message
                }
                required
                size="lg"
                autoFocus
            />

            <div className="text-right">
                <UiButton
                    variant="text"
                    size="sm"
                    onClick={handleForgotPassword}
                    disabled={isPasswordBusy}
                    className="text-primary text-sm font-medium hover:underline"
                >
                    {t('forgot_password')}
                </UiButton>
            </div>

            <UiButton
                type="submit"
                variant="filled"
                size="lg"
                className="relative w-full justify-center"
                disabled={isPasswordBusy}
            >
                <span className={passwordForm.formState.isSubmitting ? 'invisible' : ''}>
                    {t('signin_button')}
                </span>
                {passwordForm.formState.isSubmitting && (
                    <span className="absolute inset-0 flex items-center justify-center">
                        <UiSpinner size="sm" />
                    </span>
                )}
            </UiButton>

            {showMagicLinkSuggestion && (
                <UiButton
                    type="button"
                    variant="filled"
                    size="lg"
                    className="w-full justify-center border border-border bg-card text-foreground hover:bg-secondary"
                    disabled={isPasswordBusy}
                    onClick={handleSendMagicLinkFromPassword}
                    IconLeft={<Mail />}
                >
                    {t('login_via_email_link')}
                </UiButton>
            )}
        </form>
    );

    // --- State: magic-link-sent ---
    const renderMagicLinkSentState = () => (
        <div className="space-y-6">
            <div className="rounded-lg border border-success/30 bg-success/10 p-6 text-center">
                <Mail className="mx-auto mb-3 h-10 w-10 text-success" />
                <h2 className="text-foreground text-lg font-semibold">
                    {t('magic_link_sent_title')}
                </h2>
                <p className="text-muted-foreground mt-1 text-sm">
                    {t.rich('magic_link_sent_description', {
                        email,
                        bold: (chunks) => (
                            <span className="text-foreground font-semibold">
                                {chunks}
                            </span>
                        ),
                    })}
                </p>
            </div>

            <div className="flex flex-col items-center gap-2">
                <UiButton
                    variant="text"
                    size="sm"
                    onClick={handleResend}
                    disabled={resendCountdown > 0 || resending}
                    className="text-primary text-sm font-medium hover:underline"
                >
                    {resending
                        ? <UiSpinner size="sm" />
                        : resendCountdown > 0
                          ? t('resend_countdown', { seconds: resendCountdown })
                          : t('resend_button')}
                </UiButton>

                <UiButton
                    variant="text"
                    size="sm"
                    onClick={goBackToEmail}
                    className="text-muted-foreground text-sm hover:underline"
                >
                    &larr; {t('other_email')}
                </UiButton>
            </div>
        </div>
    );

    // --- State: recovery ---
    const renderRecoveryState = () => (
        <div className="space-y-4">
            <p className="text-muted-foreground text-center">
                {tRecovery('description', {
                    date: deletedAt ?? '',
                    days: deletedDaysLeft,
                })}
            </p>

            <UiButton
                variant="filled"
                size="lg"
                className="w-full justify-center"
                disabled={submitting}
                onClick={handleRestore}
            >
                {submitting ? (
                    <UiSpinner size="sm" />
                ) : (
                    tRecovery('restore_button')
                )}
            </UiButton>

            <UiButton
                variant="text"
                size="lg"
                className="w-full justify-center"
                onClick={goBackToEmail}
            >
                {tRecovery('logout_button')}
            </UiButton>
        </div>
    );

    // --- State: error ---
    const renderErrorState = () => (
        <div className="space-y-4">
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-center">
                <p className="text-destructive text-sm font-medium">
                    {errorMessage || t('error_generic')}
                </p>
            </div>

            <UiButton
                variant="filled"
                size="lg"
                className="w-full justify-center"
                onClick={goBackToEmail}
            >
                {t('continue_button')}
            </UiButton>
        </div>
    );

    return (
        <>
            <SessionExpiredHandler />
            <div className="w-full max-w-md space-y-8">
                {renderHeader()}

                {state === 'email' && renderEmailState()}
                {state === 'loading' && renderLoadingState()}
                {state === 'password' && renderPasswordState()}
                {state === 'magic-link-sent' && renderMagicLinkSentState()}
                {state === 'recovery' && renderRecoveryState()}
                {state === 'error' && renderErrorState()}
            </div>
        </>
    );
}

export default function SigninPage() {
    return (
        <Suspense
            fallback={<UiSpinner size="lg" />}
        >
            <SigninContent />
        </Suspense>
    );
}
