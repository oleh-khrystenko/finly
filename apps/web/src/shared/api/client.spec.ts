import axios, { AxiosHeaders } from 'axios';

jest.mock('@/shared/config', () => ({
    ENV: {
        NEXT_PUBLIC_API_URL: 'http://localhost:4000/api',
        NEXT_PUBLIC_BASE_URL: 'http://localhost:3000',
    },
}));

import { authEvents } from '@/shared/lib';

import {
    apiClient,
    getAccessToken,
    PublicApiError,
    publicPostJson,
    setAccessToken,
} from './client';

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

            expect(config.headers.get('Authorization')).toBe('Bearer my-token');
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

            await expect(apiClient.get('/some-endpoint')).rejects.toBeDefined();
            expect(mockAxiosPost).not.toHaveBeenCalled();
        });

        it('does NOT retry for non-401 errors', async () => {
            rejectNextRequest('/some-endpoint', 500);

            await expect(apiClient.get('/some-endpoint')).rejects.toBeDefined();
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
            mockAxiosPost.mockRejectedValueOnce(new Error('Refresh failed'));

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

// ─── Sprint 8 §8.3 ─────────────────────────────────────────────────────────
// publicPostJson — anon-сторонa POST для `/api/qr/preview`. Контракт безпеки:
//   - native fetch (не axios), щоб обійти Bearer-interceptor `apiClient`
//   - credentials: 'omit' — ніяких cookies (якщо anon-користувач залогінений
//     у іншій вкладці на cabinet host, його `bid_refresh` НЕ повинен потрапити
//     у anon-flow)
//   - Content-Type: application/json + body = JSON.stringify(...)
//   - non-2xx → PublicApiError зі збереженням status

describe('publicPostJson', () => {
    const ORIGINAL_FETCH = globalThis.fetch;
    let fetchMock: jest.Mock;

    /**
     * Mock-helper: будує fetch-response shape з полями, які `publicPostJson`
     * реально читає (`.ok`, `.status`, `.statusText`, `.json()`).
     * Не використовуємо global `Response`, бо jsdom 26+ не вшиває цей клас.
     */
    const mockFetchResponse = (params: {
        ok: boolean;
        status: number;
        statusText?: string;
        body?: unknown;
    }): unknown => ({
        ok: params.ok,
        status: params.status,
        statusText: params.statusText ?? '',
        json: async () => params.body ?? {},
    });

    beforeEach(() => {
        fetchMock = jest.fn();
        globalThis.fetch = fetchMock as unknown as typeof fetch;
    });

    afterEach(() => {
        globalThis.fetch = ORIGINAL_FETCH;
    });

    it('викликає fetch з POST + credentials:omit + JSON content-type + serialized body', async () => {
        fetchMock.mockResolvedValue(
            mockFetchResponse({
                ok: true,
                status: 200,
                body: { data: { ok: true } },
            })
        );

        const body = { foo: 'bar' };
        await publicPostJson<typeof body, { data: { ok: boolean } }>(
            '/qr/preview',
            body
        );

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0]!;
        expect(url).toBe('http://localhost:4000/api/qr/preview');
        expect(init).toMatchObject({
            method: 'POST',
            credentials: 'omit',
            body: JSON.stringify(body),
        });
        expect(init.headers).toMatchObject({
            Accept: 'application/json',
            'Content-Type': 'application/json',
        });
        // Захист від cabinet-cookie leak: жодного Authorization-header.
        expect(init.headers).not.toHaveProperty('Authorization');
    });

    it('повертає parsed JSON-response на 2xx', async () => {
        const responseBody = {
            data: { link: 'https://qr.bank.gov.ua/x', qrPngBase64: 'abc' },
        };
        fetchMock.mockResolvedValue(
            mockFetchResponse({ ok: true, status: 200, body: responseBody })
        );

        const result = await publicPostJson<unknown, typeof responseBody>(
            '/qr/preview',
            {}
        );

        expect(result).toEqual(responseBody);
    });

    it('кидає PublicApiError з преciзним status на non-2xx', async () => {
        fetchMock.mockResolvedValueOnce(
            mockFetchResponse({
                ok: false,
                status: 400,
                statusText: 'Bad Request',
            })
        );

        await expect(
            publicPostJson('/qr/preview', { invalid: true })
        ).rejects.toBeInstanceOf(PublicApiError);

        fetchMock.mockResolvedValueOnce(
            mockFetchResponse({
                ok: false,
                status: 429,
                statusText: 'Too Many Requests',
            })
        );

        try {
            await publicPostJson('/qr/preview', {});
            throw new Error('should have thrown');
        } catch (err) {
            expect(err).toBeInstanceOf(PublicApiError);
            expect((err as PublicApiError).status).toBe(429);
        }
    });

    it('нормалізує path без leading slash', async () => {
        fetchMock.mockResolvedValue(
            mockFetchResponse({ ok: true, status: 200, body: {} })
        );

        await publicPostJson('qr/preview', {});

        expect(fetchMock.mock.calls[0]![0]).toBe(
            'http://localhost:4000/api/qr/preview'
        );
    });
});
