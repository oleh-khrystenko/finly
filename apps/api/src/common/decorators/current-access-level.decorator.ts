import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { type AccessLevel } from '@finly/types';

import { resolveAccessLevel } from '../billing/resolve-access-level';

/**
 * Рівень доступу поточного користувача (`none < brand < bookkeeper`), похідний
 * з його білінг-стану. Працює лише за наявності `request.user` (під
 * `JwtActiveGuard`); без білінгу — `none`. Передається у сервіси для замків
 * (slug-редагування, ліміти бізнесів).
 */
export const CurrentAccessLevel = createParamDecorator(
    (_data: unknown, ctx: ExecutionContext): AccessLevel => {
        const request = ctx.switchToHttp().getRequest<Request>();
        const user = request.user as { billing?: unknown } | undefined;
        const billing = (user?.billing ?? null) as Parameters<
            typeof resolveAccessLevel
        >[0];
        return resolveAccessLevel(billing);
    }
);
