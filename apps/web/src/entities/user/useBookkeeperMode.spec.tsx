import { renderHook, act } from '@testing-library/react';

const mockUpdateProfile = jest.fn();
const mockSetUser = jest.fn();
const mockToastError = jest.fn();

jest.mock('@/shared/api', () => ({
    updateProfile: (...args: unknown[]) => mockUpdateProfile(...args),
    getApiMessage: () => 'Сталася помилка',
}));

jest.mock('sonner', () => ({
    toast: { error: (...args: unknown[]) => mockToastError(...args) },
}));

const userState: { user: typeof baseUser | null } = { user: null };
jest.mock('./authStore', () => ({
    useAuthStore: (
        selector: (s: {
            user: typeof baseUser | null;
            setUser: typeof mockSetUser;
        }) => unknown
    ) => selector({ user: userState.user, setUser: mockSetUser }),
}));

import { useBookkeeperMode } from './useBookkeeperMode';

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

describe('useBookkeeperMode', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        userState.user = { ...baseUser };
    });

    it('isBookkeeper віддзеркалює user.worksAsBookkeeper', () => {
        userState.user = { ...baseUser, worksAsBookkeeper: true };
        const { result } = renderHook(() => useBookkeeperMode());
        expect(result.current.isBookkeeper).toBe(true);
    });

    it('isBookkeeper=false коли user не залогінений', () => {
        userState.user = null;
        const { result } = renderHook(() => useBookkeeperMode());
        expect(result.current.isBookkeeper).toBe(false);
    });

    it('setBookkeeper: optimistic flip + PATCH, без rollback на success', async () => {
        mockUpdateProfile.mockResolvedValue({});
        userState.user = { ...baseUser, worksAsBookkeeper: false };
        const { result } = renderHook(() => useBookkeeperMode());

        await act(async () => {
            await result.current.setBookkeeper(true);
        });

        expect(mockSetUser).toHaveBeenNthCalledWith(1, {
            ...baseUser,
            worksAsBookkeeper: true,
        });
        expect(mockUpdateProfile).toHaveBeenCalledWith({
            worksAsBookkeeper: true,
        });
        expect(mockSetUser).toHaveBeenCalledTimes(1);
        expect(mockToastError).not.toHaveBeenCalled();
    });

    it('setBookkeeper: rollback + toast на error', async () => {
        mockUpdateProfile.mockRejectedValue({
            response: { data: { error: { code: 'INTERNAL_ERROR' } } },
        });
        userState.user = { ...baseUser, worksAsBookkeeper: false };
        const { result } = renderHook(() => useBookkeeperMode());

        await act(async () => {
            await result.current.setBookkeeper(true);
        });

        // 1) optimistic → true, 2) rollback → false
        expect(mockSetUser).toHaveBeenNthCalledWith(1, {
            ...baseUser,
            worksAsBookkeeper: true,
        });
        expect(mockSetUser).toHaveBeenNthCalledWith(2, {
            ...baseUser,
            worksAsBookkeeper: false,
        });
        expect(mockToastError).toHaveBeenCalled();
    });

    it('setBookkeeper: no-op коли значення вже активне', async () => {
        userState.user = { ...baseUser, worksAsBookkeeper: true };
        const { result } = renderHook(() => useBookkeeperMode());

        await act(async () => {
            await result.current.setBookkeeper(true);
        });

        expect(mockSetUser).not.toHaveBeenCalled();
        expect(mockUpdateProfile).not.toHaveBeenCalled();
    });
});
