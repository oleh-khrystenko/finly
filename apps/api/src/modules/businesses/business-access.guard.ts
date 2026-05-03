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

import type { UserDocument } from '../users/schemas/user.schema';
import { BusinessesService } from './businesses.service';
import type { BusinessDocument } from './schemas/business.schema';

/**
 * Sprint 3 §3.2 §3.10 — guard для cabinet-ендпоінтів `/businesses/me/:slug`.
 *
 * **Контракт.** Стає у chain ПІСЛЯ `JwtActiveGuard` (який кладе user у
 * `request.user`). Витягує `:slug` з route-params, лукапить бізнес через
 * `BusinessesService.getBySlug` (case-insensitive по `slugLower`), перевіряє
 * `user._id ∈ {ownerId} ∪ managers`. На fail — 404 (`BUSINESS_NOT_FOUND`)
 * або 403 (`BUSINESS_ACCESS_DENIED`) з explicit machine-кодом.
 *
 * **Resolved business attach до `request`** — controller-метод не робить
 * повторний lookup. NestJS-ідіома: param-decorator `@CurrentBusiness()`
 * читає з `request.business` (як `@CurrentUser()` читає з `request.user`).
 *
 * **Чому 404 для не-існуючого бізнесу замість generic 403** (захист від
 * enumeration): для cabinet-зони enumeration-attack нерелевантний — атакер
 * має валідну сесію і так може створити власний бізнес. Чесний 404 кращий
 * UX (правильний error message в кабінеті) і трохи менше surface для
 * confused debugging-у. Public-зона (без guard-у) — окрема історія, там
 * 404 теж, але з різними міркуваннями (TPM-ризик scraping слугами,
 * див. §3.3).
 */
@Injectable()
export class BusinessAccessGuard implements CanActivate {
    constructor(private readonly businessesService: BusinessesService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context
            .switchToHttp()
            .getRequest<RequestWithBusinessContext>();
        const user = request.user;
        if (!user) {
            // Програмерська помилка: guard підключили без JwtActiveGuard
            // попереду. Кидаємо явну помилку, щоб не плутати її з 401.
            throw new Error(
                'BusinessAccessGuard requires JwtActiveGuard before it'
            );
        }

        const slug = request.params?.slug;
        if (typeof slug !== 'string' || slug.length === 0) {
            throw new NotFoundException({
                code: RESPONSE_CODE.BUSINESS_NOT_FOUND,
                message: 'Business slug missing in route params',
            });
        }

        const business = await this.businessesService.getBySlug(slug);
        if (!business) {
            throw new NotFoundException({
                code: RESPONSE_CODE.BUSINESS_NOT_FOUND,
                message: 'Business not found',
            });
        }

        const userId = user._id.toString();
        const isOwner =
            business.ownerId !== null && business.ownerId.toString() === userId;
        const isManager = business.managers.some(
            (m) => m.toString() === userId
        );
        if (!isOwner && !isManager) {
            throw new ForbiddenException({
                code: RESPONSE_CODE.BUSINESS_ACCESS_DENIED,
                message: 'No access to this business',
            });
        }

        request.business = business;
        return true;
    }
}

/**
 * Param-decorator, що віддає resolved business з request-у. Призначений ТІЛЬКИ
 * для роутів під `BusinessAccessGuard` — без guard-у `request.business` буде
 * undefined і controller отримає `undefined` (TypeScript цього не зловить —
 * це runtime-контракт). На public-роутах використовуємо `BusinessesService`
 * напряму, не цей decorator.
 */
export const CurrentBusiness = createParamDecorator(
    (_data: unknown, ctx: ExecutionContext) => {
        const request = ctx
            .switchToHttp()
            .getRequest<RequestWithBusinessContext>();
        return request.business;
    }
);

interface RequestWithBusinessContext extends Request {
    user?: UserDocument;
    business?: BusinessDocument;
}
