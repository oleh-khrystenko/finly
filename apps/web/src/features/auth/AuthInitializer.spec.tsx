import React from 'react';
import { render } from '@testing-library/react';

const mockRefreshToken = jest.fn();
const mockGetMe = jest.fn();

jest.mock('@/shared/api', () => ({
    refreshToken: (...args: any[]) => mockRefreshToken(...args),
    getMe: (...args: any[]) => mockGetMe(...args),
}));

let mockPathname = '/profile';

jest.mock('next/navigation', () => ({
    usePathname: () => mockPathname,
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
});
