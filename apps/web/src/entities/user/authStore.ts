import { create } from 'zustand';
import type { UserProfile } from '@cyanship/types';

import { authEvents } from '@/shared/lib';

interface AuthState {
    user: UserProfile | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    setUser: (user: UserProfile) => void;
    clearUser: () => void;
    setLoading: (isLoading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    setUser: (user) => set({ user, isAuthenticated: true, isLoading: false }),
    clearUser: () =>
        set({ user: null, isAuthenticated: false, isLoading: false }),
    setLoading: (isLoading) => set({ isLoading }),
}));

// Wire HTTP layer → store. The auth event bus inverts the dependency
// so that `shared/api` does not need to know the store exists. The
// subscription is created at module init and lives for the entire
// process lifetime — the bus and store have identical lifetimes, so
// no teardown is required.
authEvents.on('session-lost', () => {
    useAuthStore.getState().clearUser();
});
