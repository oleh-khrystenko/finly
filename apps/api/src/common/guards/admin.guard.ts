import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { RESPONSE_CODE } from '@finly/types';

import type { UserDocument } from '../../modules/users/schemas/user.schema';

/**
 * Sprint 28 — перша адмін-поверхня продукту. Ставиться ПІСЛЯ JwtActiveGuard
 * (той кладе UserDocument у request.user); сам по собі не автентифікує.
 * `role` нормалізується як у user-profile.mapper: legacy-документи без поля
 * трактуються як 'user' (Mongoose default працює лише на insert).
 */
@Injectable()
export class AdminGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const request = context
            .switchToHttp()
            .getRequest<{ user?: UserDocument }>();
        if (request.user?.role !== 'admin') {
            throw new ForbiddenException({
                code: RESPONSE_CODE.ADMIN_ACCESS_REQUIRED,
                message: 'Admin role required',
            });
        }
        return true;
    }
}
