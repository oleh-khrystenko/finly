import {
    CallHandler,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { RESPONSE_CODE, isOnboardingComplete } from '@cyanship/types';

import { SKIP_ONBOARDING_KEY } from '../decorators/skip-onboarding.decorator';
import type { UserDocument } from '../../modules/users/schemas/user.schema';

@Injectable()
export class OnboardingInterceptor implements NestInterceptor {
    constructor(private readonly reflector: Reflector) {}

    intercept(
        context: ExecutionContext,
        next: CallHandler
    ): Observable<unknown> {
        const skip = this.reflector.getAllAndOverride<boolean>(
            SKIP_ONBOARDING_KEY,
            [context.getHandler(), context.getClass()]
        );

        if (skip) {
            return next.handle();
        }

        const request = context.switchToHttp().getRequest<Request>();
        const user = request.user as UserDocument | undefined;

        if (user && !isOnboardingComplete(user.profile)) {
            throw new ForbiddenException({
                code: RESPONSE_CODE.ONBOARDING_INCOMPLETE,
                message: 'Onboarding incomplete',
            });
        }

        return next.handle();
    }
}
