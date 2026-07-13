import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/**
 * Sprint 27 — чи бізнес поточного роуту брендований (у активному Бренд-складі).
 * Читає денормалізований прапор `Business.brandedAt`, який чіпляє
 * `BusinessAccessGuard` / `AccountAccessGuard` / `InvoiceAccessGuard` разом з
 * `request.business`. Передається у доменні сервіси для гейтингу vanity-slug і
 * логотипа (замок slug-редагування, м'який гейт логотипа). Без `request.business`
 * (роут без guard-а) — `false`.
 */
export const CurrentBusinessBranded = createParamDecorator(
    (_data: unknown, ctx: ExecutionContext): boolean => {
        const request = ctx.switchToHttp().getRequest<Request>();
        const business = (request as { business?: { brandedAt?: unknown } })
            .business;
        return business?.brandedAt != null;
    }
);
