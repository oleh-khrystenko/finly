import type { Response } from 'express';

let mockCookieDomain = 'finly.local';

jest.mock('../../config/env', () => ({
    ENV: {
        NODE_ENV: 'development',
        get AUTH_COOKIE_DOMAIN() {
            return mockCookieDomain;
        },
    },
}));

import {
    clearRefreshCookie,
    REFRESH_COOKIE_NAME,
    REFRESH_COOKIE_OPTIONS,
    resolveRefreshCookieDomain,
    setRefreshCookie,
} from './refresh-cookie.config';

const createRes = () =>
    ({
        cookie: jest.fn(),
        clearCookie: jest.fn(),
    }) as unknown as Response & {
        cookie: jest.Mock;
        clearCookie: jest.Mock;
    };

function loadWithCookieDomain(cookieDomain: string) {
    let mod!: typeof import('./refresh-cookie.config');
    mockCookieDomain = cookieDomain;
    try {
        jest.isolateModules(() => {
            mod = jest.requireActual<typeof import('./refresh-cookie.config')>(
                './refresh-cookie.config'
            );
        });
    } finally {
        mockCookieDomain = 'finly.local';
    }
    return mod;
}

describe('refresh cookie (Sprint 30 — спільна сесія двох хостів)', () => {
    it('не додає Domain для localhost — cookie і так спільна між портами', () => {
        expect(resolveRefreshCookieDomain('localhost')).toBeUndefined();
    });

    it('зберігає батьківський домен для різних прод-хостів', () => {
        expect(resolveRefreshCookieDomain('finly.com.ua')).toBe('finly.com.ua');
    });

    it('у локальній конфігурації ставить одну host-only cookie', () => {
        const local = loadWithCookieDomain('localhost');
        const res = createRes();

        local.setRefreshCookie(res, 'refresh-token');

        expect(local.REFRESH_COOKIE_OPTIONS).not.toHaveProperty('domain');
        expect(res.cookie).toHaveBeenCalledWith(
            local.REFRESH_COOKIE_NAME,
            'refresh-token',
            expect.not.objectContaining({ domain: expect.anything() })
        );
        expect(res.clearCookie).toHaveBeenCalledWith(
            local.REFRESH_COOKIE_NAME,
            expect.objectContaining({ domain: 'localhost' })
        );

        res.clearCookie.mockClear();

        local.clearRefreshCookie(res);

        const domains = res.clearCookie.mock.calls.map(
            ([, options]) => (options as { domain?: string }).domain
        );
        expect(domains).toEqual([undefined, 'localhost']);
    });

    it('прив’язує сесійну cookie до батьківського домену', () => {
        expect(REFRESH_COOKIE_OPTIONS.domain).toBe('finly.local');
        expect(REFRESH_COOKIE_OPTIONS.httpOnly).toBe(true);
        expect(REFRESH_COOKIE_OPTIONS.path).toBe('/');
    });

    it('разом із новою cookie гасить cookie старого зразка (без домену)', () => {
        const res = createRes();

        setRefreshCookie(res, 'refresh-token');

        expect(res.cookie).toHaveBeenCalledWith(
            REFRESH_COOKIE_NAME,
            'refresh-token',
            expect.objectContaining({ domain: 'finly.local' })
        );
        // Видалення мусить повторювати атрибути старої cookie: команда з новим
        // `Domain=` host-only запис не зачіпає, і браузер надсилав би дві
        // cookie з одним іменем — сервер читав би стару, а reuse-detection
        // вбивав би щойно створену сесію.
        const legacyClear = res.clearCookie.mock.calls.find(
            ([name, options]) =>
                name === REFRESH_COOKIE_NAME &&
                (options as { domain?: string }).domain === undefined
        );
        expect(legacyClear).toBeDefined();
    });

    it('на виході гасить обидва зразки cookie', () => {
        const res = createRes();

        clearRefreshCookie(res);

        const domains = res.clearCookie.mock.calls.map(
            ([, options]) => (options as { domain?: string }).domain
        );
        expect(domains).toContain('finly.local');
        expect(domains).toContain(undefined);
    });
});
