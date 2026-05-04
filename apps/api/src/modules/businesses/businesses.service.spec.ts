import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
    BadRequestException,
    InternalServerErrorException,
    NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { VAT_ALLOWED_TAXATION_SYSTEMS } from '@finly/types';
import type {
    CreateBusinessRequest,
    UpdateBusinessRequest,
} from '@finly/types';

import { BusinessesService } from './businesses.service';
import { Business } from './schemas/business.schema';
import { SlugGeneratorService } from './slug-generator.service';

describe('BusinessesService', () => {
    let service: BusinessesService;
    let businessModel: jest.Mocked<{
        create: jest.Mock;
        find: jest.Mock;
        findOne: jest.Mock;
        findOneAndUpdate: jest.Mock;
        exists: jest.Mock;
        deleteOne: jest.Mock;
    }>;
    let slugGenerator: jest.Mocked<{ generateRandomSlug: jest.Mock }>;

    const userId = new Types.ObjectId();

    const VALID_CREATE: CreateBusinessRequest = {
        type: 'fop',
        name: 'Іваненко',
        requisites: {
            iban: 'UA213223130000026007233566001',
            taxId: '1234567899',
        },
        taxationSystem: 'simplified-3',
        isVatPayer: false,
        paymentPurposeTemplate: 'Оплата',
        acceptedBanks: ['privatbank'],
    };

    beforeEach(async () => {
        businessModel = {
            create: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            findOneAndUpdate: jest.fn(),
            exists: jest.fn(),
            deleteOne: jest.fn(),
        };
        slugGenerator = {
            generateRandomSlug: jest.fn().mockResolvedValue('IvanEnko'),
        };

        const module = await Test.createTestingModule({
            providers: [
                BusinessesService,
                {
                    provide: getModelToken(Business.name),
                    useValue: businessModel,
                },
                { provide: SlugGeneratorService, useValue: slugGenerator },
            ],
        }).compile();
        service = module.get(BusinessesService);
    });

    describe('create', () => {
        it('створює owned business для звичайного ФОП (worksAsBookkeeper=false)', async () => {
            businessModel.create.mockResolvedValue({} as never);
            await service.create(userId.toString(), VALID_CREATE, false);

            const arg = businessModel.create.mock.calls[0]![0];
            expect(arg).toMatchObject({
                slug: 'IvanEnko',
                slugLower: 'ivanenko',
                ownerId: expect.any(Types.ObjectId),
                managers: [],
            });
            expect(arg.ownerId.toString()).toBe(userId.toString());
        });

        it('створює ownerless business для бухгалтера (worksAsBookkeeper=true)', async () => {
            businessModel.create.mockResolvedValue({} as never);
            await service.create(userId.toString(), VALID_CREATE, true);

            const arg = businessModel.create.mock.calls[0]![0];
            expect(arg.ownerId).toBeNull();
            expect(arg.managers).toHaveLength(1);
            expect((arg.managers[0] as Types.ObjectId).toString()).toBe(
                userId.toString()
            );
        });

        it('маппить case-preserved slug і lowercase slugLower', async () => {
            slugGenerator.generateRandomSlug.mockResolvedValue('aB3xQ9k7');
            businessModel.create.mockResolvedValue({} as never);
            await service.create(userId.toString(), VALID_CREATE, false);

            const arg = businessModel.create.mock.calls[0]![0];
            expect(arg.slug).toBe('aB3xQ9k7');
            expect(arg.slugLower).toBe('ab3xq9k7');
        });

        it('обгортає race-collision (Mongo 11000) у SLUG_GENERATION_FAILED', async () => {
            const dupErr = Object.assign(new Error('E11000'), { code: 11000 });
            businessModel.create.mockRejectedValue(dupErr);
            await expect(
                service.create(userId.toString(), VALID_CREATE, false)
            ).rejects.toBeInstanceOf(InternalServerErrorException);
        });

        it('пропускає інші Mongo errors без обгортання', async () => {
            const otherErr = Object.assign(new Error('Mongo timeout'), {
                code: 99,
            });
            businessModel.create.mockRejectedValue(otherErr);
            await expect(
                service.create(userId.toString(), VALID_CREATE, false)
            ).rejects.toThrow('Mongo timeout');
        });
    });

    describe('getOwnedAndManaged', () => {
        const mockExec = (returnValue: unknown) => ({
            sort: jest.fn().mockReturnValue({
                exec: jest.fn().mockResolvedValue(returnValue),
            }),
        });

        it('bookkeeper OFF — фільтр { ownerId: userObjectId }', async () => {
            businessModel.find.mockReturnValue(mockExec([]));
            await service.getOwnedAndManaged(userId.toString(), false);

            const filter = businessModel.find.mock.calls[0]![0];
            expect(filter).toMatchObject({
                ownerId: expect.any(Types.ObjectId),
            });
            expect((filter.ownerId as Types.ObjectId).toString()).toBe(
                userId.toString()
            );
            // Не містить ownerId: null
            expect(filter.ownerId).not.toBeNull();
        });

        it('bookkeeper ON — фільтр { ownerId: null, managers: userObjectId }', async () => {
            businessModel.find.mockReturnValue(mockExec([]));
            await service.getOwnedAndManaged(userId.toString(), true);

            const filter = businessModel.find.mock.calls[0]![0];
            expect(filter.ownerId).toBeNull();
            expect((filter.managers as Types.ObjectId).toString()).toBe(
                userId.toString()
            );
        });

        it('сортує за createdAt desc', async () => {
            const sortSpy = jest.fn().mockReturnValue({
                exec: jest.fn().mockResolvedValue([]),
            });
            businessModel.find.mockReturnValue({ sort: sortSpy });
            await service.getOwnedAndManaged(userId.toString(), false);
            expect(sortSpy).toHaveBeenCalledWith({ createdAt: -1 });
        });
    });

    describe('getBySlug', () => {
        it('case-insensitive lookup по slugLower', async () => {
            const exec = jest.fn().mockResolvedValue(null);
            businessModel.findOne.mockReturnValue({ exec });
            await service.getBySlug('IvanEnko');
            expect(businessModel.findOne).toHaveBeenCalledWith({
                slugLower: 'ivanenko',
            });
        });

        it('повертає null якщо не знайдено (caller вирішує 404)', async () => {
            businessModel.findOne.mockReturnValue({
                exec: jest.fn().mockResolvedValue(null),
            });
            const result = await service.getBySlug('foo');
            expect(result).toBeNull();
        });
    });

    describe('update', () => {
        const mockUpdateReturn = (doc: Record<string, unknown> | null) => {
            businessModel.findOneAndUpdate.mockReturnValue({
                exec: jest.fn().mockResolvedValue(doc),
            });
        };
        const mockExistsReturn = (exists: boolean) => {
            businessModel.exists.mockResolvedValue(
                exists ? { _id: new Types.ObjectId() } : null
            );
        };

        it('без coupled-полів — filter без $expr, findOne не викликається', async () => {
            mockUpdateReturn({ name: 'New' });
            await service.update('IvanEnko', { name: 'New' });
            const filter = businessModel.findOneAndUpdate.mock.calls[0]![0];
            expect(filter).toEqual({ slugLower: 'ivanenko' });
            expect(filter.$expr).toBeUndefined();
            expect(businessModel.findOne).not.toHaveBeenCalled();
            expect(businessModel.exists).not.toHaveBeenCalled();
        });

        // $expr coupled-rule перевірки: точна форма aggregation expression.
        // Закон Де Моргана `NOT (vat=true AND tax∉allowed)` ≡
        // `vat≠true OR tax∈allowed`. Літерал з dto замінює field-reference;
        // полеж відсутнє → `'$<fieldname>'` (Mongo резолвить за документом).
        // Цей блок тестів спеціально перевіряє EQUAL-структуру, не toBeDefined,
        // щоб зловити syntactic regress (наприклад, повернення до `$not`-форми
        // з обʼєктним аргументом, що в aggregation runtime-помилка).

        it('$expr (isVatPayer=true only): vat-літерал, tax — field-ref', async () => {
            mockUpdateReturn({ isVatPayer: true });
            await service.update('IvanEnko', { isVatPayer: true });
            const filter = businessModel.findOneAndUpdate.mock.calls[0]![0];
            expect(filter.slugLower).toBe('ivanenko');
            expect(filter.$expr).toEqual({
                $or: [
                    { $ne: [true, true] },
                    {
                        $in: ['$taxationSystem', VAT_ALLOWED_TAXATION_SYSTEMS],
                    },
                ],
            });
        });

        it('$expr (isVatPayer=false only): vat-літерал false, tax — field-ref', async () => {
            mockUpdateReturn({ isVatPayer: false });
            await service.update('IvanEnko', { isVatPayer: false });
            const filter = businessModel.findOneAndUpdate.mock.calls[0]![0];
            expect(filter.$expr).toEqual({
                $or: [
                    { $ne: [false, true] },
                    {
                        $in: ['$taxationSystem', VAT_ALLOWED_TAXATION_SYSTEMS],
                    },
                ],
            });
        });

        it('$expr (taxationSystem only): tax-літерал, vat — field-ref', async () => {
            mockUpdateReturn({ taxationSystem: 'simplified-1' });
            await service.update('IvanEnko', {
                taxationSystem: 'simplified-1',
            });
            const filter = businessModel.findOneAndUpdate.mock.calls[0]![0];
            expect(filter.$expr).toEqual({
                $or: [
                    { $ne: ['$isVatPayer', true] },
                    {
                        $in: ['simplified-1', VAT_ALLOWED_TAXATION_SYSTEMS],
                    },
                ],
            });
        });

        it('$expr (both fields): обидва literals, без field-ref', async () => {
            mockUpdateReturn({
                isVatPayer: true,
                taxationSystem: 'simplified-3',
            });
            await service.update('IvanEnko', {
                isVatPayer: true,
                taxationSystem: 'simplified-3',
            } as UpdateBusinessRequest);
            const filter = businessModel.findOneAndUpdate.mock.calls[0]![0];
            expect(filter.$expr).toEqual({
                $or: [
                    { $ne: [true, true] },
                    {
                        $in: ['simplified-3', VAT_ALLOWED_TAXATION_SYSTEMS],
                    },
                ],
            });
        });

        it('coupled violation: findOneAndUpdate→null + exists→true → BadRequest', async () => {
            mockUpdateReturn(null);
            mockExistsReturn(true);
            await expect(
                service.update('IvanEnko', { isVatPayer: true })
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(businessModel.exists).toHaveBeenCalledWith({
                slugLower: 'ivanenko',
            });
        });

        it('coupled violation на taxation: findOneAndUpdate→null + exists→true → BadRequest', async () => {
            mockUpdateReturn(null);
            mockExistsReturn(true);
            await expect(
                service.update('IvanEnko', { taxationSystem: 'simplified-1' })
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('cross-field валідна пара — findOneAndUpdate повертає doc, exists() не викликається', async () => {
            mockUpdateReturn({
                taxationSystem: 'simplified-3',
                isVatPayer: true,
            });
            await expect(
                service.update('IvanEnko', {
                    taxationSystem: 'simplified-3',
                    isVatPayer: true,
                } as UpdateBusinessRequest)
            ).resolves.toBeDefined();
            expect(businessModel.exists).not.toHaveBeenCalled();
        });

        it('NotFound (no coupled fields): findOneAndUpdate→null → NotFound без exists()', async () => {
            mockUpdateReturn(null);
            await expect(
                service.update('IvanEnko', { name: 'X' })
            ).rejects.toBeInstanceOf(NotFoundException);
            expect(businessModel.exists).not.toHaveBeenCalled();
        });

        it('NotFound (coupled fields): findOneAndUpdate→null + exists→false → NotFound', async () => {
            mockUpdateReturn(null);
            mockExistsReturn(false);
            await expect(
                service.update('IvanEnko', { isVatPayer: true })
            ).rejects.toBeInstanceOf(NotFoundException);
        });

        it('lookup для update — case-insensitive по slugLower', async () => {
            mockUpdateReturn({ name: 'X' });
            await service.update('IvanEnko', { name: 'X' });
            const filter = businessModel.findOneAndUpdate.mock.calls[0]![0];
            expect(filter).toEqual({ slugLower: 'ivanenko' });
        });
    });

    describe('delete', () => {
        it('hard-delete по slugLower (case-insensitive)', async () => {
            businessModel.deleteOne.mockReturnValue({
                exec: jest.fn().mockResolvedValue({ deletedCount: 1 }),
            });
            await service.delete('IvanEnko');
            const filter = businessModel.deleteOne.mock.calls[0]![0];
            expect(filter).toEqual({ slugLower: 'ivanenko' });
        });

        it('кидає NotFound якщо нічого не видалено', async () => {
            businessModel.deleteOne.mockReturnValue({
                exec: jest.fn().mockResolvedValue({ deletedCount: 0 }),
            });
            await expect(service.delete('foo')).rejects.toBeInstanceOf(
                NotFoundException
            );
        });
    });
});
