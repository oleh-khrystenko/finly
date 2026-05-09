import React from 'react';
import { render, screen } from '@testing-library/react';

const mockReplace = jest.fn();

jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace: mockReplace }),
    usePathname: () => '/business',
}));

jest.mock('sonner', () => ({
    toast: { info: jest.fn(), error: jest.fn(), success: jest.fn() },
}));

jest.mock('@finly/types', () => ({
    isOnboardingComplete: () => true,
}));

jest.mock('@/shared/ui/UiFullPageLoader', () => {
    return function MockFullPageLoader() {
        return <div data-testid="spinner">Loading...</div>;
    };
});

const mockUseAuthStore = jest.fn();

jest.mock('@/entities/user', () => ({
    useAuthStore: (selector: (s: any) => any) => mockUseAuthStore(selector),
}));

import AuthGuard from './AuthGuard';

describe('AuthGuard', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('renders spinner when isLoading is true', () => {
        mockUseAuthStore.mockImplementation((selector: any) => {
            const state = { isAuthenticated: false, isLoading: true };
            return selector(state);
        });

        render(
            <AuthGuard>
                <div>Protected content</div>
            </AuthGuard>
        );

        expect(screen.getByTestId('spinner')).toBeInTheDocument();
        expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
    });

    it('renders null and redirects when not authenticated and not loading', () => {
        mockUseAuthStore.mockImplementation((selector: any) => {
            const state = { isAuthenticated: false, isLoading: false };
            return selector(state);
        });

        render(
            <AuthGuard>
                <div>Protected content</div>
            </AuthGuard>
        );

        expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
        expect(mockReplace).toHaveBeenCalledWith('/auth/signin');
    });

    it('renders children when authenticated and not loading', () => {
        mockUseAuthStore.mockImplementation((selector: any) => {
            const state = { isAuthenticated: true, isLoading: false };
            return selector(state);
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
