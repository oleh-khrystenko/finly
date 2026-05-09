import React from 'react';
import { render, waitFor, act } from '@testing-library/react';

jest.mock('@/shared/config', () => ({
    ENV: {
        NEXT_PUBLIC_API_URL: 'http://localhost:4000/api',
        NEXT_PUBLIC_BASE_URL: 'http://localhost:3000',
        NEXT_PUBLIC_PAY_PUBLIC_URL: 'http://localhost:3001',
    },
}));

const mockClaim = jest.fn();
const mockRouterReplace = jest.fn();
const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();

jest.mock('../api', () => ({
    claimLandingDraftAsBusiness: (...args: unknown[]) => mockClaim(...args),
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace: mockRouterReplace, push: jest.fn() }),
}));

jest.mock('sonner', () => ({
    toast: {
        success: (...args: unknown[]) => mockToastSuccess(...args),
        error: (...args: unknown[]) => mockToastError(...args),
    },
}));

import { useClaimLandingDraft } from '../useClaimLandingDraft';
import { useQrLandingDraftStore } from '@/entities/qr-landing-draft';
import { useAuthStore } from '@/entities/user';

function HookHarness() {
    useClaimLandingDraft();
    return null;
}

const VALID_FORM = {
    receiverName: 'Іваненко',
    iban: 'UA213223130000026007233566001',
    taxId: '1234567899',
    purpose: 'Поповнення рахунку',
};

const setAnon = (): void => {
    useAuthStore.getState().clearUser();
};

const setAuthedComplete = (): void => {
    useAuthStore.getState().setUser({
        id: 'u1',
        email: 'user@test.com',
        profile: {
            firstName: 'Іван',
            lastName: 'Іваненко',
            acceptedTermsVersion: 1,
        },
    } as never);
};

const setAuthedIncomplete = (): void => {
    useAuthStore.getState().setUser({
        id: 'u1',
        email: 'user@test.com',
        profile: {
            firstName: '',
            lastName: '',
            acceptedTermsVersion: 1,
        },
    } as never);
};

describe('useClaimLandingDraft — pre-conditions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        useQrLandingDraftStore.getState().clearAll();
        useAuthStore.getState().clearUser();
        localStorage.clear();
    });

    it('anon (isAuthenticated=false) → noop незалежно від intent', () => {
        setAnon();
        useQrLandingDraftStore.getState().setFormData(VALID_FORM);
        useQrLandingDraftStore.getState().setIntent('claim-pending');

        render(<HookHarness />);

        expect(mockClaim).not.toHaveBeenCalled();
    });

    it('authed + onboarding incomplete + claim-pending → noop (чекає на profile)', () => {
        setAuthedIncomplete();
        useQrLandingDraftStore.getState().setFormData(VALID_FORM);
        useQrLandingDraftStore.getState().setIntent('claim-pending');

        render(<HookHarness />);

        expect(mockClaim).not.toHaveBeenCalled();
    });

    it('authed + complete + intent=idle → noop (нема explicit запиту)', () => {
        setAuthedComplete();
        useQrLandingDraftStore.getState().setFormData(VALID_FORM);
        // intent default 'idle'

        render(<HookHarness />);

        expect(mockClaim).not.toHaveBeenCalled();
    });

    it('authed + complete + intent=claim-pending → API виклик з parsed formData', async () => {
        mockClaim.mockResolvedValue({ slug: 'iva-X3kQ' });
        setAuthedComplete();
        useQrLandingDraftStore.getState().setFormData(VALID_FORM);
        useQrLandingDraftStore.getState().setIntent('claim-pending');

        render(<HookHarness />);

        await waitFor(() => {
            expect(mockClaim).toHaveBeenCalledWith(VALID_FORM);
        });
    });
});

describe('useClaimLandingDraft — success path', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        useQrLandingDraftStore.getState().clearAll();
        useAuthStore.getState().clearUser();
        localStorage.clear();
    });

    it('success: clearAll + toast + router.replace на /business/{slug}?completed-from=landing', async () => {
        mockClaim.mockResolvedValue({ slug: 'iva-X3kQ' });
        setAuthedComplete();
        useQrLandingDraftStore.getState().setFormData(VALID_FORM);
        useQrLandingDraftStore.getState().setIntent('claim-pending');

        render(<HookHarness />);

        await waitFor(() => {
            expect(mockToastSuccess).toHaveBeenCalledWith('Бізнес створено');
            expect(mockRouterReplace).toHaveBeenCalledWith(
                '/business/iva-X3kQ?completed-from=landing'
            );
            // clearAll спрацював.
            const s = useQrLandingDraftStore.getState();
            expect(s.formData).toEqual({});
            expect(s.intent).toBe('idle');
        });
    });
});

describe('useClaimLandingDraft — failure paths', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        useQrLandingDraftStore.getState().clearAll();
        useAuthStore.getState().clearUser();
        localStorage.clear();
    });

    it('API failure → intent=claim-failed, formData збережено, toast.error', async () => {
        mockClaim.mockRejectedValue(new Error('500 Internal'));
        setAuthedComplete();
        useQrLandingDraftStore.getState().setFormData(VALID_FORM);
        useQrLandingDraftStore.getState().setIntent('claim-pending');

        render(<HookHarness />);

        await waitFor(() => {
            expect(mockToastError).toHaveBeenCalled();
            const s = useQrLandingDraftStore.getState();
            expect(s.intent).toBe('claim-failed');
            // formData збережена — користувач не втрачає введене.
            expect(s.formData).toEqual(VALID_FORM);
        });
    });

    it('schema-drift у localStorage: невалідний formData → claim-failed без API', () => {
        setAuthedComplete();
        useQrLandingDraftStore.getState().setFormData({
            receiverName: '',
            iban: 'invalid',
            taxId: '123',
            purpose: 'x',
        });
        useQrLandingDraftStore.getState().setIntent('claim-pending');

        render(<HookHarness />);

        expect(mockClaim).not.toHaveBeenCalled();
        expect(mockToastError).toHaveBeenCalled();
        expect(useQrLandingDraftStore.getState().intent).toBe('claim-failed');
    });
});

describe('useClaimLandingDraft — onboarding-completion-trigger (гілка B)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        useQrLandingDraftStore.getState().clearAll();
        useAuthStore.getState().clearUser();
        localStorage.clear();
    });

    it('перехід incomplete→complete (PATCH /users/me success) тригерить hook автоматично', async () => {
        mockClaim.mockResolvedValue({ slug: 'iva-X3kQ' });
        setAuthedIncomplete();
        useQrLandingDraftStore.getState().setFormData(VALID_FORM);
        useQrLandingDraftStore.getState().setIntent('claim-pending');

        render(<HookHarness />);

        // Початково — claim не fires (incomplete profile).
        expect(mockClaim).not.toHaveBeenCalled();

        // Симулюємо завершення PATCH /users/me — auth-store оновлюється.
        act(() => {
            setAuthedComplete();
        });

        // useEffect re-fires автоматично, claim викликається.
        await waitFor(() => {
            expect(mockClaim).toHaveBeenCalledWith(VALID_FORM);
        });
    });
});

describe('useClaimLandingDraft — race-protection', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        useQrLandingDraftStore.getState().clearAll();
        useAuthStore.getState().clearUser();
        localStorage.clear();
    });

    it('два паралельні store-update тригери → API викликається один раз', async () => {
        // Затримуємо resolve, щоб emulate-нути concurrent re-renders.
        let resolvePromise: (value: { slug: string }) => void = () => {};
        mockClaim.mockReturnValue(
            new Promise((resolve) => {
                resolvePromise = resolve;
            })
        );

        setAuthedComplete();
        useQrLandingDraftStore.getState().setFormData(VALID_FORM);
        useQrLandingDraftStore.getState().setIntent('claim-pending');

        render(<HookHarness />);

        // Зачекаємо першого fires.
        await waitFor(() => expect(mockClaim).toHaveBeenCalledTimes(1));

        // Тригеруємо store update (як ніби сам hook чи інший компонент
        // переписав formData), що інакше re-fired би effect через
        // formData у deps.
        act(() => {
            useQrLandingDraftStore
                .getState()
                .setFormData({ ...VALID_FORM });
        });

        // inProgressRef блокує другий API виклик.
        expect(mockClaim).toHaveBeenCalledTimes(1);

        // Завершуємо для cleanup.
        act(() => {
            resolvePromise({ slug: 'iva-X3kQ' });
        });
    });
});
