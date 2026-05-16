import {
    BadRequestException,
    InternalServerErrorException,
    NotFoundException,
} from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import type { CreateInvoiceRequest, SlugInput } from '@finly/types';

import {
    Account,
    type AccountDocument,
} from '../accounts/schemas/account.schema';
import type { BusinessDocument } from '../businesses/schemas/business.schema';
import { InvoiceSlugGeneratorService } from './invoice-slug-generator.service';
import { InvoicesService } from './invoices.service';
import { Invoice } from './schemas/invoice.schema';

describe('InvoicesService (Sprint 9 §SP-6)', () => {
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
    let accountModel: jest.Mocked<{ updateOne: jest.Mock }>;
    let slugGenerator: jest.Mocked<{ generateInvoiceSlug: jest.Mock }>;
    let withTransactionMock: jest.Mock;
    let endSessionMock: jest.Mock;
    let startSessionMock: jest.Mock;

    const businessId = new Types.ObjectId();
    const accountId = new Types.ObjectId();
    const business = {
        _id: businessId,
        name: 'ФОП Іваненко',
        taxId: '1234567899',
        paymentPurposeTemplate: 'Default biz purpose',
    } as BusinessDocument;
    const account = {
        _id: accountId,
        businessId,
        iban: 'UA213223130000026007233566001',
    } as AccountDocument;

    const baseDto: CreateInvoiceRequest = {
        amount: 150000,
        amountLocked: true,
        paymentPurpose: 'Custom',
        validUntil: null,
        slugInput: { kind: 'preset', preset: 'simple' } as SlugInput,
    };

    const mockInsertSuccess = (doc: Record<string, unknown> = {}) => {
        invoiceModel.create.mockResolvedValue([doc]);
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
        accountModel = {
            updateOne: jest.fn().mockReturnValue({
                exec: jest.fn().mockResolvedValue({ matchedCount: 1 }),
            }),
        };
        slugGenerator = {
            generateInvoiceSlug: jest.fn().mockResolvedValue({
                slug: 'inv-001-aaaaaaaa',
                slugPreset: 'simple',
                slugCounterScope: 'simple',
                slugCounter: 1,
            }),
        };
        endSessionMock = jest.fn();
        withTransactionMock = jest.fn(async (cb: () => Promise<void>) => {
            await cb();
        });
        startSessionMock = jest.fn().mockImplementation(async () => ({
            withTransaction: withTransactionMock,
            endSession: endSessionMock,
        }));
        const connection = { startSession: startSessionMock };

        const moduleRef = await Test.createTestingModule({
            providers: [
                InvoicesService,
                {
                    provide: getModelToken(Invoice.name),
                    useValue: invoiceModel,
                },
                {
                    provide: getModelToken(Account.name),
                    useValue: accountModel,
                },
                {
                    provide: getConnectionToken(),
                    useValue: connection,
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
        it('передає business.paymentPurposeTemplate + accountId у generator', async () => {
            mockInsertSuccess();
            await service.create(business, account, {
                ...baseDto,
                paymentPurpose: null,
            });
            expect(slugGenerator.generateInvoiceSlug).toHaveBeenCalledWith(
                {
                    businessId,
                    accountId,
                    slugInput: baseDto.slugInput,
                    paymentPurpose: null,
                    businessPaymentPurposeTemplate: 'Default biz purpose',
                },
                expect.anything()
            );
        });

        it('persistить generator-output + accountId+businessId у документ', async () => {
            mockInsertSuccess();
            await service.create(business, account, baseDto);
            const [docs, options] = invoiceModel.create.mock.calls[0]!;
            expect(docs[0]).toMatchObject({
                businessId,
                accountId,
                slug: 'inv-001-aaaaaaaa',
                slugPreset: 'simple',
                slugCounterScope: 'simple',
                slugCounter: 1,
                amount: 150000,
                amountLocked: true,
            });
            expect(options.session).toBeDefined();
        });

        it('Sprint 9 §SP-3 — touch ACCOUNT (not business) у транзакції', async () => {
            mockInsertSuccess();
            await service.create(business, account, baseDto);
            expect(accountModel.updateOne).toHaveBeenCalledWith(
                { _id: accountId },
                { $currentDate: { updatedAt: true } },
                expect.objectContaining({ session: expect.anything() })
            );
            expect(startSessionMock).toHaveBeenCalledTimes(1);
            expect(withTransactionMock).toHaveBeenCalledTimes(1);
            expect(endSessionMock).toHaveBeenCalledTimes(1);
        });

        it('account зник між guard і create → 404 ACCOUNT_NOT_FOUND, insert не викликається', async () => {
            accountModel.updateOne.mockReturnValue({
                exec: jest.fn().mockResolvedValue({ matchedCount: 0 }),
            });
            await expect(
                service.create(business, account, baseDto)
            ).rejects.toBeInstanceOf(NotFoundException);
            expect(invoiceModel.create).not.toHaveBeenCalled();
            expect(startSessionMock).toHaveBeenCalledTimes(1);
        });

        it('retry on 11000 — fresh session/transaction per attempt', async () => {
            const dupErr = Object.assign(new Error('E11000'), { code: 11000 });
            invoiceModel.create
                .mockRejectedValueOnce(dupErr)
                .mockRejectedValueOnce(dupErr)
                .mockResolvedValueOnce([{}] as never);

            await service.create(business, account, baseDto);
            expect(invoiceModel.create).toHaveBeenCalledTimes(3);
            expect(slugGenerator.generateInvoiceSlug).toHaveBeenCalledTimes(3);
            expect(startSessionMock).toHaveBeenCalledTimes(3);
            expect(withTransactionMock).toHaveBeenCalledTimes(3);
            expect(endSessionMock).toHaveBeenCalledTimes(3);
        });

        it('після 3 retry-collisions → INVOICE_SLUG_GENERATION_FAILED, 3 fresh sessions', async () => {
            const dupErr = Object.assign(new Error('E11000'), { code: 11000 });
            invoiceModel.create.mockRejectedValue(dupErr);

            await expect(
                service.create(business, account, baseDto)
            ).rejects.toBeInstanceOf(InternalServerErrorException);
            expect(invoiceModel.create).toHaveBeenCalledTimes(3);
            expect(startSessionMock).toHaveBeenCalledTimes(3);
        });

        it('non-duplicate Mongo error pass-through без retry-ю (1 session)', async () => {
            const otherErr = Object.assign(new Error('Mongo timeout'), {
                code: 99,
            });
            invoiceModel.create.mockRejectedValueOnce(otherErr);
            await expect(
                service.create(business, account, baseDto)
            ).rejects.toThrow('Mongo timeout');
            expect(invoiceModel.create).toHaveBeenCalledTimes(1);
            expect(startSessionMock).toHaveBeenCalledTimes(1);
            expect(endSessionMock).toHaveBeenCalledTimes(1);
        });

        it('replica-set unsupported error → 500 TRANSACTION_REQUIRES_REPLICA_SET', async () => {
            withTransactionMock.mockRejectedValueOnce(
                new Error(
                    'Transaction numbers are only allowed on a replica set member or mongos'
                )
            );
            await expect(
                service.create(business, account, baseDto)
            ).rejects.toBeInstanceOf(InternalServerErrorException);
            expect(endSessionMock).toHaveBeenCalled();
        });

        it('validUntil у минулому → 400 INVOICE_VALID_UNTIL_IN_PAST, transaction не стартує', async () => {
            const past = new Date(Date.now() - 60_000);
            await expect(
                service.create(business, account, {
                    ...baseDto,
                    validUntil: past,
                })
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(withTransactionMock).not.toHaveBeenCalled();
            expect(invoiceModel.create).not.toHaveBeenCalled();
        });

        it('validUntil=null → дозволяється (без терміну дії)', async () => {
            mockInsertSuccess();
            await expect(
                service.create(business, account, {
                    ...baseDto,
                    validUntil: null,
                })
            ).resolves.toBeDefined();
        });

        it('Sprint 9 §SP-6 — payeeSnapshot.iban з account.iban (не business)', async () => {
            mockInsertSuccess();
            await service.create(business, account, baseDto);
            const [docs] = invoiceModel.create.mock.calls[0]!;
            expect(docs[0].payeeSnapshot).toMatchObject({
                iban: account.iban,
                recipientName: business.name,
                taxId: business.taxId,
            });
        });
    });

    describe('getByAccountId (paginated list)', () => {
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

        it('сортує createdAt desc з _id tie-break + skip/limit', async () => {
            const chain = mockChain([], 0);
            await service.getByAccountId(accountId, { page: 2, limit: 10 });
            expect(chain.sort).toHaveBeenCalledWith({
                createdAt: -1,
                _id: -1,
            });
            expect(chain.skip).toHaveBeenCalledWith(10);
            expect(chain.limit).toHaveBeenCalledWith(10);
        });

        it('повертає { items, total, page, limit }', async () => {
            mockChain([{ slug: 'a' }, { slug: 'b' }], 42);
            const result = await service.getByAccountId(accountId, {
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

    describe('getBySlug', () => {
        it('Sprint 9 §SP-6 — compound `(accountId, slug)` case-sensitive', async () => {
            const exec = jest.fn().mockResolvedValue(null);
            invoiceModel.findOne.mockReturnValue({ exec });
            await service.getBySlug(accountId, 'INV-001-XYZ');
            expect(invoiceModel.findOne).toHaveBeenCalledWith({
                accountId,
                slug: 'INV-001-XYZ',
            });
        });
    });

    describe('update', () => {
        const mockUpdateReturn = (doc: Record<string, unknown> | null) => {
            invoiceModel.findOneAndUpdate.mockReturnValue({
                exec: jest.fn().mockResolvedValue(doc),
            });
        };

        it('без coupled-полів — filter без $expr (lookup `accountId, slug`)', async () => {
            mockUpdateReturn({ paymentPurpose: 'New' });
            await service.update(business, account, 'inv-001-x', {
                paymentPurpose: 'New',
            });
            const filter = invoiceModel.findOneAndUpdate.mock.calls[0]![0];
            expect(filter).toEqual({ accountId, slug: 'inv-001-x' });
            expect(filter.$expr).toBeUndefined();
            expect(invoiceModel.exists).not.toHaveBeenCalled();
        });

        it('coupled (тільки amountLocked): vat-літерал, amount — field-ref', async () => {
            mockUpdateReturn({});
            await service.update(business, account, 'inv-001-x', {
                amountLocked: true,
            });
            const filter = invoiceModel.findOneAndUpdate.mock.calls[0]![0];
            expect(filter.$expr).toEqual({
                $or: [{ $ne: ['$amount', null] }, { $ne: [true, true] }],
            });
        });

        it('coupled (тільки amount=null): amount-літерал, locked — field-ref', async () => {
            mockUpdateReturn({});
            await service.update(business, account, 'inv-001-x', {
                amount: null,
            });
            const filter = invoiceModel.findOneAndUpdate.mock.calls[0]![0];
            expect(filter.$expr).toEqual({
                $or: [{ $ne: [null, null] }, { $ne: ['$amountLocked', true] }],
            });
        });

        it('coupled violation: filter→null + exists→true → BadRequest', async () => {
            mockUpdateReturn(null);
            invoiceModel.exists.mockResolvedValue({
                _id: new Types.ObjectId(),
            });
            await expect(
                service.update(business, account, 'inv-001-x', {
                    amountLocked: true,
                })
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('NotFound (no coupled fields): findOneAndUpdate→null → 404', async () => {
            mockUpdateReturn(null);
            await expect(
                service.update(business, account, 'gone', {
                    paymentPurpose: 'X',
                })
            ).rejects.toBeInstanceOf(NotFoundException);
            expect(invoiceModel.exists).not.toHaveBeenCalled();
        });

        it('NotFound (coupled fields): filter→null + exists→false → 404', async () => {
            mockUpdateReturn(null);
            invoiceModel.exists.mockResolvedValue(null);
            await expect(
                service.update(business, account, 'gone', {
                    amountLocked: true,
                })
            ).rejects.toBeInstanceOf(NotFoundException);
        });

        it('validUntil у минулому на PATCH → 400 INVOICE_VALID_UNTIL_IN_PAST', async () => {
            const past = new Date(Date.now() - 60_000);
            await expect(
                service.update(business, account, 'inv-001', {
                    validUntil: past,
                })
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(invoiceModel.findOneAndUpdate).not.toHaveBeenCalled();
        });

        describe('payeeSnapshot.paymentPurpose mirror', () => {
            it('PATCH paymentPurpose → resolved + dual update top-level + snapshot via $cond pipeline', async () => {
                mockUpdateReturn({ paymentPurpose: 'Updated' });
                await service.update(business, account, 'inv-001-x', {
                    paymentPurpose: 'Updated',
                });
                const updateArg =
                    invoiceModel.findOneAndUpdate.mock.calls[0]![1];
                expect(Array.isArray(updateArg)).toBe(true);
                const setStage = (
                    updateArg as Array<{ $set: Record<string, unknown> }>
                )[0].$set;
                expect(setStage.paymentPurpose).toBe('Updated');
                expect(setStage.payeeSnapshot).toEqual({
                    $cond: [
                        { $eq: ['$payeeSnapshot', null] },
                        '$payeeSnapshot',
                        {
                            $mergeObjects: [
                                '$payeeSnapshot',
                                { paymentPurpose: 'Updated' },
                            ],
                        },
                    ],
                });
            });

            it('PATCH paymentPurpose=null → resolve через business.template + mirror', async () => {
                mockUpdateReturn({ paymentPurpose: null });
                await service.update(business, account, 'inv-001-x', {
                    paymentPurpose: null,
                });
                const updateArg =
                    invoiceModel.findOneAndUpdate.mock.calls[0]![1];
                const setStage = (
                    updateArg as Array<{ $set: Record<string, unknown> }>
                )[0].$set;
                expect(setStage.paymentPurpose).toBeNull();
                expect(setStage.payeeSnapshot).toEqual({
                    $cond: [
                        { $eq: ['$payeeSnapshot', null] },
                        '$payeeSnapshot',
                        {
                            $mergeObjects: [
                                '$payeeSnapshot',
                                {
                                    paymentPurpose: 'Default biz purpose',
                                },
                            ],
                        },
                    ],
                });
            });

            it('PATCH без paymentPurpose → не торкає snapshot', async () => {
                mockUpdateReturn({ amount: 200000 });
                await service.update(business, account, 'inv-001-x', {
                    amount: 200000,
                });
                const updateArg =
                    invoiceModel.findOneAndUpdate.mock.calls[0]![1];
                const setStage = (
                    updateArg as Array<{ $set: Record<string, unknown> }>
                )[0].$set;
                expect(setStage.amount).toBe(200000);
                expect(setStage).not.toHaveProperty('payeeSnapshot');
                expect(setStage).not.toHaveProperty('paymentPurpose');
            });
        });
    });

    describe('delete', () => {
        it('Sprint 9 §SP-6 — hard-delete по compound (accountId, slug)', async () => {
            invoiceModel.deleteOne.mockReturnValue({
                exec: jest.fn().mockResolvedValue({ deletedCount: 1 }),
            });
            await service.delete(accountId, 'inv-001-x');
            expect(invoiceModel.deleteOne).toHaveBeenCalledWith({
                accountId,
                slug: 'inv-001-x',
            });
        });

        it('кидає NotFound якщо нічого не видалено', async () => {
            invoiceModel.deleteOne.mockReturnValue({
                exec: jest.fn().mockResolvedValue({ deletedCount: 0 }),
            });
            await expect(
                service.delete(accountId, 'gone')
            ).rejects.toBeInstanceOf(NotFoundException);
        });
    });
});
