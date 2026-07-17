import { ExecutionContext, ForbiddenException } from '@nestjs/common';

import { AdminGuard } from './admin.guard';
import type { UserDocument } from '../../modules/users/schemas/user.schema';

const buildContext = (
    user: Partial<UserDocument> | undefined
): ExecutionContext =>
    ({
        switchToHttp: () => ({
            getRequest: () => ({ user }),
        }),
    }) as unknown as ExecutionContext;

describe('AdminGuard', () => {
    const guard = new AdminGuard();

    it('пропускає користувача з role admin', () => {
        const ctx = buildContext({ role: 'admin' } as UserDocument);
        expect(guard.canActivate(ctx)).toBe(true);
    });

    it('відхиляє звичайного користувача з ADMIN_ACCESS_REQUIRED', () => {
        const ctx = buildContext({ role: 'user' } as UserDocument);
        expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
        try {
            guard.canActivate(ctx);
        } catch (err) {
            expect(err).toMatchObject({
                response: { code: 'ADMIN_ACCESS_REQUIRED' },
            });
        }
    });

    it('відхиляє legacy-документ без ролі (трактується як не-admin)', () => {
        const ctx = buildContext({} as UserDocument);
        expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('відхиляє відсутнього користувача', () => {
        const ctx = buildContext(undefined);
        expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });
});
