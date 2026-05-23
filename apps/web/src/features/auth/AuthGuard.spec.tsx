import React from 'react';
import { render, screen } from '@testing-library/react';

const mockReplace = jest.fn();
let mockPathname = '/business';
let mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace: mockReplace }),
    usePathname: () => mockPathname,
    useSearchParams: () => mockSearchParams,
}));

jest.mock('sonner', () => ({
    toast: { info: jest.fn(), error: jest.fn(), success: jest.fn() },
}));

jest.mock('@finly/types', () => ({
    isOnboardingComplete: (profile: { firstName?: string; lastName?: string }) =>
        Boolean(profile?.firstName && profile?.lastName),
}));

jest.mock('@/shared/ui/UiFullPageLoader', () => {
    return function MockFullPageLoader() {
        return <div data-testid="spinner">Loading...</div>;
    };
});

const mockUseAuthStore = jest.fn();

jest.mock('@/entities/user', () => ({
    useAuthStore: (selector: (s: unknown) => unknown) =>
        mockUseAuthStore(selector),
}));

import AuthGuard from './AuthGuard';

const COMPLETE_USER = {
    profile: { firstName: 'Іван', lastName: 'Іваненко' },
};
const INCOMPLETE_USER = {
    profile: { firstName: '', lastName: '' },
};

interface AuthSnapshot {
    isAuthenticated: boolean;
    isLoading: boolean;
    user: unknown;
}

const mockAuthState = (snapshot: AuthSnapshot): void => {
    mockUseAuthStore.mockImplementation(
        (selector: (state: AuthSnapshot) => unknown) => selector(snapshot)
    );
};

describe('AuthGuard — baseline', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockPathname = '/business';
        mockSearchParams = new URLSearchParams();
    });

    it('renders spinner when isLoading is true', () => {
        mockAuthState({
            isAuthenticated: false,
            isLoading: true,
            user: null,
        });

        render(
            <AuthGuard>
                <div>Protected content</div>
            </AuthGuard>
        );

        expect(screen.getByTestId('spinner')).toBeInTheDocument();
    });

    it('renders null and redirects to /auth/signin коли не auth', () => {
        mockAuthState({
            isAuthenticated: false,
            isLoading: false,
            user: null,
        });

        render(
            <AuthGuard>
                <div>Protected content</div>
            </AuthGuard>
        );

        expect(mockReplace).toHaveBeenCalledWith('/auth/signin');
    });

    it('renders children коли auth + complete profile', () => {
        mockAuthState({
            isAuthenticated: true,
            isLoading: false,
            user: COMPLETE_USER,
        });

        render(
            <AuthGuard>
                <div>Protected content</div>
            </AuthGuard>
        );

        expect(screen.getByText('Protected content')).toBeInTheDocument();
        expect(mockReplace).not.toHaveBeenCalled();
    });
});

describe('AuthGuard — Sprint 10 next-builder', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('auth + incomplete + deep-link з query → /profile?mode=new&next=<encoded path+query>', () => {
        mockPathname = '/business/iva-X3kQ/account/acc-aB12cD34';
        mockSearchParams = new URLSearchParams('ref=invite');
        mockAuthState({
            isAuthenticated: true,
            isLoading: false,
            user: INCOMPLETE_USER,
        });

        render(
            <AuthGuard>
                <div>Protected content</div>
            </AuthGuard>
        );

        const expected =
            '/profile?mode=new&next=' +
            encodeURIComponent(
                '/business/iva-X3kQ/account/acc-aB12cD34?ref=invite'
            );
        expect(mockReplace).toHaveBeenCalledWith(expected);
    });

    it('auth + incomplete + direct deep-link без query → next містить лише pathname', () => {
        mockPathname = '/business/foo';
        mockSearchParams = new URLSearchParams();
        mockAuthState({
            isAuthenticated: true,
            isLoading: false,
            user: INCOMPLETE_USER,
        });

        render(
            <AuthGuard>
                <div>Protected content</div>
            </AuthGuard>
        );

        expect(mockReplace).toHaveBeenCalledWith(
            '/profile?mode=new&next=' + encodeURIComponent('/business/foo')
        );
    });

    it('auth + incomplete + pathname вже починається з /profile → no redirect (профіль сам по собі target)', () => {
        mockPathname = '/profile';
        mockSearchParams = new URLSearchParams('mode=new');
        mockAuthState({
            isAuthenticated: true,
            isLoading: false,
            user: INCOMPLETE_USER,
        });

        render(
            <AuthGuard>
                <div>Profile content</div>
            </AuthGuard>
        );

        expect(mockReplace).not.toHaveBeenCalled();
    });
});
