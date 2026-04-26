import {
    ExecutionContext,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import type { UserDocument } from '../../modules/users/schemas/user.schema';

@Injectable()
export class JwtActiveGuard extends AuthGuard('jwt') {
    handleRequest<TUser = UserDocument>(
        err: Error | null,
        user: TUser | false,
        info: unknown,
        context: ExecutionContext
    ): TUser {
        const authenticatedUser = super.handleRequest<TUser>(
            err,
            user,
            info,
            context
        );
        if (
            authenticatedUser &&
            (authenticatedUser as unknown as UserDocument).deletedAt
        ) {
            throw new UnauthorizedException();
        }
        return authenticatedUser;
    }
}
