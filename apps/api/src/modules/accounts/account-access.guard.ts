import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    NotFoundException,
    createParamDecorator,
} from '@nestjs/common';
import { Request } from 'express';
import { RESPONSE_CODE } from '@finly/types';

import type { BusinessDocument } from '../businesses/schemas/business.schema';
import type { UserDocument } from '../users/schemas/user.schema';
import { AccountsService } from './accounts.service';
import type { AccountDocument } from './schemas/account.schema';

/**
 * Sprint 9 §9.1 — guard для cabinet-endpoint-ів з `:accountSlug`-route-param.
 *
 * **Контракт.** Стає у chain ПІСЛЯ `JwtActiveGuard` + `BusinessAccessGuard`.
 * Читає `request.business` (already attached) → case-sensitive lookup
 * `(businessId, slug)` → захист `account.businessId === business._id`
 * (defense-in-depth; compound-index уже гарантує).
 *
 * **Чому 404 на ownership-mismatch (не 403):** ownership-check вже зробив
 * `BusinessAccessGuard` (тільки owner/managers business-у можуть дійти сюди);
 * якщо account-slug case-sensitive misshape — це 404 NOT_FOUND (account
 * не існує у цьому business-namespace-i). 403 зарезервовано на потенційне
 * розширення (Sprint 6: bookkeeper read-only mode тощо) — окремий код
 * `ACCOUNT_ACCESS_DENIED` лишається у `RESPONSE_CODE` для майбутнього.
 */
@Injectable()
export class AccountAccessGuard implements CanActivate {
    constructor(private readonly accountsService: AccountsService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context
            .switchToHttp()
            .getRequest<RequestWithAccountContext>();
        const business = request.business;
        if (!business) {
            throw new Error(
                'AccountAccessGuard requires BusinessAccessGuard before it'
            );
        }
        const accountSlug = request.params?.accountSlug;
        if (typeof accountSlug !== 'string' || accountSlug.length === 0) {
            throw new NotFoundException({
                code: RESPONSE_CODE.ACCOUNT_NOT_FOUND,
                message: 'Account slug missing in route params',
            });
        }
        const account = await this.accountsService.getBySlug(
            business._id,
            accountSlug
        );
        if (!account) {
            throw new NotFoundException({
                code: RESPONSE_CODE.ACCOUNT_NOT_FOUND,
                message: 'Account not found',
            });
        }
        if (account.businessId.toString() !== business._id.toString()) {
            // Defense-in-depth — compound-unique-index уже гарантує, що
            // `(businessId, slug)`-lookup поверне account рівно цього business.
            // Цей check ловить теоретичну data-corruption.
            throw new ForbiddenException({
                code: RESPONSE_CODE.ACCOUNT_ACCESS_DENIED,
                message: 'Account does not belong to this business',
            });
        }
        request.account = account;
        return true;
    }
}

export const CurrentAccount = createParamDecorator(
    (_data: unknown, ctx: ExecutionContext) => {
        const request = ctx
            .switchToHttp()
            .getRequest<RequestWithAccountContext>();
        return request.account;
    }
);

interface RequestWithAccountContext extends Request {
    user?: UserDocument;
    business?: BusinessDocument;
    account?: AccountDocument;
}
