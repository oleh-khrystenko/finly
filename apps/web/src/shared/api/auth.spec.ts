const mockPost = jest.fn();
const mockGet = jest.fn();
const mockPatch = jest.fn();
const mockSetAccessToken = jest.fn();

jest.mock('./client', () => ({
    apiClient: {
        post: mockPost,
        get: mockGet,
        patch: mockPatch,
    },
    setAccessToken: mockSetAccessToken,
}));

import {
    checkEmail,
    loginWithPassword,
    sendMagicLink,
    verifyMagicLink,
    setPassword,
    changePassword,
    verifyPassword,
    updateProfile,
    deleteUserAccount,
    confirmDeleteAccount,
    restoreAccount,
    refreshToken,
    logout,
    getMe,
} from './auth';

describe('auth API functions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('checkEmail', () => {
        it('sends POST to /auth/check-email and returns data.data', async () => {
            const response = { hasPassword: true, isNewUser: false };
            mockPost.mockResolvedValue({ data: { data: response } });

            const result = await checkEmail('test@example.com');

            expect(mockPost).toHaveBeenCalledWith('/auth/check-email', {
                email: 'test@example.com',
            });
            expect(result).toEqual(response);
        });
    });

    describe('loginWithPassword', () => {
        it('sends POST to /auth/login/password and calls setAccessToken', async () => {
            const response = {
                user: { id: '1', email: 'test@example.com' },
                accessToken: 'token-abc',
            };
            mockPost.mockResolvedValue({ data: { data: response } });

            const result = await loginWithPassword(
                'test@example.com',
                'password123'
            );

            expect(mockPost).toHaveBeenCalledWith('/auth/login/password', {
                email: 'test@example.com',
                password: 'password123',
                termsVersion: expect.any(String),
            });
            expect(mockSetAccessToken).toHaveBeenCalledWith('token-abc');
            expect(result).toEqual(response);
        });
    });

    describe('sendMagicLink', () => {
        it('sends POST to /auth/magic-link/send with purpose and redirect', async () => {
            mockPost.mockResolvedValue({});

            await sendMagicLink('test@example.com', 'login', '/dashboard');

            expect(mockPost).toHaveBeenCalledWith('/auth/magic-link/send', {
                email: 'test@example.com',
                purpose: 'login',
                redirectTo: '/dashboard',
            });
        });

        it('sends without optional params', async () => {
            mockPost.mockResolvedValue({});

            await sendMagicLink('test@example.com');

            expect(mockPost).toHaveBeenCalledWith('/auth/magic-link/send', {
                email: 'test@example.com',
                purpose: undefined,
                redirectTo: undefined,
            });
        });
    });

    describe('verifyMagicLink', () => {
        it('sends POST to /auth/magic-link/verify and calls setAccessToken', async () => {
            const response = {
                user: { id: '1' },
                accessToken: 'ml-token',
                purpose: 'LOGIN',
            };
            mockPost.mockResolvedValue({ data: { data: response } });

            const result = await verifyMagicLink('some-token');

            expect(mockPost).toHaveBeenCalledWith('/auth/magic-link/verify', {
                token: 'some-token',
            });
            expect(mockSetAccessToken).toHaveBeenCalledWith('ml-token');
            expect(result).toEqual(response);
        });
    });

    describe('setPassword', () => {
        it('sends POST to /auth/password/set', async () => {
            mockPost.mockResolvedValue({});

            await setPassword('newpass123');

            expect(mockPost).toHaveBeenCalledWith('/auth/password/set', {
                password: 'newpass123',
            });
        });
    });

    describe('changePassword', () => {
        it('sends POST to /auth/password/change and calls setAccessToken', async () => {
            const response = { accessToken: 'changed-token' };
            mockPost.mockResolvedValue({ data: { data: response } });

            const result = await changePassword('old', 'new');

            expect(mockPost).toHaveBeenCalledWith('/auth/password/change', {
                currentPassword: 'old',
                newPassword: 'new',
            });
            expect(mockSetAccessToken).toHaveBeenCalledWith('changed-token');
            expect(result).toEqual(response);
        });
    });

    describe('verifyPassword', () => {
        it('sends POST to /auth/password/verify and returns { isValid }', async () => {
            mockPost.mockResolvedValue({
                data: { data: { isValid: true } },
            });

            const result = await verifyPassword('mypass');

            expect(mockPost).toHaveBeenCalledWith('/auth/password/verify', {
                password: 'mypass',
            });
            expect(result).toEqual({ isValid: true });
        });
    });

    describe('updateProfile', () => {
        it('sends PATCH to /users/me and returns data.data', async () => {
            const profile = { firstName: 'John' };
            mockPatch.mockResolvedValue({ data: { data: profile } });

            const result = await updateProfile({ firstName: 'John' });

            expect(mockPatch).toHaveBeenCalledWith('/users/me', {
                firstName: 'John',
            });
            expect(result).toEqual(profile);
        });
    });

    describe('deleteUserAccount', () => {
        it('sends POST to /users/account/delete and returns flags', async () => {
            const response = { requiresPassword: true };
            mockPost.mockResolvedValue({ data: { data: response } });

            const result = await deleteUserAccount();

            expect(mockPost).toHaveBeenCalledWith('/users/account/delete');
            expect(result).toEqual(response);
        });
    });

    describe('confirmDeleteAccount', () => {
        it('sends POST to /users/account/delete/confirm', async () => {
            mockPost.mockResolvedValue({});

            await confirmDeleteAccount('mypassword');

            expect(mockPost).toHaveBeenCalledWith(
                '/users/account/delete/confirm',
                { password: 'mypassword' }
            );
        });
    });

    describe('restoreAccount', () => {
        it('sends POST to /users/account/restore', async () => {
            mockPost.mockResolvedValue({});

            await restoreAccount();

            expect(mockPost).toHaveBeenCalledWith('/users/account/restore');
        });
    });

    describe('refreshToken', () => {
        it('sends POST to /auth/refresh and calls setAccessToken', async () => {
            mockPost.mockResolvedValue({
                data: { data: { accessToken: 'refreshed-token' } },
            });

            const result = await refreshToken();

            expect(mockPost).toHaveBeenCalledWith('/auth/refresh', {
                timezone: expect.any(String),
            });
            expect(mockSetAccessToken).toHaveBeenCalledWith('refreshed-token');
            expect(result).toBe('refreshed-token');
        });
    });

    describe('logout', () => {
        it('sends POST to /auth/logout and clears token', async () => {
            mockPost.mockResolvedValue({});

            await logout();

            expect(mockPost).toHaveBeenCalledWith('/auth/logout');
            expect(mockSetAccessToken).toHaveBeenCalledWith(null);
        });
    });

    describe('getMe', () => {
        it('sends GET to /users/me and returns data.data', async () => {
            const user = { id: '1', email: 'test@example.com' };
            mockGet.mockResolvedValue({ data: { data: user } });

            const result = await getMe();

            expect(mockGet).toHaveBeenCalledWith('/users/me');
            expect(result).toEqual(user);
        });
    });
});
