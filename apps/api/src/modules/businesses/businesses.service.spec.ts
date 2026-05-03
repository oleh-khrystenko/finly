import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
    BadRequestException,
    InternalServerErrorException,
    NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type { CreateBusinessRequest, UpdateBusinessRequest } from '@finly/types';

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
            deleteOne: jest.fn(),
        };
        slugGenerator = {
            generateRandomSlug: jest.fn().mockResolvedValue('IvanEnko'),
        };

        const module = await Test.createTestingModule({
            providers: [
                BusinessesService,
                { provide: getModelToken(Business.name), useValue: businessModel },
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
            expect(filter).toMatchObject({ ownerId: expect.any(Types.ObjectId) });
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
        const setupExisting = (existing: Record<string, unknown>) => {
            businessModel.findOne.mockReturnValue({
                exec: jest.fn().mockResolvedValue(existing),
            });
            businessModel.findOneAndUpdate.mockReturnValue({
                exec: jest.fn().mockResolvedValue({ ...existing, ...{} }),
            });
        };

        it('пропускає coupled-check якщо ні taxationSystem ні isVatPayer не змінюються', async () => {
            businessModel.findOneAndUpdate.mockReturnValue({
                exec: jest.fn().mockResolvedValue({ name: 'New' }),
            });
            await service.update('IvanEnko', { name: 'New' });
            expect(businessModel.findOne).not.toHaveBeenCalled();
        });

        it('coupled cross-field check: isVatPayer=true з existing simplified-1 → BadRequest', async () => {
            setupExisting({
                taxationSystem: 'simplified-1',
                isVatPayer: false,
            });
            await expect(
                service.update('IvanEnko', { isVatPayer: true })
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('coupled cross-field check: taxationSystem=simplified-1 з existing isVatPayer=true → BadRequest', async () => {
            setupExisting({
                taxationSystem: 'simplified-3',
                isVatPayer: true,
            });
            await expect(
                service.update('IvanEnko', { taxationSystem: 'simplified-1' })
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('cross-field валідна пара: simplified-3 + isVatPayer=true → success', async () => {
            setupExisting({
                taxationSystem: 'simplified-2',
                isVatPayer: false,
            });
            await expect(
                service.update('IvanEnko', {
                    taxationSystem: 'simplified-3',
                    isVatPayer: true,
                } as UpdateBusinessRequest)
            ).resolves.toBeDefined();
        });

        it('кидає NotFound якщо документ зник між guard і update (paranoid)', async () => {
            businessModel.findOneAndUpdate.mockReturnValue({
                exec: jest.fn().mockResolvedValue(null),
            });
            await expect(
                service.update('IvanEnko', { name: 'X' })
            ).rejects.toBeInstanceOf(NotFoundException);
        });

        it('lookup для update — case-insensitive по slugLower', async () => {
            businessModel.findOneAndUpdate.mockReturnValue({
                exec: jest.fn().mockResolvedValue({ name: 'X' }),
            });
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
