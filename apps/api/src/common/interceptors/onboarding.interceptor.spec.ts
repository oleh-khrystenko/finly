import {
    CallHandler,
    ExecutionContext,
    ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { RESPONSE_CODE } from '@finly/types';
import { firstValueFrom, of } from 'rxjs';

import { OnboardingInterceptor } from './onboarding.interceptor';

const createContext = (
    user: unknown,
    handler: () => unknown = () => undefined,
    klass: () => unknown = () => undefined
): ExecutionContext =>
    ({
        switchToHttp: () => ({ getRequest: () => ({ user }) }),
        getHandler: () => handler,
        getClass: () => klass,
    }) as unknown as ExecutionContext;

const okHandler: CallHandler = { handle: () => of('next') };

describe('OnboardingInterceptor', () => {
    let interceptor: OnboardingInterceptor;
    let reflector: Reflector;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [OnboardingInterceptor, Reflector],
        }).compile();

        interceptor = module.get(OnboardingInterceptor);
        reflector = module.get(Reflector);
    });

    it('passes through when profile has firstName and lastName', async () => {
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
        const ctx = createContext({
            profile: { firstName: 'Іван', lastName: 'Іваненко' },
        });

        const result = await firstValueFrom(
            interceptor.intercept(ctx, okHandler)
        );

        expect(result).toBe('next');
    });

    it('blocks when lastName is missing', () => {
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
        const ctx = createContext({
            profile: { firstName: 'Іван' },
        });

        const error = (() => {
            try {
                interceptor.intercept(ctx, okHandler);
            } catch (e) {
                return e as ForbiddenException;
            }
        })();

        expect(error).toBeInstanceOf(ForbiddenException);
        expect(error?.getResponse()).toMatchObject({
            code: RESPONSE_CODE.ONBOARDING_INCOMPLETE,
        });
    });

    it('blocks when firstName is missing', () => {
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
        const ctx = createContext({
            profile: { lastName: 'Іваненко' },
        });

        expect(() => interceptor.intercept(ctx, okHandler)).toThrow(
            ForbiddenException
        );
    });

    it('blocks when profile is empty', () => {
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
        const ctx = createContext({ profile: {} });

        expect(() => interceptor.intercept(ctx, okHandler)).toThrow(
            ForbiddenException
        );
    });

    it('skips check when @SkipOnboarding decorator is set', async () => {
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
        const ctx = createContext({ profile: {} });

        const result = await firstValueFrom(
            interceptor.intercept(ctx, okHandler)
        );

        expect(result).toBe('next');
    });

    it('passes through when no user is attached (anonymous endpoints)', async () => {
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
        const ctx = createContext(undefined);

        const result = await firstValueFrom(
            interceptor.intercept(ctx, okHandler)
        );

        expect(result).toBe('next');
    });
});
