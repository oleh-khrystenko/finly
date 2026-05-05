'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Mail } from 'lucide-react';
import { AxiosError } from 'axios';
import { toast } from 'sonner';
import { z } from 'zod';
import { CheckEmailSchema } from '@finly/types';
import type { MagicLinkPurpose } from '@finly/types';
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
    getApiMessage,
} from '@/shared/api';
import {
    saveRedirect,
    consumeRedirect,
    getZodFieldError,
    INTL_LOCALE,
} from '@/shared/lib';
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

const TOO_MANY_ATTEMPTS = (minutes: number) =>
    `Забагато спроб. Спробуйте через ${minutes} хвилин або скористайтесь посиланням «Забули пароль?»`;
const ERROR_GENERIC = 'Щось пішло не так. Спробуйте ще раз';

function SigninContent() {
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

    const [state, setState] = useState<SigninState>(
        startWithPassword ? 'password' : 'email',
    );
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
            await sendMagicLink(email, lastPurposeRef.current);
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
            setErrorMessage(TOO_MANY_ATTEMPTS(minutes));
        } else if (code) {
            setErrorMessage(getApiMessage(code, fallbackKey ?? 'auth'));
        } else {
            setErrorMessage(ERROR_GENERIC);
        }
    };

    const handleTermsChange = (checked: boolean) => {
        setAgreedToTerms(checked);
        if (checked) setTermsError('');
    };

    const handleGoogleSignin = () => {
        if (!agreedToTerms) {
            setTermsError(
                'Для продовження прийміть Умови використання та Політику конфіденційності',
            );
            return;
        }
        window.location.href = `${ENV.NEXT_PUBLIC_API_URL}/auth/google`;
    };

    const onEmailSubmit = async (data: EmailFormValues) => {
        if (!agreedToTerms) {
            setTermsError(
                'Для продовження прийміть Умови використання та Політику конфіденційності',
            );
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
                await sendMagicLink(
                    data.email,
                    purpose,
                    redirect ?? undefined,
                );
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
                            (1000 * 60 * 60 * 24),
                    ),
                );

                setDeletedAt(deleted.toLocaleDateString(INTL_LOCALE));
                setDeletedDaysLeft(daysLeft);
                document.cookie = 'bid_account_deleted=true; path=/';
                setState('recovery');
            } else {
                const me = await getMe();
                setUser(me);
                router.push(consumeRedirect('/business'));
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
                    message: TOO_MANY_ATTEMPTS(minutes),
                });
            } else if (code === 'UNAUTHORIZED') {
                passwordForm.setError('root.serverError', {
                    message: 'Невірний email або пароль',
                });
            } else {
                const message = code
                    ? getApiMessage(code, 'auth')
                    : ERROR_GENERIC;
                passwordForm.setError('root.serverError', { message });
            }
        }
    };

    const handleForgotPassword = async () => {
        setSubmitting(true);
        const sentMessage =
            'Якщо акаунт з цією адресою існує, ми надіслали посилання для зміни пароля';
        try {
            lastPurposeRef.current = 'reset-password';
            await sendMagicLink(email, 'reset-password');
            toast.success(sentMessage);
            startResendTimer();
            setState('magic-link-sent');
        } catch {
            toast.success(sentMessage);
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
            toast.success('Акаунт відновлено!');
            const me = await getMe();
            setUser(me);
            router.push(consumeRedirect('/business'));
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
            await sendMagicLink(email, 'login');
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
                    ? 'Акаунт деактивовано'
                    : 'Вхід до Finly'}
            </h1>
            {state === 'email' && (
                <p className="text-muted-foreground mt-2">
                    Запустіть свій SaaS швидше — auth, payments та i18n з
                    коробки
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
                Я погоджуюсь з{' '}
                <UiLink
                    href="/terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    variant="primary-underline"
                    onClick={(e) => e.stopPropagation()}
                >
                    Умовами використання
                </UiLink>{' '}
                та{' '}
                <UiLink
                    href="/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    variant="primary-underline"
                    onClick={(e) => e.stopPropagation()}
                >
                    Політикою конфіденційності
                </UiLink>
            </UiCheckbox>

            <UiButton
                variant="text"
                size="lg"
                className="w-full justify-center gap-3 border border-border bg-card text-foreground hover:bg-secondary hover:text-foreground"
                IconLeft={<GoogleIcon />}
                onClick={handleGoogleSignin}
            >
                Увійти через Google
            </UiButton>

            <div className="flex items-center gap-4">
                <div className="h-px flex-1 bg-border" />
                <span className="text-muted-foreground text-sm">або</span>
                <div className="h-px flex-1 bg-border" />
            </div>

            <form
                onSubmit={emailForm.handleSubmit(onEmailSubmit)}
                className="space-y-4"
            >
                <UiInput
                    {...emailForm.register('email')}
                    type="email"
                    placeholder="your@email.com"
                    error={getZodFieldError(emailForm.formState.errors.email)}
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
                    Продовжити
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
        <form
            onSubmit={passwordForm.handleSubmit(onPasswordSubmit)}
            className="space-y-4"
        >
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
                    Змінити
                </UiButton>
            </div>

            <UiPasswordInput
                {...passwordForm.register('password', {
                    onChange: () => passwordForm.clearErrors('root'),
                })}
                placeholder="Введіть пароль"
                error={
                    passwordForm.formState.errors.password
                        ? 'Введіть пароль'
                        : passwordForm.formState.errors.root?.serverError
                              ?.message
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
                    Забули пароль?
                </UiButton>
            </div>

            <UiButton
                type="submit"
                variant="filled"
                size="lg"
                className="relative w-full justify-center"
                disabled={isPasswordBusy}
            >
                <span
                    className={
                        passwordForm.formState.isSubmitting ? 'invisible' : ''
                    }
                >
                    Увійти
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
                    Увійти через email-посилання
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
                    Перевірте пошту
                </h2>
                <p className="text-muted-foreground mt-1 text-sm">
                    Ми надіслали посилання на{' '}
                    <span className="text-foreground font-semibold">
                        {email}
                    </span>
                    . Перевірте папку «Вхідні» та натисніть на посилання для
                    входу.
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
                    {resending ? (
                        <UiSpinner size="sm" />
                    ) : resendCountdown > 0 ? (
                        `Повторно через ${resendCountdown}с`
                    ) : (
                        'Надіслати повторно'
                    )}
                </UiButton>

                <UiButton
                    variant="text"
                    size="sm"
                    onClick={goBackToEmail}
                    className="text-muted-foreground text-sm hover:underline"
                >
                    &larr; Інший email
                </UiButton>
            </div>
        </div>
    );

    // --- State: recovery ---
    const renderRecoveryState = () => (
        <div className="space-y-4">
            <p className="text-muted-foreground text-center">
                Ваш акаунт було видалено {deletedAt ?? ''}. Він буде остаточно
                видалено через {deletedDaysLeft} днів.
            </p>

            <UiButton
                variant="filled"
                size="lg"
                className="w-full justify-center"
                disabled={submitting}
                onClick={handleRestore}
            >
                {submitting ? <UiSpinner size="sm" /> : 'Відновити акаунт'}
            </UiButton>

            <UiButton
                variant="text"
                size="lg"
                className="w-full justify-center"
                onClick={goBackToEmail}
            >
                Вийти
            </UiButton>
        </div>
    );

    // --- State: error ---
    const renderErrorState = () => (
        <div className="space-y-4">
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-center">
                <p className="text-destructive text-sm font-medium">
                    {errorMessage || ERROR_GENERIC}
                </p>
            </div>

            <UiButton
                variant="filled"
                size="lg"
                className="w-full justify-center"
                onClick={goBackToEmail}
            >
                Продовжити
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
        <Suspense fallback={<UiSpinner size="lg" />}>
            <SigninContent />
        </Suspense>
    );
}
