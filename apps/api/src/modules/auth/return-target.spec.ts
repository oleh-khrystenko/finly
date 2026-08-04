import { BadRequestException } from '@nestjs/common';

jest.mock('../../config/env', () => ({
    ENV: {
        WEB_URL: 'https://finly.com.ua',
        PAY_PUBLIC_URL: 'https://pay.finly.com.ua',
    },
}));

import { assertAllowedReturnTarget } from './return-target';

describe('assertAllowedReturnTarget (Sprint 30 — міжхостове повернення)', () => {
    it('пропускає свій шлях', () => {
        expect(() => assertAllowedReturnTarget('/business/foo')).not.toThrow();
    });

    it('пропускає адресу публічного pay-хоста', () => {
        expect(() =>
            assertAllowedReturnTarget(
                'https://pay.finly.com.ua/dps-kyiv/esv?period=1%20квартал%202026'
            )
        ).not.toThrow();
    });

    it('пропускає адресу кабінету', () => {
        expect(() =>
            assertAllowedReturnTarget('https://finly.com.ua/profile')
        ).not.toThrow();
    });

    it('відхиляє чужий домен', () => {
        expect(() =>
            assertAllowedReturnTarget('https://evil.example/phish')
        ).toThrow(BadRequestException);
    });

    it('відхиляє домен-двійник із нашим суфіксом у назві', () => {
        expect(() =>
            assertAllowedReturnTarget('https://pay.finly.com.ua.evil.example/')
        ).toThrow(BadRequestException);
    });

    it('відхиляє protocol-relative адресу', () => {
        expect(() => assertAllowedReturnTarget('//evil.example')).toThrow(
            BadRequestException
        );
    });

    it('відхиляє шлях зі зворотним слешем (браузер читає його як хост)', () => {
        expect(() => assertAllowedReturnTarget('/\\evil.example')).toThrow(
            BadRequestException
        );
    });

    it('відхиляє інші схеми', () => {
        expect(() => assertAllowedReturnTarget('javascript:alert(1)')).toThrow(
            BadRequestException
        );
    });
});
