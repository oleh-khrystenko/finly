import {
    BadRequestException,
    InternalServerErrorException,
    NotFoundException,
} from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import type { CreateInvoiceRequest, SlugInput } from '@finly/types';

import type { BusinessDocument } from '../businesses/schemas/business.schema';
import { InvoiceSlugGeneratorService } from './invoice-slug-generator.service';
import { InvoicesService } from './invoices.service';
import { Invoice } from './schemas/invoice.schema';

describe('InvoicesService (Sprint 4 §4.2)', () => {
    let service: InvoicesService;
    let invoiceModel: jest.Mocked<{
        create: jest.Mock;
        find: jest.Mock;
        findOne: jest.Mock;
        findOneAndUpdate: jest.Mock;
        countDocuments: jest.Mock;
        deleteOne: jest.Mock;
        exists: jest.Mock;
    }>;
    let slugGenerator: jest.Mocked<{ generateInvoiceSlug: jest.Mock }>;

    const businessId = new Types.ObjectId();
    const business = {
        _id: businessId,
        paymentPurposeTemplate: 'Default biz purpose',
    } as BusinessDocument;

    const baseDto: CreateInvoiceRequest = {
        amount: 150000,
        amountLocked: true,
        paymentPurpose: 'Custom',
        validUntil: null,
        slugInput: { kind: 'preset', preset: 'simple' } as SlugInput,
    };

    beforeEach(async () => {
        invoiceModel = {
            create: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            findOneAndUpdate: jest.fn(),
            countDocuments: jest.fn(),
            deleteOne: jest.fn(),
            exists: jest.fn(),
        };
        slugGenerator = {
            generateInvoiceSlug: jest.fn().mockResolvedValue({
                slug: 'inv-001-aaaaaaaa',
                slugPreset: 'simple',
                slugCounterScope: 'simple',
                slugCounter: 1,
            }),
        };

        const moduleRef = await Test.createTestingModule({
            providers: [
                InvoicesService,
                {
                    provide: getModelToken(Invoice.name),
                    useValue: invoiceModel,
                },
                {
                    provide: InvoiceSlugGeneratorService,
                    useValue: slugGenerator,
                },
            ],
        }).compile();
        service = moduleRef.get(InvoicesService);
    });

    describe('create', () => {
        it('передає business.paymentPurposeTemplate у generator (для inheritance)', async () => {
            invoiceModel.create.mockResolvedValue({});
            await service.create(business, {
                ...baseDto,
                paymentPurpose: null,
            });
            expect(slugGenerator.generateInvoiceSlug).toHaveBeenCalledWith({
                businessId,
                slugInput: baseDto.slugInput,
                paymentPurpose: null,
                businessPaymentPurposeTemplate: 'Default biz purpose',
            });
        });

        it('persistить generator-output у документ (slug, slugPreset, slugCounterScope, slugCounter)', async () => {
            invoiceModel.create.mockResolvedValue({});
            await service.create(business, baseDto);
            const arg = invoiceModel.create.mock.calls[0]![0];
            expect(arg).toMatchObject({
                businessId,
                slug: 'inv-001-aaaaaaaa',
                slugPreset: 'simple',
                slugCounterScope: 'simple',
                slugCounter: 1,
                amount: 150000,
                amountLocked: true,
            });
        });

        it('retry on 11000 (race-collision) — до 3 спроб', async () => {
            // Race: перші 2 attempts колізують, третя проходить.
            const dupErr = Object.assign(new Error('E11000'), { code: 11000 });
            invoiceModel.create
                .mockRejectedValueOnce(dupErr)
                .mockRejectedValueOnce(dupErr)
                .mockResolvedValueOnce({} as never);

            await service.create(business, baseDto);
            expect(invoiceModel.create).toHaveBeenCalledTimes(3);
            expect(slugGenerator.generateInvoiceSlug).toHaveBeenCalledTimes(3);
        });

        it('після 3 retry-collisions → INVOICE_SLUG_GENERATION_FAILED', async () => {
            const dupErr = Object.assign(new Error('E11000'), { code: 11000 });
            invoiceModel.create.mockRejectedValue(dupErr);

            await expect(
                service.create(business, baseDto)
            ).rejects.toBeInstanceOf(InternalServerErrorException);
            expect(invoiceModel.create).toHaveBeenCalledTimes(3);
        });

        it('non-duplicate Mongo error pass-through без обгортання', async () => {
            const otherErr = Object.assign(new Error('Mongo timeout'), {
                code: 99,
            });
            invoiceModel.create.mockRejectedValueOnce(otherErr);
            await expect(service.create(business, baseDto)).rejects.toThrow(
                'Mongo timeout'
            );
            // Не retry-ить non-duplicate errors
            expect(invoiceModel.create).toHaveBeenCalledTimes(1);
        });
    });

    describe('getByBusinessId (paginated list)', () => {
        const mockChain = (items: unknown[], total: number) => {
            const chain = {
                sort: jest.fn().mockReturnThis(),
                skip: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue(items),
            };
            invoiceModel.find.mockReturnValue(chain);
            invoiceModel.countDocuments.mockResolvedValue(total);
            return chain;
        };

        it('сортує createdAt desc + skip/limit', async () => {
            const chain = mockChain([], 0);
            await service.getByBusinessId(businessId, { page: 2, limit: 10 });
            expect(chain.sort).toHaveBeenCalledWith({ createdAt: -1 });
            expect(chain.skip).toHaveBeenCalledWith(10); // (page-1)*limit
            expect(chain.limit).toHaveBeenCalledWith(10);
        });

        it('повертає { items, total, page, limit }', async () => {
            mockChain([{ slug: 'a' }, { slug: 'b' }], 42);
            const result = await service.getByBusinessId(businessId, {
                page: 1,
                limit: 10,
            });
            expect(result).toEqual({
                items: [{ slug: 'a' }, { slug: 'b' }],
                total: 42,
                page: 1,
                limit: 10,
            });
        });
    });

    describe('countByBusinessId', () => {
        it('повертає countDocuments({businessId})', async () => {
            invoiceModel.countDocuments.mockResolvedValue(7);
            const r = await service.countByBusinessId(businessId);
            expect(r).toBe(7);
            expect(invoiceModel.countDocuments).toHaveBeenCalledWith({
                businessId,
            });
        });
    });

    describe('getBySlug', () => {
        it('compound-keyed lookup — case-sensitive (SP-8)', async () => {
            const exec = jest.fn().mockResolvedValue(null);
            invoiceModel.findOne.mockReturnValue({ exec });
            await service.getBySlug(businessId, 'INV-001-XYZ');
            expect(invoiceModel.findOne).toHaveBeenCalledWith({
                businessId,
                slug: 'INV-001-XYZ', // ← без to-lower
            });
        });
    });

    describe('update', () => {
        const mockUpdateReturn = (doc: Record<string, unknown> | null) => {
            invoiceModel.findOneAndUpdate.mockReturnValue({
                exec: jest.fn().mockResolvedValue(doc),
            });
        };

        it('без coupled-полів — filter без $expr, exists() не викликається', async () => {
            mockUpdateReturn({ paymentPurpose: 'New' });
            await service.update(businessId, 'inv-001-x', {
                paymentPurpose: 'New',
            });
            const filter = invoiceModel.findOneAndUpdate.mock.calls[0]![0];
            expect(filter).toEqual({ businessId, slug: 'inv-001-x' });
            expect(filter.$expr).toBeUndefined();
            expect(invoiceModel.exists).not.toHaveBeenCalled();
        });

        it('coupled (тільки amountLocked): vat-літерал, amount — field-ref', async () => {
            mockUpdateReturn({});
            await service.update(businessId, 'inv-001-x', {
                amountLocked: true,
            });
            const filter = invoiceModel.findOneAndUpdate.mock.calls[0]![0];
            expect(filter.$expr).toEqual({
                $or: [{ $ne: ['$amount', null] }, { $ne: [true, true] }],
            });
        });

        it('coupled (тільки amount=null): amount-літерал, locked — field-ref', async () => {
            mockUpdateReturn({});
            await service.update(businessId, 'inv-001-x', { amount: null });
            const filter = invoiceModel.findOneAndUpdate.mock.calls[0]![0];
            expect(filter.$expr).toEqual({
                $or: [{ $ne: [null, null] }, { $ne: ['$amountLocked', true] }],
            });
        });

        it('coupled violation: filter→null + exists→true → BadRequest INVOICE_AMOUNT_LOCKED_REQUIRES_AMOUNT', async () => {
            mockUpdateReturn(null);
            invoiceModel.exists.mockResolvedValue({
                _id: new Types.ObjectId(),
            });
            await expect(
                service.update(businessId, 'inv-001-x', { amountLocked: true })
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('NotFound (no coupled fields): findOneAndUpdate→null → 404 без exists()', async () => {
            mockUpdateReturn(null);
            await expect(
                service.update(businessId, 'gone', { paymentPurpose: 'X' })
            ).rejects.toBeInstanceOf(NotFoundException);
            expect(invoiceModel.exists).not.toHaveBeenCalled();
        });

        it('NotFound (coupled fields): filter→null + exists→false → 404', async () => {
            mockUpdateReturn(null);
            invoiceModel.exists.mockResolvedValue(null);
            await expect(
                service.update(businessId, 'gone', { amountLocked: true })
            ).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe('delete', () => {
        it('hard-delete по compound (businessId, slug)', async () => {
            invoiceModel.deleteOne.mockReturnValue({
                exec: jest.fn().mockResolvedValue({ deletedCount: 1 }),
            });
            await service.delete(businessId, 'inv-001-x');
            expect(invoiceModel.deleteOne).toHaveBeenCalledWith({
                businessId,
                slug: 'inv-001-x',
            });
        });

        it('кидає NotFound якщо нічого не видалено', async () => {
            invoiceModel.deleteOne.mockReturnValue({
                exec: jest.fn().mockResolvedValue({ deletedCount: 0 }),
            });
            await expect(
                service.delete(businessId, 'gone')
            ).rejects.toBeInstanceOf(NotFoundException);
        });
    });
});
