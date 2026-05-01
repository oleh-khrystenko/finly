import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { RESPONSE_CODE } from '@finly/types';

import { SubscriptionGuard } from './subscription.guard';

const createMockContext = (user: unknown): ExecutionContext =>
    ({
        switchToHttp: () => ({
            getRequest: () => ({ user }),
        }),
    }) as unknown as ExecutionContext;

describe('SubscriptionGuard', () => {
    let guard: SubscriptionGuard;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [SubscriptionGuard],
        }).compile();

        guard = module.get<SubscriptionGuard>(SubscriptionGuard);
    });

    it('should return true when hasActiveSubscription is true', () => {
        const ctx = createMockContext({
            billing: { hasActiveSubscription: true },
        });

        expect(guard.canActivate(ctx)).toBe(true);
    });

    it('should throw ForbiddenException with SUBSCRIPTION_REQUIRED when hasActiveSubscription is false', () => {
        const ctx = createMockContext({
            billing: { hasActiveSubscription: false },
        });

        const error = (() => {
            try {
                guard.canActivate(ctx);
            } catch (e) {
                return e as ForbiddenException;
            }
        })();

        expect(error).toBeInstanceOf(ForbiddenException);
        expect(error?.getResponse()).toMatchObject({
            code: RESPONSE_CODE.SUBSCRIPTION_REQUIRED,
        });
    });

    it('should throw ForbiddenException when billing is null', () => {
        const ctx = createMockContext({ billing: null });

        expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when billing is undefined', () => {
        const ctx = createMockContext({ billing: undefined });

        expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when user is undefined', () => {
        const ctx = createMockContext(undefined);

        expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('should return true when hasActiveSubscription is true regardless of subscriptionStatus (TRIALING)', () => {
        const ctx = createMockContext({
            billing: {
                hasActiveSubscription: true,
                subscriptionStatus: 'TRIALING',
            },
        });

        expect(guard.canActivate(ctx)).toBe(true);
    });
});
