import type { Response } from 'express';

jest.mock('../../config/env', () => ({
    ENV: {
        NODE_ENV: 'development',
        AUTH_COOKIE_DOMAIN: 'finly.local',
    },
}));

import {
    clearRefreshCookie,
    REFRESH_COOKIE_NAME,
    REFRESH_COOKIE_OPTIONS,
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

describe('refresh cookie (Sprint 30 — спільна сесія двох хостів)', () => {
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
