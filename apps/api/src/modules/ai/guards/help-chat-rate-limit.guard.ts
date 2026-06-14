import {
    CanActivate,
    ExecutionContext,
    HttpException,
    HttpStatus,
    Injectable,
    InternalServerErrorException,
    Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { RESPONSE_CODE } from '@finly/types';

import { RedisCounterService } from '../../../common/services/redis-counter.service';
import { ENV } from '../../../config/env';

const HELP_IP_KEY_PREFIX = 'ai:help:ip:';
const HELP_BUDGET_KEY = 'ai:help:budget';
const HELP_WINDOW_SECONDS = 86_400; // 24 hours

/**
 * Two-layer wallet protection for the public help assistant (Sprint 16):
 *   1. Per-IP fixed-window limit — caps a single visitor.
 *   2. Global daily budget circuit-breaker — caps total anon spend regardless
 *      of how many IPs hit it; frontend degrades to static articles on
 *      AI_HELP_BUDGET_EXHAUSTED.
 *
 * Both counters share their own namespace, fully separate from the cabinet AI
 * chat IP limit. IP is checked first, so an IP already over its limit does not
 * consume global budget.
 */
@Injectable()
export class HelpChatRateLimitGuard implements CanActivate {
    private readonly logger = new Logger(HelpChatRateLimitGuard.name);

    constructor(private readonly redisCounter: RedisCounterService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<Request>();
        await this.enforceLimits(request);
        return true;
    }

    private extractIp(request: Request): string {
        // ТІЛЬКИ `request.ip`: Express сам резолвить клієнтський IP з урахуванням
        // `trust proxy` (TRUST_PROXY_HOPS у main.ts). Ручний парсинг
        // X-Forwarded-For довіряв би client-controllable заголовку — атакуючий
        // обходив би per-IP ліміт випадковим XFF і висушував би daily-budget,
        // або прицільно вичерпував би ключ чужого IP.
        return request.ip || 'unknown';
    }

    private async enforceLimits(request: Request): Promise<void> {
        const ip = this.extractIp(request);

        try {
            const ipCount = await this.redisCounter.incrementFixedWindow(
                `${HELP_IP_KEY_PREFIX}${ip}`,
                HELP_WINDOW_SECONDS
            );
            if (ipCount > ENV.HELP_CHAT_IP_LIMIT) {
                throw new HttpException(
                    {
                        code: RESPONSE_CODE.AI_RATE_LIMIT_EXCEEDED,
                        message: 'Help chat rate limit exceeded',
                    },
                    HttpStatus.TOO_MANY_REQUESTS
                );
            }

            const budgetCount = await this.redisCounter.incrementFixedWindow(
                HELP_BUDGET_KEY,
                HELP_WINDOW_SECONDS
            );
            if (budgetCount > ENV.HELP_CHAT_DAILY_BUDGET) {
                throw new HttpException(
                    {
                        code: RESPONSE_CODE.AI_HELP_BUDGET_EXHAUSTED,
                        message: 'Help chat daily budget exhausted',
                    },
                    HttpStatus.TOO_MANY_REQUESTS
                );
            }
        } catch (err) {
            if (err instanceof HttpException) throw err;

            this.logger.error(
                `Redis error during help chat rate limit check: ${(err as Error).message}`
            );
            throw new InternalServerErrorException(
                'Help assistant temporarily unavailable'
            );
        }
    }
}
