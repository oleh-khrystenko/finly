import React from 'react';
import { render } from '@testing-library/react';

const mockRefreshToken = jest.fn();
const mockGetMe = jest.fn();
const mockClearPendingPostLoginTarget = jest.fn();

jest.mock('@/shared/api', () => ({
    refreshToken: (...args: any[]) => mockRefreshToken(...args),
    getMe: (...args: any[]) => mockGetMe(...args),
    clearPendingPostLoginTarget: (...args: any[]) =>
        mockClearPendingPostLoginTarget(...args),
}));

let mockPathname = '/profile';
const mockRouterReplace = jest.fn();

jest.mock('next/navigation', () => ({
    usePathname: () => mockPathname,
    useRouter: () => ({ replace: mockRouterReplace }),
}));

const mockSetUser = jest.fn();
const mockClearUser = jest.fn();

jest.mock('@/entities/user', () => ({
    useAuthStore: (selector: (s: any) => any) => {
        const state = { setUser: mockSetUser, clearUser: mockClearUser };
        return selector(state);
    },
}));

const mockOpenTermsReacceptDialog = jest.fn();

jest.mock('./termsReacceptDialogStore', () => ({
    useTermsReacceptDialogStore: {
        getState: () => ({ open: mockOpenTermsReacceptDialog }),
    },
}));

import { CURRENT_TERMS_VERSION } from '@finly/types';
import AuthInitializer from './AuthInitializer';

describe('AuthInitializer', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockPathname = '/profile';
        mockClearPendingPostLoginTarget.mockResolvedValue(undefined);
    });

    it('calls refreshToken and getMe on normal path, then setUser', async () => {
        const user = { id: '1', email: 'test@example.com' };
        mockRefreshToken.mockResolvedValue('token');
        mockGetMe.mockResolvedValue(user);

        render(<AuthInitializer />);

        await new Promise((r) => setTimeout(r, 50));

        expect(mockRefreshToken).toHaveBeenCalled();
        expect(mockGetMe).toHaveBeenCalled();
        expect(mockSetUser).toHaveBeenCalledWith(user);
    });

    it('calls clearUser immediately on /auth/callback path without refresh', async () => {
        mockPathname = '/auth/callback';

        render(<AuthInitializer />);
        await new Promise((r) => setTimeout(r, 50));

        expect(mockRefreshToken).not.toHaveBeenCalled();
        expect(mockGetMe).not.toHaveBeenCalled();
        expect(mockClearUser).toHaveBeenCalled();
    });

    it('calls clearUser immediately on /auth/verify path without refresh', async () => {
        mockPathname = '/auth/verify';

        render(<AuthInitializer />);
        await new Promise((r) => setTimeout(r, 50));

        expect(mockRefreshToken).not.toHaveBeenCalled();
        expect(mockClearUser).toHaveBeenCalled();
    });

    it('calls clearUser on refresh error', async () => {
        mockRefreshToken.mockRejectedValue(new Error('Refresh failed'));

        render(<AuthInitializer />);
        await new Promise((r) => setTimeout(r, 50));

        expect(mockClearUser).toHaveBeenCalled();
        expect(mockSetUser).not.toHaveBeenCalled();
    });

    it('calls clearUser on getMe error', async () => {
        mockRefreshToken.mockResolvedValue('token');
        mockGetMe.mockRejectedValue(new Error('Failed'));

        render(<AuthInitializer />);
        await new Promise((r) => setTimeout(r, 50));

        expect(mockClearUser).toHaveBeenCalled();
    });

    it('renders null (no visible output)', () => {
        mockRefreshToken.mockResolvedValue('token');
        mockGetMe.mockResolvedValue({});

        const { container } = render(<AuthInitializer />);

        expect(container.innerHTML).toBe('');
    });

    it('opens TermsReacceptDialog when user.termsVersion is outdated', async () => {
        mockRefreshToken.mockResolvedValue('token');
        mockGetMe.mockResolvedValue({
            id: '1',
            email: 'user@finly.com.ua',
            termsVersion: '2020-01-01',
        });

        render(<AuthInitializer />);
        await new Promise((r) => setTimeout(r, 50));

        expect(mockOpenTermsReacceptDialog).toHaveBeenCalledTimes(1);
    });

    it('does NOT open TermsReacceptDialog when user.termsVersion matches current', async () => {
        mockRefreshToken.mockResolvedValue('token');
        mockGetMe.mockResolvedValue({
            id: '1',
            email: 'user@finly.com.ua',
            termsVersion: CURRENT_TERMS_VERSION,
        });

        render(<AuthInitializer />);
        await new Promise((r) => setTimeout(r, 50));

        expect(mockOpenTermsReacceptDialog).not.toHaveBeenCalled();
    });

    it('opens TermsReacceptDialog when user.termsVersion is null (never accepted)', async () => {
        mockRefreshToken.mockResolvedValue('token');
        mockGetMe.mockResolvedValue({
            id: '1',
            email: 'user@finly.com.ua',
            termsVersion: null,
        });

        render(<AuthInitializer />);
        await new Promise((r) => setTimeout(r, 50));

        expect(mockOpenTermsReacceptDialog).toHaveBeenCalledTimes(1);
    });

    describe('pendingPostLoginTarget (Sprint 11 cold-login resume)', () => {
        it('does not clear or redirect when pendingPostLoginTarget is absent', async () => {
            mockRefreshToken.mockResolvedValue('token');
            mockGetMe.mockResolvedValue({
                id: '1',
                email: 'user@finly.com.ua',
                termsVersion: CURRENT_TERMS_VERSION,
            });

            render(<AuthInitializer />);
            await new Promise((r) => setTimeout(r, 50));

            expect(mockClearPendingPostLoginTarget).not.toHaveBeenCalled();
            expect(mockRouterReplace).not.toHaveBeenCalled();
        });

        it('clears stamp THEN redirects on valid same-origin target', async () => {
            const callOrder: string[] = [];
            mockClearPendingPostLoginTarget.mockImplementation(async () => {
                callOrder.push('clear');
            });
            mockRouterReplace.mockImplementation(() => {
                callOrder.push('replace');
            });

            mockRefreshToken.mockResolvedValue('token');
            mockGetMe.mockResolvedValue({
                id: '1',
                email: 'user@finly.com.ua',
                termsVersion: CURRENT_TERMS_VERSION,
                pendingPostLoginTarget:
                    '/business/iva-X3kQ/account/acc-aB12cD34?completed-from=landing',
            });

            render(<AuthInitializer />);
            await new Promise((r) => setTimeout(r, 50));

            expect(mockClearPendingPostLoginTarget).toHaveBeenCalledTimes(1);
            expect(mockRouterReplace).toHaveBeenCalledWith(
                '/business/iva-X3kQ/account/acc-aB12cD34?completed-from=landing'
            );
            expect(callOrder).toEqual(['clear', 'replace']);
        });

        it('warns + clears + skips redirect on invalid (open-redirect) target', async () => {
            const warnSpy = jest
                .spyOn(console, 'warn')
                .mockImplementation(() => {});

            mockRefreshToken.mockResolvedValue('token');
            mockGetMe.mockResolvedValue({
                id: '1',
                email: 'user@finly.com.ua',
                termsVersion: CURRENT_TERMS_VERSION,
                pendingPostLoginTarget: '//attacker.com',
            });

            render(<AuthInitializer />);
            await new Promise((r) => setTimeout(r, 50));

            expect(warnSpy).toHaveBeenCalled();
            expect(mockClearPendingPostLoginTarget).toHaveBeenCalledTimes(1);
            expect(mockRouterReplace).not.toHaveBeenCalled();

            warnSpy.mockRestore();
        });

        it('still redirects on valid target even if clear-API fails', async () => {
            const warnSpy = jest
                .spyOn(console, 'warn')
                .mockImplementation(() => {});

            mockClearPendingPostLoginTarget.mockRejectedValue(
                new Error('network down')
            );

            mockRefreshToken.mockResolvedValue('token');
            mockGetMe.mockResolvedValue({
                id: '1',
                email: 'user@finly.com.ua',
                termsVersion: CURRENT_TERMS_VERSION,
                pendingPostLoginTarget: '/business/iva/account/acc',
            });

            render(<AuthInitializer />);
            await new Promise((r) => setTimeout(r, 50));

            expect(mockClearPendingPostLoginTarget).toHaveBeenCalledTimes(1);
            expect(warnSpy).toHaveBeenCalled();
            expect(mockRouterReplace).toHaveBeenCalledWith(
                '/business/iva/account/acc'
            );

            warnSpy.mockRestore();
        });
    });
});
