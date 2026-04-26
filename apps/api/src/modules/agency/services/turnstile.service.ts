import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { RESPONSE_CODE } from '@cyanship/types';

import { ENV } from '../../../config/env';

interface TurnstileVerifyResponse {
    success: boolean;
    'error-codes'?: string[];
}

@Injectable()
export class TurnstileService {
    private readonly logger = new Logger(TurnstileService.name);
    private readonly verifyUrl =
        'https://challenges.cloudflare.com/turnstile/v0/siteverify';

    async verify(token: string, remoteIp?: string): Promise<void> {
        const body: Record<string, string> = {
            secret: ENV.TURNSTILE_SECRET_KEY,
            response: token,
        };

        if (remoteIp) {
            body.remoteip = remoteIp;
        }

        const response = await fetch(this.verifyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(body),
        });

        const result = (await response.json()) as TurnstileVerifyResponse;

        if (!result.success) {
            this.logger.warn(
                `Turnstile verification failed: ${result['error-codes']?.join(', ') ?? 'unknown'}`
            );
            throw new BadRequestException({
                code: RESPONSE_CODE.CAPTCHA_FAILED,
                message: 'Captcha verification failed',
            });
        }
    }
}
