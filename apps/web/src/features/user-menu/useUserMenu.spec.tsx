import React from 'react';
import { renderHook } from '@testing-library/react';

const mockUpdateProfile = jest.fn();
const mockLogout = jest.fn();
const mockSetUser = jest.fn();
const mockClearUser = jest.fn();
const mockToastError = jest.fn();
const mockPush = jest.fn();

jest.mock('@/shared/api', () => ({
    updateProfile: (...args: unknown[]) => mockUpdateProfile(...args),
    logout: (...args: unknown[]) => mockLogout(...args),
}));

jest.mock('sonner', () => ({
    toast: { error: (...args: unknown[]) => mockToastError(...args) },
}));

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: mockPush }),
    usePathname: () => '/profile',
}));

const userState: { user: typeof baseUser | null } = { user: null };
jest.mock('@/entities/user', () => ({
    useAuthStore: (
        selector: (s: {
            user: typeof baseUser | null;
            setUser: typeof mockSetUser;
            clearUser: typeof mockClearUser;
        }) => unknown
    ) =>
        selector({
            user: userState.user,
            setUser: mockSetUser,
            clearUser: mockClearUser,
        }),
}));

import { useUserMenu } from './useUserMenu';

const baseUser = {
    id: '507f1f77bcf86cd799439011',
    email: 'user@finly.com.ua',
    role: 'user' as const,
    worksAsBookkeeper: false,
    profile: { firstName: 'Іван', lastName: 'Іваненко' },
    executions: { balance: 0, freeReportUsed: false },
    hasPassword: false,
    deletedAt: null,
    accountDeletionRequestedAt: null,
    termsVersion: null,
    billing: null,
};

const icons = {
    businesses: <span data-testid="ic-businesses" />,
    profile: <span data-testid="ic-profile" />,
    billing: <span data-testid="ic-billing" />,
    logout: <span data-testid="ic-logout" />,
};

describe('useUserMenu', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        userState.user = { ...baseUser };
    });

    describe('Sprint 3 §3.5 — businesses replaces dashboard', () => {
        it('повертає item з value="businesses" і route="/business"', () => {
            const { result } = renderHook(() => useUserMenu(icons));
            const businesses = result.current.allItems.find(
                (i) => i.value === 'businesses'
            );
            expect(businesses).toBeDefined();
            expect(businesses?.route).toBe('/business');
            expect(businesses?.label).toBe('Отримувачі');
        });

        it('НЕ містить item з value="dashboard" (видалено E2)', () => {
            const { result } = renderHook(() => useUserMenu(icons));
            expect(
                result.current.allItems.find((i) => i.value === 'dashboard')
            ).toBeUndefined();
        });
    });
});
