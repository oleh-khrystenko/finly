import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { RESPONSE_CODE } from '@cyanship/types';

import { TurnstileService } from './turnstile.service';

jest.mock('../../../config/env', () => ({
    ENV: {
        TURNSTILE_SECRET_KEY: 'test-secret-key',
    },
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('TurnstileService', () => {
    let service: TurnstileService;

    beforeEach(async () => {
        jest.clearAllMocks();

        const module: TestingModule = await Test.createTestingModule({
            providers: [TurnstileService],
        }).compile();

        service = module.get(TurnstileService);
    });

    it('resolves when Turnstile returns success', async () => {
        mockFetch.mockResolvedValue({
            json: () => Promise.resolve({ success: true }),
        });

        await expect(service.verify('valid-token')).resolves.toBeUndefined();

        expect(mockFetch).toHaveBeenCalledWith(
            'https://challenges.cloudflare.com/turnstile/v0/siteverify',
            expect.objectContaining({
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            })
        );

        const body = mockFetch.mock.calls[0][1].body as URLSearchParams;
        expect(body.get('secret')).toBe('test-secret-key');
        expect(body.get('response')).toBe('valid-token');
    });

    it('throws BadRequestException with CAPTCHA_FAILED when Turnstile returns failure', async () => {
        mockFetch.mockResolvedValue({
            json: () =>
                Promise.resolve({
                    success: false,
                    'error-codes': ['invalid-input-response'],
                }),
        });

        await expect(service.verify('invalid-token')).rejects.toThrow(
            BadRequestException
        );

        try {
            await service.verify('invalid-token');
        } catch (err) {
            expect((err as BadRequestException).getResponse()).toMatchObject({
                code: RESPONSE_CODE.CAPTCHA_FAILED,
            });
        }
    });

    it('passes remoteip when provided', async () => {
        mockFetch.mockResolvedValue({
            json: () => Promise.resolve({ success: true }),
        });

        await service.verify('token', '192.168.1.1');

        const body = mockFetch.mock.calls[0][1].body as URLSearchParams;
        expect(body.get('remoteip')).toBe('192.168.1.1');
    });

    it('does not pass remoteip when not provided', async () => {
        mockFetch.mockResolvedValue({
            json: () => Promise.resolve({ success: true }),
        });

        await service.verify('token');

        const body = mockFetch.mock.calls[0][1].body as URLSearchParams;
        expect(body.get('remoteip')).toBeNull();
    });
});
