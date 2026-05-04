import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
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

import { Invoice } from '../invoices/schemas/invoice.schema';
import { BusinessesService } from './businesses.service';
import type { BusinessDocument } from './schemas/business.schema';
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
    let invoiceModel: jest.Mocked<{
        countDocuments: jest.Mock;
        deleteMany: jest.Mock;
    }>;
    let session: jest.Mocked<{
        withTransaction: jest.Mock;
        endSession: jest.Mock;
    }>;
    let connection: jest.Mocked<{ startSession: jest.Mock }>;
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
        invoiceModel = {
            countDocuments: jest.fn().mockResolvedValue(0),
            deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
        };
        // Default session: `withTransaction(cb)` запускає cb напряму (success),
        // повертає cb's resolved value. Тести cascade-delete можуть переоприділити
        // session.withTransaction для simulate failure / replica-set absence.
        session = {
            withTransaction: jest.fn(async (cb: () => Promise<unknown>) => {
                return cb();
            }),
            endSession: jest.fn().mockResolvedValue(undefined),
        };
        connection = {
            startSession: jest.fn().mockResolvedValue(session),
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
                {
                    provide: getModelToken(Invoice.name),
                    useValue: invoiceModel,
                },
                {
                    provide: getConnectionToken(),
                    useValue: connection,
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

    describe('delete (cascade — Sprint 4 §SP-5)', () => {
        const businessId = new Types.ObjectId();
        const businessFixture = {
            _id: businessId,
            slug: 'IvanEnko',
            slugLower: 'ivanenko',
        } as unknown as BusinessDocument;

        const mockDeleteOne = (deletedCount: number) => {
            businessModel.deleteOne.mockReturnValue({
                exec: jest.fn().mockResolvedValue({ deletedCount }),
            });
        };

        it('повертає affectedInvoices (counter перед transaction)', async () => {
            invoiceModel.countDocuments.mockResolvedValue(3);
            mockDeleteOne(1);

            const result = await service.delete(businessFixture);
            expect(result).toEqual({ affectedInvoices: 3 });
            expect(invoiceModel.countDocuments).toHaveBeenCalledWith({
                businessId,
            });
        });

        it('викликає withTransaction із deleteMany invoices + deleteOne business', async () => {
            invoiceModel.countDocuments.mockResolvedValue(0);
            mockDeleteOne(1);

            await service.delete(businessFixture);

            expect(connection.startSession).toHaveBeenCalledTimes(1);
            expect(session.withTransaction).toHaveBeenCalledTimes(1);
            // Виклики всередині cb — invoices.deleteMany + business.deleteOne
            // (порядок свідомо не валідуємо — atomic-or-nothing інваріант
            // однаково гарантований Mongo transaction-ом).
            expect(invoiceModel.deleteMany).toHaveBeenCalledWith(
                { businessId },
                { session }
            );
            expect(businessModel.deleteOne).toHaveBeenCalledWith(
                { _id: businessId },
                { session }
            );
            expect(session.endSession).toHaveBeenCalledTimes(1);
        });

        it('idempotent: business вже зник між guard і delete (deletedCount=0) — не throw', async () => {
            invoiceModel.countDocuments.mockResolvedValue(0);
            mockDeleteOne(0); // race з паралельним delete-ом

            await expect(service.delete(businessFixture)).resolves.toEqual({
                affectedInvoices: 0,
            });
            expect(session.endSession).toHaveBeenCalledTimes(1);
        });

        it('replica-set absence: ловить "Transaction... replica set" → CASCADE_DELETE_REQUIRES_REPLICA_SET', async () => {
            invoiceModel.countDocuments.mockResolvedValue(0);
            const replSetErr = new Error(
                'Transaction numbers are only allowed on a replica set member or mongos'
            );
            session.withTransaction.mockRejectedValue(replSetErr);

            await expect(
                service.delete(businessFixture)
            ).rejects.toBeInstanceOf(InternalServerErrorException);
            // session.endSession завжди викликається у finally
            expect(session.endSession).toHaveBeenCalledTimes(1);
        });

        it('non-transactional error pass-through без обгортання', async () => {
            invoiceModel.countDocuments.mockResolvedValue(0);
            const dbErr = new Error('Mongo timeout');
            session.withTransaction.mockRejectedValue(dbErr);

            await expect(service.delete(businessFixture)).rejects.toThrow(
                'Mongo timeout'
            );
        });

        it('endSession завжди викликається (finally), навіть на throw', async () => {
            invoiceModel.countDocuments.mockResolvedValue(0);
            session.withTransaction.mockRejectedValue(new Error('any error'));

            await expect(service.delete(businessFixture)).rejects.toThrow();
            expect(session.endSession).toHaveBeenCalledTimes(1);
        });
    });
});
