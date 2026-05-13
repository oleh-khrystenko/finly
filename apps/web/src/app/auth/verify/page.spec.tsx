import React from 'react';
import { render, waitFor } from '@testing-library/react';

jest.mock('@/shared/config', () => ({
    ENV: {
        NEXT_PUBLIC_API_URL: 'http://localhost:4000/api',
        NEXT_PUBLIC_BASE_URL: 'http://localhost:3000',
        NEXT_PUBLIC_PAY_PUBLIC_URL: 'http://localhost:3001',
    },
}));

const mockVerifyMagicLink = jest.fn();
const mockAcceptTerms = jest.fn();
const mockGetMe = jest.fn();
const mockRouterReplace = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock('@/shared/api', () => {
    const actual = jest.requireActual('@/shared/api');
    return {
        ...actual,
        verifyMagicLink: (...args: unknown[]) => mockVerifyMagicLink(...args),
        acceptTerms: () => mockAcceptTerms(),
        getMe: () => mockGetMe(),
    };
});

jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace: mockRouterReplace }),
    useSearchParams: () => mockSearchParams,
}));

import VerifyPage from './page';
import { useQrLandingDraftStore } from '@/entities/qr-landing-draft';

const USER = {
    id: 'u1',
    email: 'user@test.com',
    profile: {
        firstName: 'Іван',
        lastName: 'Іваненко',
        acceptedTermsVersion: '2026-05-01',
    },
};

const VALID_DRAFT = {
    receiverName: 'Іваненко',
    iban: 'UA213223130000026007233566001',
    taxId: '1234567899',
    purpose: 'Поповнення рахунку',
};

describe('VerifyPage — claimState branching (Sprint 10)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSearchParams = new URLSearchParams({ token: 't0k3n' });
        useQrLandingDraftStore.setState({
            formData: {},
            intent: 'idle',
            claimIdempotencyKey: null,
            result: null,
        });
        mockAcceptTerms.mockResolvedValue(undefined);
        mockGetMe.mockResolvedValue(USER);
    });

    it('purpose=register без claimState → fall-through на /profile (дефолтний redirectTarget)', async () => {
        mockVerifyMagicLink.mockResolvedValue({
            user: USER,
            accessToken: 'a',
            purpose: 'register',
        });

        render(<VerifyPage />);

        await waitFor(() => {
            expect(mockRouterReplace).toHaveBeenCalledWith('/profile');
        });
    });

    it('purpose=login без claimState + ?redirect=/business → fall-through на /business', async () => {
        mockSearchParams = new URLSearchParams({
            token: 't0k3n',
            redirect: '/business',
        });
        mockVerifyMagicLink.mockResolvedValue({
            user: USER,
            accessToken: 'a',
            purpose: 'login',
        });

        render(<VerifyPage />);

        await waitFor(() => {
            expect(mockRouterReplace).toHaveBeenCalledWith('/business');
        });
    });

    it('claimState=success → clearAll + redirect на per-account з ?completed-from=landing', async () => {
        useQrLandingDraftStore.setState({
            formData: VALID_DRAFT,
            intent: 'claim-pending',
            claimIdempotencyKey: 'k',
            result: null,
        });
        mockVerifyMagicLink.mockResolvedValue({
            user: USER,
            accessToken: 'a',
            purpose: 'register',
            claimState: 'success',
            claimedBusinessSlug: 'iva-X3kQ',
            claimedAccountSlug: 'acc-aB12cD34',
        });

        render(<VerifyPage />);

        await waitFor(() => {
            expect(mockRouterReplace).toHaveBeenCalledWith(
                '/business/iva-X3kQ/account/acc-aB12cD34?completed-from=landing'
            );
            const s = useQrLandingDraftStore.getState();
            expect(s.formData).toEqual({});
            expect(s.intent).toBe('idle');
            expect(s.claimIdempotencyKey).toBeNull();
        });
    });

    it('claimState=business-failed → setFormData + setIntent + /business/new?from=landing', async () => {
        mockVerifyMagicLink.mockResolvedValue({
            user: USER,
            accessToken: 'a',
            purpose: 'register',
            claimState: 'business-failed',
            failedClaimDraft: VALID_DRAFT,
        });

        render(<VerifyPage />);

        await waitFor(() => {
            expect(mockRouterReplace).toHaveBeenCalledWith(
                '/business/new?from=landing'
            );
            const s = useQrLandingDraftStore.getState();
            expect(s.formData).toEqual(VALID_DRAFT);
            expect(s.intent).toBe('claim-failed-business');
        });
    });

    it('claimState=account-failed → setFormData + setIntent + /business/{partial}/account/new?from=landing', async () => {
        mockVerifyMagicLink.mockResolvedValue({
            user: USER,
            accessToken: 'a',
            purpose: 'login',
            claimState: 'account-failed',
            partialBusinessSlug: 'iva-X3kQ',
            failedClaimDraft: VALID_DRAFT,
        });

        render(<VerifyPage />);

        await waitFor(() => {
            expect(mockRouterReplace).toHaveBeenCalledWith(
                '/business/iva-X3kQ/account/new?from=landing'
            );
            const s = useQrLandingDraftStore.getState();
            expect(s.formData).toEqual(VALID_DRAFT);
            expect(s.intent).toBe('claim-failed-account');
        });
    });

    it('purpose=delete-account → terminal "deleted", claim-state не обробляється', async () => {
        mockVerifyMagicLink.mockResolvedValue({
            deleted: true,
            purpose: 'delete-account',
            message: 'Account scheduled for deletion',
        });

        render(<VerifyPage />);

        // delete-flow не викликає acceptTerms/getMe/router.replace.
        await waitFor(() => {
            expect(mockVerifyMagicLink).toHaveBeenCalled();
        });
        expect(mockAcceptTerms).not.toHaveBeenCalled();
        expect(mockGetMe).not.toHaveBeenCalled();
        expect(mockRouterReplace).not.toHaveBeenCalled();
    });
});
