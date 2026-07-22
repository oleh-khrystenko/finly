import React from 'react';
import {
    act,
    render,
    screen,
    fireEvent,
    waitFor,
} from '@testing-library/react';
import { AxiosError } from 'axios';

jest.mock('@/shared/config', () => ({
    ENV: {
        NEXT_PUBLIC_API_URL: 'http://localhost:4000/api',
        NEXT_PUBLIC_BASE_URL: 'http://localhost:3000',
        NEXT_PUBLIC_PAY_PUBLIC_URL: 'http://localhost:3001',
    },
}));

const mockSendMagicLink = jest.fn();
const mockCheckEmail = jest.fn();
const mockLoginWithPassword = jest.fn();
const mockRestoreAccount = jest.fn();
const mockGetMe = jest.fn();
const mockRouterPush = jest.fn();
const mockRouterReplace = jest.fn();

jest.mock('@/shared/api', () => {
    const actual = jest.requireActual('@/shared/api');
    return {
        ...actual,
        checkEmail: (...args: unknown[]) => mockCheckEmail(...args),
        sendMagicLink: (...args: unknown[]) => mockSendMagicLink(...args),
        loginWithPassword: (...args: unknown[]) =>
            mockLoginWithPassword(...args),
        restoreAccount: (...args: unknown[]) => mockRestoreAccount(...args),
        getMe: (...args: unknown[]) => mockGetMe(...args),
    };
});

let mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: mockRouterPush, replace: mockRouterReplace }),
    useSearchParams: () => mockSearchParams,
    usePathname: () => '/auth/signin',
}));

jest.mock('sonner', () => ({
    toast: {
        success: jest.fn(),
        error: jest.fn(),
        info: jest.fn(),
    },
}));

import SigninPage from './page';
import { useQrLandingDraftStore } from '@/entities/qr-landing-draft';
import { CURRENT_TERMS_VERSION } from '@finly/types';

const VALID_DRAFT = {
    receiverName: 'Іваненко',
    iban: 'UA213223130000026007233566001',
    taxId: '1234567899',
    purpose: 'Поповнення рахунку',
};

const UUID = '11111111-2222-4333-8444-555555555555';

const seedClaimPending = (): void => {
    useQrLandingDraftStore.setState({
        formData: VALID_DRAFT,
        intent: 'claim-pending',
        claimIdempotencyKey: UUID,
        result: null,
    });
};

async function submitEmailWithTerms(email: string): Promise<void> {
    const termsCheckbox = screen.getByRole('checkbox');
    fireEvent.click(termsCheckbox);
    fireEvent.change(screen.getByPlaceholderText('your@email.com'), {
        target: { value: email },
    });
    fireEvent.click(screen.getByRole('button', { name: /Продовжити/ }));
    // Wait until form-handler resolves.
    await waitFor(() => {
        expect(mockCheckEmail).toHaveBeenCalled();
    });
}

describe('SigninPage — sendMagicLink call-sites (Sprint 10)', () => {
    beforeEach(() => {
        jest.useFakeTimers({ advanceTimers: true });
        jest.clearAllMocks();
        mockSearchParams = new URLSearchParams();
        useQrLandingDraftStore.setState({
            formData: {},
            intent: 'idle',
            claimIdempotencyKey: null,
            result: null,
        });
        mockCheckEmail.mockResolvedValue({
            hasPassword: false,
            isNewUser: true,
        });
        mockSendMagicLink.mockResolvedValue(undefined);
    });

    afterEach(() => {
        act(() => {
            jest.runOnlyPendingTimers();
        });
        jest.useRealTimers();
    });

    const advanceResendTimer = (): void => {
        act(() => {
            jest.advanceTimersByTime(60_000);
        });
    };

    it('onEmailSubmit (claim-pending intent) → прокидає landingDraft + claimIdempotencyKey + termsVersion', async () => {
        seedClaimPending();

        render(<SigninPage />);
        await submitEmailWithTerms('new@user.com');

        await waitFor(() => {
            expect(mockSendMagicLink).toHaveBeenCalledWith(
                'new@user.com',
                'register',
                undefined,
                expect.objectContaining({
                    landingDraft: VALID_DRAFT,
                    claimIdempotencyKey: UUID,
                    termsVersion: CURRENT_TERMS_VERSION,
                })
            );
        });
    });

    it('onEmailSubmit БЕЗ claim-pending intent → landingDraft+key undefined, лише termsVersion', async () => {
        // intent='idle' за дефолтом.
        render(<SigninPage />);
        await submitEmailWithTerms('new@user.com');

        await waitFor(() => {
            expect(mockSendMagicLink).toHaveBeenCalledWith(
                'new@user.com',
                'register',
                undefined,
                {
                    landingDraft: undefined,
                    claimIdempotencyKey: undefined,
                    termsVersion: CURRENT_TERMS_VERSION,
                }
            );
        });
    });

    it('handleForgotPassword (reset-password) → НЕ прокидає landingDraft+key навіть при claim-pending intent', async () => {
        seedClaimPending();
        mockCheckEmail.mockResolvedValue({
            hasPassword: true,
            isNewUser: false,
        });

        render(<SigninPage />);
        await submitEmailWithTerms('returning@user.com');

        // Тепер ми на password-step. Тиснемо "Забули пароль?".
        fireEvent.click(screen.getByRole('button', { name: /Забули пароль/ }));

        await waitFor(() => {
            expect(mockSendMagicLink).toHaveBeenCalledWith(
                'returning@user.com',
                'reset-password',
                undefined,
                {
                    termsVersion: CURRENT_TERMS_VERSION,
                }
            );
        });
    });

    it('handleResend після onEmailSubmit (login/register) → прокидає landingDraft+key+terms', async () => {
        seedClaimPending();

        render(<SigninPage />);
        await submitEmailWithTerms('new@user.com');

        // Чекаємо завершення resend countdown — 60s.
        advanceResendTimer();

        mockSendMagicLink.mockClear();
        fireEvent.click(
            screen.getByRole('button', { name: /Надіслати повторно/ })
        );

        await waitFor(() => {
            expect(mockSendMagicLink).toHaveBeenCalledWith(
                'new@user.com',
                'register',
                undefined,
                expect.objectContaining({
                    landingDraft: VALID_DRAFT,
                    claimIdempotencyKey: UUID,
                    termsVersion: CURRENT_TERMS_VERSION,
                })
            );
        });
    });

    it('handleResend після handleForgotPassword (regression на runtime-conditional guard) → НЕ прокидає landingDraft+key', async () => {
        seedClaimPending();
        mockCheckEmail.mockResolvedValue({
            hasPassword: true,
            isNewUser: false,
        });

        render(<SigninPage />);
        await submitEmailWithTerms('returning@user.com');

        // Натискаємо "Забули пароль?".
        fireEvent.click(screen.getByRole('button', { name: /Забули пароль/ }));

        await waitFor(() => {
            expect(mockSendMagicLink).toHaveBeenLastCalledWith(
                'returning@user.com',
                'reset-password',
                undefined,
                { termsVersion: CURRENT_TERMS_VERSION }
            );
        });

        // Чекаємо завершення resend countdown.
        advanceResendTimer();

        // "Надіслати повторно" — runtime purpose тепер 'reset-password',
        // тому landingDraft+key пропускаємо.
        mockSendMagicLink.mockClear();
        fireEvent.click(
            screen.getByRole('button', { name: /Надіслати повторно/ })
        );

        await waitFor(() => {
            expect(mockSendMagicLink).toHaveBeenCalledWith(
                'returning@user.com',
                'reset-password',
                undefined,
                { termsVersion: CURRENT_TERMS_VERSION }
            );
        });
    });

    it('handleSendMagicLinkFromPassword (login fallback) → прокидає landingDraft+key+terms', async () => {
        seedClaimPending();
        mockCheckEmail.mockResolvedValue({
            hasPassword: true,
            isNewUser: false,
        });
        // Real AxiosError instance — `instanceof AxiosError` у handler-і вимагає
        // прототипу від axios runtime-у, plain-object stub не narrow-ує.
        const axiosError = new AxiosError(
            'rate limited',
            'RATE_LIMIT_EXCEEDED'
        );
        axiosError.response = {
            data: { error: { code: 'RATE_LIMIT_EXCEEDED' } },
            status: 429,
            statusText: 'Too Many Requests',
            headers: { 'retry-after': '900' },
            config: {} as never,
        };
        mockLoginWithPassword.mockRejectedValue(axiosError);

        render(<SigninPage />);
        await submitEmailWithTerms('returning@user.com');

        // На password-step тиснемо submit з порожнім паролем.
        const passwordInput = screen.getByPlaceholderText('Введіть пароль');
        fireEvent.change(passwordInput, { target: { value: 'wrong' } });
        fireEvent.click(screen.getByRole('button', { name: /^Увійти$/ }));

        // Чекаємо коли з'явиться "Увійти через email-посилання".
        const magicFallback = await screen.findByRole('button', {
            name: /Увійти через email-посилання/,
        });

        mockSendMagicLink.mockClear();
        fireEvent.click(magicFallback);

        await waitFor(() => {
            expect(mockSendMagicLink).toHaveBeenCalledWith(
                'returning@user.com',
                'login',
                undefined,
                expect.objectContaining({
                    landingDraft: VALID_DRAFT,
                    claimIdempotencyKey: UUID,
                    termsVersion: CURRENT_TERMS_VERSION,
                })
            );
        });
    });
});
