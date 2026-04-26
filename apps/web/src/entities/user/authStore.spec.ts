import { authEvents } from '@/shared/lib';

import { useAuthStore } from './authStore';

const mockUser = {
    id: '507f1f77bcf86cd799439011',
    email: 'test@gmail.com',
    profile: { firstName: 'John', lastName: 'Doe' },
    executions: { balance: 0, freeReportUsed: false },
    hasPassword: true,
    deletedAt: null,
    preferredLang: 'uk' as const,
};

describe('authStore', () => {
    beforeEach(() => {
        // Reset store to initial state
        useAuthStore.setState({
            user: null,
            isAuthenticated: false,
            isLoading: true,
        });
    });

    it('should have correct initial state', () => {
        const state = useAuthStore.getState();
        expect(state.user).toBeNull();
        expect(state.isAuthenticated).toBe(false);
        expect(state.isLoading).toBe(true);
    });

    it('setUser should set user, isAuthenticated, and isLoading', () => {
        useAuthStore.getState().setUser(mockUser);

        const state = useAuthStore.getState();
        expect(state.user).toBe(mockUser);
        expect(state.isAuthenticated).toBe(true);
        expect(state.isLoading).toBe(false);
    });

    it('clearUser should clear user, set isAuthenticated false, isLoading false', () => {
        useAuthStore.getState().setUser(mockUser);
        useAuthStore.getState().clearUser();

        const state = useAuthStore.getState();
        expect(state.user).toBeNull();
        expect(state.isAuthenticated).toBe(false);
        expect(state.isLoading).toBe(false);
    });

    it('setLoading(false) should set isLoading to false', () => {
        useAuthStore.getState().setLoading(false);
        expect(useAuthStore.getState().isLoading).toBe(false);
    });

    it('setLoading(true) should set isLoading to true', () => {
        useAuthStore.getState().setLoading(false);
        useAuthStore.getState().setLoading(true);
        expect(useAuthStore.getState().isLoading).toBe(true);
    });

    describe('authEvents integration', () => {
        it('clears the user when authEvents emits "session-lost"', () => {
            useAuthStore.getState().setUser(mockUser);
            expect(useAuthStore.getState().isAuthenticated).toBe(true);

            authEvents.emit('session-lost');

            const state = useAuthStore.getState();
            expect(state.user).toBeNull();
            expect(state.isAuthenticated).toBe(false);
            expect(state.isLoading).toBe(false);
        });
    });
});
