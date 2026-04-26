import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { RESPONSE_CODE } from '@cyanship/types';
import { UserDocument } from '../../modules/users/schemas/user.schema';

@Injectable()
export class SubscriptionGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest<Request>();
        const user = request.user as UserDocument | undefined;

        if (!user || !user.billing?.hasActiveSubscription) {
            throw new ForbiddenException({
                code: RESPONSE_CODE.SUBSCRIPTION_REQUIRED,
                message: 'Subscription required',
            });
        }

        return true;
    }
}
