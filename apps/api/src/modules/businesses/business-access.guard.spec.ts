import {
    ExecutionContext,
    ForbiddenException,
    NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';

import { BusinessAccessGuard } from './business-access.guard';
import type { BusinessesService } from './businesses.service';
import type { BusinessDocument } from './schemas/business.schema';
import type { UserDocument } from '../users/schemas/user.schema';

const buildContext = (
    user: Partial<UserDocument> | undefined,
    slug: string | undefined
): ExecutionContext =>
    ({
        switchToHttp: () => ({
            getRequest: () => ({
                user,
                params: slug !== undefined ? { slug } : {},
                business: undefined,
            }),
        }),
    }) as unknown as ExecutionContext;

describe('BusinessAccessGuard', () => {
    let businessesService: { getBySlug: jest.Mock };
    let guard: BusinessAccessGuard;

    beforeEach(() => {
        businessesService = { getBySlug: jest.fn() };
        guard = new BusinessAccessGuard(
            businessesService as unknown as BusinessesService
        );
    });

    it('кидає NotFoundException(BUSINESS_NOT_FOUND) для неіснуючого slug', async () => {
        businessesService.getBySlug.mockResolvedValue(null);
        const userId = new Types.ObjectId();
        const ctx = buildContext({ _id: userId } as UserDocument, 'missing');

        await expect(guard.canActivate(ctx)).rejects.toMatchObject({
            response: { code: 'BUSINESS_NOT_FOUND' },
        });
        await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
            NotFoundException
        );
    });

    it('кидає ForbiddenException(BUSINESS_ACCESS_DENIED) коли user не owner і не manager', async () => {
        const userId = new Types.ObjectId();
        const otherId = new Types.ObjectId();
        businessesService.getBySlug.mockResolvedValue({
            ownerId: otherId,
            managers: [],
        } as unknown as BusinessDocument);
        const ctx = buildContext({ _id: userId } as UserDocument, 'foo');

        await expect(guard.canActivate(ctx)).rejects.toMatchObject({
            response: { code: 'BUSINESS_ACCESS_DENIED' },
        });
        await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
            ForbiddenException
        );
    });

    it('пропускає ownerа — повертає true і attach-ить business до request', async () => {
        const userId = new Types.ObjectId();
        const business = {
            ownerId: userId,
            managers: [],
        } as unknown as BusinessDocument;
        businessesService.getBySlug.mockResolvedValue(business);

        // Окрема invocation, що дозволяє після canActivate перевірити mutation.
        const req: {
            user: { _id: Types.ObjectId };
            params: { slug: string };
            business?: BusinessDocument;
        } = {
            user: { _id: userId },
            params: { slug: 'foo' },
        };
        const ctx = {
            switchToHttp: () => ({ getRequest: () => req }),
        } as unknown as ExecutionContext;

        await expect(guard.canActivate(ctx)).resolves.toBe(true);
        expect(req.business).toBe(business);
    });

    it('пропускає manager-а (ownerless business)', async () => {
        const userId = new Types.ObjectId();
        const business = {
            ownerId: null,
            managers: [userId],
        } as unknown as BusinessDocument;
        businessesService.getBySlug.mockResolvedValue(business);
        const ctx = buildContext({ _id: userId } as UserDocument, 'foo');

        await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('case-insensitive lookup — guard передає raw slug сервісу (нормалізація на сервіс-layer)', async () => {
        const userId = new Types.ObjectId();
        businessesService.getBySlug.mockResolvedValue({
            ownerId: userId,
            managers: [],
        } as unknown as BusinessDocument);
        const ctx = buildContext({ _id: userId } as UserDocument, 'IvanEnko');

        await guard.canActivate(ctx);
        expect(businessesService.getBySlug).toHaveBeenCalledWith('IvanEnko');
    });

    it('кидає Error при відсутності user (програмерська помилка — JwtActiveGuard не підключений)', async () => {
        const ctx = buildContext(undefined, 'foo');
        await expect(guard.canActivate(ctx)).rejects.toThrow(
            /JwtActiveGuard before it/
        );
    });

    it('кидає NotFound при відсутньому slug у params (захист від misroute-у)', async () => {
        const userId = new Types.ObjectId();
        const ctx = buildContext({ _id: userId } as UserDocument, undefined);
        await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
            NotFoundException
        );
    });
});
