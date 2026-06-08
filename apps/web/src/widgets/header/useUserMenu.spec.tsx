import React from 'react';
import { renderHook, act } from '@testing-library/react';

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

    describe('Sprint 3 §3.5 §E5 — bookkeeper toggle', () => {
        it('повертає bookkeeperToggle helper з checked=user.worksAsBookkeeper', () => {
            userState.user = { ...baseUser, worksAsBookkeeper: false };
            const { result } = renderHook(() => useUserMenu(icons));
            expect(result.current.bookkeeperToggle).not.toBeNull();
            expect(result.current.bookkeeperToggle?.checked).toBe(false);
        });

        it('повертає null коли user не залогінений', () => {
            userState.user = null;
            const { result } = renderHook(() => useUserMenu(icons));
            expect(result.current.bookkeeperToggle).toBeNull();
        });

        it('description без hover-tooltip — inline-текст (responsive.md §6)', () => {
            const { result } = renderHook(() => useUserMenu(icons));
            expect(result.current.bookkeeperToggle?.description).toBe(
                'вести отримувачів клієнтів, які ще не зареєстровані у Finly'
            );
        });

        it('onToggle: optimistic update setUser({...user, worksAsBookkeeper: !current})', async () => {
            mockUpdateProfile.mockResolvedValue({});
            userState.user = { ...baseUser, worksAsBookkeeper: false };
            const { result } = renderHook(() => useUserMenu(icons));

            await act(async () => {
                await result.current.bookkeeperToggle!.onToggle();
            });

            // Optimistic flip — миттєвий setUser перед PATCH
            expect(mockSetUser).toHaveBeenNthCalledWith(1, {
                ...baseUser,
                worksAsBookkeeper: true,
            });
            // PATCH з новим значенням
            expect(mockUpdateProfile).toHaveBeenCalledWith({
                worksAsBookkeeper: true,
            });
            // Жодного rollback при success
            expect(mockSetUser).toHaveBeenCalledTimes(1);
            expect(mockToastError).not.toHaveBeenCalled();
        });

        it('onToggle: rollback на error через toast (mapApiCode users)', async () => {
            const apiError = {
                response: {
                    data: { error: { code: 'INTERNAL_ERROR' } },
                },
            };
            mockUpdateProfile.mockRejectedValue(apiError);
            userState.user = { ...baseUser, worksAsBookkeeper: false };
            const { result } = renderHook(() => useUserMenu(icons));

            await act(async () => {
                await result.current.bookkeeperToggle!.onToggle();
            });

            // 1) Optimistic flip → true
            expect(mockSetUser).toHaveBeenNthCalledWith(1, {
                ...baseUser,
                worksAsBookkeeper: true,
            });
            // 2) Rollback → false
            expect(mockSetUser).toHaveBeenNthCalledWith(2, {
                ...baseUser,
                worksAsBookkeeper: false,
            });
            // Toast з UA-message
            expect(mockToastError).toHaveBeenCalled();
        });

        it('onToggle працює і на ON→OFF (вимкнення режиму)', async () => {
            mockUpdateProfile.mockResolvedValue({});
            userState.user = { ...baseUser, worksAsBookkeeper: true };
            const { result } = renderHook(() => useUserMenu(icons));

            await act(async () => {
                await result.current.bookkeeperToggle!.onToggle();
            });

            expect(mockUpdateProfile).toHaveBeenCalledWith({
                worksAsBookkeeper: false,
            });
        });
    });
});
