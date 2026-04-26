import axios, { AxiosHeaders } from 'axios';

jest.mock('@/shared/config', () => ({
    ENV: {
        NEXT_PUBLIC_API_URL: 'http://localhost:4000/api',
        NEXT_PUBLIC_BASE_URL: 'http://localhost:3000',
    },
}));

import { authEvents } from '@/shared/lib';

import { apiClient, getAccessToken, setAccessToken } from './client';

/**
 * Helper: install a one-shot mock adapter that captures the outgoing request
 * config and resolves with a 200. Returns the captured config after the
 * request completes.
 */
const captureNextRequest = async (
    url = '/test'
): Promise<Record<string, any>> => {
    let captured: Record<string, any> = {};
    const original = apiClient.defaults.adapter;

    apiClient.defaults.adapter = (config) => {
        captured = config;
        return Promise.resolve({
            data: {},
            status: 200,
            statusText: 'OK',
            headers: {},
            config,
        });
    };

    await apiClient.get(url);
    apiClient.defaults.adapter = original;
    return captured;
};

/**
 * Helper: install a one-shot mock adapter that rejects with a given status,
 * so the response error interceptor fires.
 */
const rejectNextRequest = (
    url: string,
    status: number,
    extraConfig: Record<string, any> = {}
) => {
    const original = apiClient.defaults.adapter;

    apiClient.defaults.adapter = (config) => {
        apiClient.defaults.adapter = original;
        const error: any = new Error(`Request failed with status ${status}`);
        error.response = { status };
        error.config = { ...config, ...extraConfig };
        return Promise.reject(error);
    };
};

describe('client', () => {
    beforeEach(() => {
        setAccessToken(null);
    });

    describe('token management', () => {
        it('setAccessToken stores token', () => {
            setAccessToken('test-token');
            expect(getAccessToken()).toBe('test-token');
        });

        it('getAccessToken returns stored token', () => {
            setAccessToken('abc');
            expect(getAccessToken()).toBe('abc');
        });

        it('setAccessToken(null) clears token', () => {
            setAccessToken('abc');
            setAccessToken(null);
            expect(getAccessToken()).toBeNull();
        });
    });

    describe('apiClient instance', () => {
        it('is created with correct baseURL', () => {
            expect(apiClient.defaults.baseURL).toBe(
                'http://localhost:4000/api'
            );
        });

        it('has withCredentials enabled', () => {
            expect(apiClient.defaults.withCredentials).toBe(true);
        });
    });

    describe('request interceptor', () => {
        it('adds Authorization header when token is set', async () => {
            setAccessToken('my-token');

            const config = await captureNextRequest();

            expect(config.headers.get('Authorization')).toBe(
                'Bearer my-token'
            );
        });

        it('does NOT add Authorization header when no token', async () => {
            setAccessToken(null);

            const config = await captureNextRequest();

            expect(config.headers.get('Authorization')).toBeUndefined();
        });
    });

    describe('response interceptor (401 auto-refresh)', () => {
        let mockAxiosPost: jest.SpyInstance;

        beforeEach(() => {
            mockAxiosPost = jest.spyOn(axios, 'post');
        });

        afterEach(() => {
            mockAxiosPost.mockRestore();
        });

        it('does NOT retry for /auth/refresh endpoint', async () => {
            rejectNextRequest('/auth/refresh', 401);

            await expect(apiClient.get('/auth/refresh')).rejects.toBeDefined();
            expect(mockAxiosPost).not.toHaveBeenCalled();
        });

        it('does NOT retry for /auth/logout endpoint', async () => {
            rejectNextRequest('/auth/logout', 401);

            await expect(apiClient.get('/auth/logout')).rejects.toBeDefined();
            expect(mockAxiosPost).not.toHaveBeenCalled();
        });

        it('does NOT retry if already retried (_retry flag)', async () => {
            rejectNextRequest('/some-endpoint', 401, { _retry: true });

            await expect(
                apiClient.get('/some-endpoint')
            ).rejects.toBeDefined();
            expect(mockAxiosPost).not.toHaveBeenCalled();
        });

        it('does NOT retry for non-401 errors', async () => {
            rejectNextRequest('/some-endpoint', 500);

            await expect(
                apiClient.get('/some-endpoint')
            ).rejects.toBeDefined();
            expect(mockAxiosPost).not.toHaveBeenCalled();
        });

        it('on refresh success → stores new token and retries with Bearer', async () => {
            mockAxiosPost.mockResolvedValueOnce({
                data: { data: { accessToken: 'new-token-123' } },
            });

            const originalAdapter = apiClient.defaults.adapter;
            let callCount = 0;

            apiClient.defaults.adapter = (config) => {
                callCount++;
                if (callCount === 1) {
                    // First call: simulate 401
                    const error: any = new axios.AxiosError(
                        'Unauthorized',
                        '401',
                        config,
                        null,
                        {
                            status: 401,
                            statusText: 'Unauthorized',
                            headers: {},
                            config,
                            data: null,
                        } as any
                    );
                    error.config = config;
                    return Promise.reject(error);
                }
                // Second call: retry succeeds
                return Promise.resolve({
                    data: { ok: true },
                    status: 200,
                    statusText: 'OK',
                    headers: {},
                    config,
                });
            };

            await apiClient.get('/users/me');

            expect(mockAxiosPost).toHaveBeenCalledWith(
                'http://localhost:4000/api/auth/refresh',
                { timezone: expect.any(String) },
                { withCredentials: true }
            );
            expect(getAccessToken()).toBe('new-token-123');

            apiClient.defaults.adapter = originalAdapter;
        });

        it('on refresh failure → clears token and emits session-lost', async () => {
            mockAxiosPost.mockRejectedValueOnce(
                new Error('Refresh failed')
            );

            const sessionLostListener = jest.fn();
            const unsubscribe = authEvents.on(
                'session-lost',
                sessionLostListener
            );

            rejectNextRequest('/users/me', 401);

            await expect(apiClient.get('/users/me')).rejects.toBeDefined();

            expect(getAccessToken()).toBeNull();
            expect(sessionLostListener).toHaveBeenCalledTimes(1);

            unsubscribe();
        });

        it('on successful refresh → does NOT emit session-lost', async () => {
            mockAxiosPost.mockResolvedValueOnce({
                data: { data: { accessToken: 'fresh-token' } },
            });

            const sessionLostListener = jest.fn();
            const unsubscribe = authEvents.on(
                'session-lost',
                sessionLostListener
            );

            const originalAdapter = apiClient.defaults.adapter;
            let callCount = 0;
            apiClient.defaults.adapter = (config) => {
                callCount++;
                if (callCount === 1) {
                    const error: any = new axios.AxiosError(
                        'Unauthorized',
                        '401',
                        config,
                        null,
                        {
                            status: 401,
                            statusText: 'Unauthorized',
                            headers: {},
                            config,
                            data: null,
                        } as any
                    );
                    error.config = config;
                    return Promise.reject(error);
                }
                return Promise.resolve({
                    data: { ok: true },
                    status: 200,
                    statusText: 'OK',
                    headers: {},
                    config,
                });
            };

            await apiClient.get('/users/me');

            expect(sessionLostListener).not.toHaveBeenCalled();

            apiClient.defaults.adapter = originalAdapter;
            unsubscribe();
        });
    });
});
