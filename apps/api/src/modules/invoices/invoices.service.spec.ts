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
    Business,
    type BusinessDocument,
} from '../businesses/schemas/business.schema';
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
    let businessModel: jest.Mocked<{ updateOne: jest.Mock }>;
    let slugGenerator: jest.Mocked<{ generateInvoiceSlug: jest.Mock }>;
    let withTransactionMock: jest.Mock;
    let endSessionMock: jest.Mock;
    let startSessionMock: jest.Mock;

    const businessId = new Types.ObjectId();
    const business = {
        _id: businessId,
        name: 'ФОП Іваненко',
        // Sprint 4 review fix — `payeeSnapshot` snapshots ці поля у
        // service.create. Без них create-call падає на undefined access.
        requisites: {
            iban: 'UA213223130000026007233566001',
            taxId: '1234567899',
        },
        paymentPurposeTemplate: 'Default biz purpose',
    } as BusinessDocument;

    const baseDto: CreateInvoiceRequest = {
        amount: 150000,
        amountLocked: true,
        paymentPurpose: 'Custom',
        validUntil: null,
        slugInput: { kind: 'preset', preset: 'simple' } as SlugInput,
    };

    /** Invoice model `create([...], { session })` повертає масив документів. */
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
        // Sprint 4 review fix — `InvoicesService.create` тепер touch-ить
        // business у транзакції. Default mock — matchedCount=1 (бізнес ще
        // існує). Tests на cascade-race-у переоприділяють.
        businessModel = {
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
        // Realistic-ish session mock (Sprint 4 review fix).
        //
        // **Контракт `withTransaction(cb)` на реальному Mongo:**
        //  - cb() запускається; при error без `TransientTransactionError`-label —
        //    транзакція abort-иться сервером і error re-throws-ить до caller.
        //  - DuplicateKeyError (11000) НЕ має transient-label → propagate
        //    до caller. **Раніший mock пропускав writes після 11000** і
        //    тому НЕ ловив реальну поведінку (попередній review fixed exactly
        //    цей gap).
        //
        // Поточний mock дотримується real Mongo semantics: on first error
        // у callback — re-throw з withTransaction. Outer-retry-loop у
        // `InvoicesService.create` бачить цей error і відкриває **нову
        // session** для нової спроби. `startSessionMock` повертає fresh
        // mock-session кожного виклику.
        endSessionMock = jest.fn();
        withTransactionMock = jest.fn(async (cb: () => Promise<void>) => {
            await cb(); // throw з cb propagate назовні — match real Mongo
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
                    provide: getModelToken(Business.name),
                    useValue: businessModel,
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
        it('передає business.paymentPurposeTemplate у generator (для inheritance)', async () => {
            mockInsertSuccess();
            await service.create(business, {
                ...baseDto,
                paymentPurpose: null,
            });
            expect(slugGenerator.generateInvoiceSlug).toHaveBeenCalledWith(
                {
                    businessId,
                    slugInput: baseDto.slugInput,
                    paymentPurpose: null,
                    businessPaymentPurposeTemplate: 'Default biz purpose',
                },
                // Sprint 4 review fix — generator-API тепер 2-arg (input,
                // session). У unit-spec session — mock-object без identity-
                // вимог; перевіряємо лише, що передається не-null/undefined.
                expect.anything(),
            );
        });

        it('persistить generator-output у документ (slug, slugPreset, slugCounterScope, slugCounter)', async () => {
            mockInsertSuccess();
            await service.create(business, baseDto);
            // create викликається з array-формою + { session } — Mongoose-API
            // для transactional inserts (Sprint 4 review fix).
            const [docs, options] = invoiceModel.create.mock.calls[0]!;
            expect(docs[0]).toMatchObject({
                businessId,
                slug: 'inv-001-aaaaaaaa',
                slugPreset: 'simple',
                slugCounterScope: 'simple',
                slugCounter: 1,
                amount: 150000,
                amountLocked: true,
            });
            expect(options.session).toBeDefined();
        });

        it('orphan-prevention: touch business у транзакції (review fix)', async () => {
            // Doc-touch via $currentDate updatedAt — створює write-intent на
            // бізнес-документ, що serialize-ить concurrent cascade-delete.
            mockInsertSuccess();
            await service.create(business, baseDto);
            expect(businessModel.updateOne).toHaveBeenCalledWith(
                { _id: businessId },
                { $currentDate: { updatedAt: true } },
                expect.objectContaining({ session: expect.anything() })
            );
            expect(startSessionMock).toHaveBeenCalledTimes(1);
            expect(withTransactionMock).toHaveBeenCalledTimes(1);
            expect(endSessionMock).toHaveBeenCalledTimes(1);
        });

        it('cascade-delete виграв race: business зник → 404 BUSINESS_NOT_FOUND, insert не викликається', async () => {
            // matchedCount=0 ⇔ business зник між guard-read і create-touch
            // (concurrent cascade-delete виграла гонку). Service кидає
            // доменну 404 — без orphan insert-у. Outer-loop НЕ retry-ить
            // NotFoundException (тільки 11000), тож session-machinery
            // викликається рівно 1 раз.
            businessModel.updateOne.mockReturnValue({
                exec: jest.fn().mockResolvedValue({ matchedCount: 0 }),
            });
            await expect(
                service.create(business, baseDto)
            ).rejects.toBeInstanceOf(NotFoundException);
            expect(invoiceModel.create).not.toHaveBeenCalled();
            expect(startSessionMock).toHaveBeenCalledTimes(1);
        });

        it('retry on 11000 — fresh session/transaction per attempt (review re-fix)', async () => {
            // Sprint 4 second-review fix: на DuplicateKeyError (11000) у
            // Mongo транзакція abort-иться server-side; повторний write у
            // тій самій сесії впав би з `TransactionAborted`, не з 11000.
            // Тому retry виноситься у outer-loop: на 11000 withTransaction
            // re-throws, ловимо у `create()` і відкриваємо НОВУ session.
            // Slug-generator на retry читає commited counter-state і
            // генерує N+1.
            const dupErr = Object.assign(new Error('E11000'), { code: 11000 });
            invoiceModel.create
                .mockRejectedValueOnce(dupErr) // attempt 1 — abort, throw
                .mockRejectedValueOnce(dupErr) // attempt 2 — abort, throw
                .mockResolvedValueOnce([{}] as never); // attempt 3 — success

            await service.create(business, baseDto);
            expect(invoiceModel.create).toHaveBeenCalledTimes(3);
            expect(slugGenerator.generateInvoiceSlug).toHaveBeenCalledTimes(3);
            // Кожен attempt — fresh session/transaction (real Mongo
            // semantic: aborted TX не reusable для подальших writes).
            expect(startSessionMock).toHaveBeenCalledTimes(3);
            expect(withTransactionMock).toHaveBeenCalledTimes(3);
            expect(endSessionMock).toHaveBeenCalledTimes(3);
        });

        it('після 3 retry-collisions → INVOICE_SLUG_GENERATION_FAILED, 3 fresh sessions', async () => {
            const dupErr = Object.assign(new Error('E11000'), { code: 11000 });
            invoiceModel.create.mockRejectedValue(dupErr);

            await expect(
                service.create(business, baseDto)
            ).rejects.toBeInstanceOf(InternalServerErrorException);
            expect(invoiceModel.create).toHaveBeenCalledTimes(3);
            expect(startSessionMock).toHaveBeenCalledTimes(3);
        });

        it('non-duplicate Mongo error pass-through без retry-ю (1 session)', async () => {
            const otherErr = Object.assign(new Error('Mongo timeout'), {
                code: 99,
            });
            invoiceModel.create.mockRejectedValueOnce(otherErr);
            await expect(service.create(business, baseDto)).rejects.toThrow(
                'Mongo timeout'
            );
            // Не retry-ить non-duplicate errors — лише 1 attempt, 1 session.
            expect(invoiceModel.create).toHaveBeenCalledTimes(1);
            expect(startSessionMock).toHaveBeenCalledTimes(1);
            expect(endSessionMock).toHaveBeenCalledTimes(1);
        });

        it('replica-set unsupported error → 500 CASCADE_DELETE_REQUIRES_REPLICA_SET', async () => {
            // Standalone mongod кидає на withTransaction message containing
            // "Transaction numbers are only allowed on a replica set member".
            withTransactionMock.mockRejectedValueOnce(
                new Error(
                    'Transaction numbers are only allowed on a replica set member or mongos'
                )
            );
            await expect(
                service.create(business, baseDto)
            ).rejects.toBeInstanceOf(InternalServerErrorException);
            expect(endSessionMock).toHaveBeenCalled();
        });

        it('validUntil у минулому → 400 INVOICE_VALID_UNTIL_IN_PAST, transaction не стартує', async () => {
            // Sprint 4 review fix — write-side enforcement `validUntil >= now`.
            // Перевірка ДО стартового connection.startSession() — на 400-error
            // не запускаємо session machinery.
            const past = new Date(Date.now() - 60_000);
            await expect(
                service.create(business, { ...baseDto, validUntil: past })
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(withTransactionMock).not.toHaveBeenCalled();
            expect(invoiceModel.create).not.toHaveBeenCalled();
        });

        it('validUntil=null → дозволяється (без терміну дії)', async () => {
            mockInsertSuccess();
            await expect(
                service.create(business, { ...baseDto, validUntil: null })
            ).resolves.toBeDefined();
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

        it('сортує createdAt desc з _id tie-break + skip/limit', async () => {
            const chain = mockChain([], 0);
            await service.getByBusinessId(businessId, { page: 2, limit: 10 });
            // `_id: -1` — tie-breaker для offset-pagination determinism
            // (review fix): tie-group по timestamp-у міг давати дублі/пропуски
            // між page=N і page=N+1.
            expect(chain.sort).toHaveBeenCalledWith({
                createdAt: -1,
                _id: -1,
            });
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
            await service.update(business, 'inv-001-x', {
                paymentPurpose: 'New',
            });
            const filter = invoiceModel.findOneAndUpdate.mock.calls[0]![0];
            expect(filter).toEqual({ businessId, slug: 'inv-001-x' });
            expect(filter.$expr).toBeUndefined();
            expect(invoiceModel.exists).not.toHaveBeenCalled();
        });

        it('coupled (тільки amountLocked): vat-літерал, amount — field-ref', async () => {
            mockUpdateReturn({});
            await service.update(business, 'inv-001-x', {
                amountLocked: true,
            });
            const filter = invoiceModel.findOneAndUpdate.mock.calls[0]![0];
            expect(filter.$expr).toEqual({
                $or: [{ $ne: ['$amount', null] }, { $ne: [true, true] }],
            });
        });

        it('coupled (тільки amount=null): amount-літерал, locked — field-ref', async () => {
            mockUpdateReturn({});
            await service.update(business, 'inv-001-x', { amount: null });
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
                service.update(business, 'inv-001-x', { amountLocked: true })
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('NotFound (no coupled fields): findOneAndUpdate→null → 404 без exists()', async () => {
            mockUpdateReturn(null);
            await expect(
                service.update(business, 'gone', { paymentPurpose: 'X' })
            ).rejects.toBeInstanceOf(NotFoundException);
            expect(invoiceModel.exists).not.toHaveBeenCalled();
        });

        it('NotFound (coupled fields): filter→null + exists→false → 404', async () => {
            mockUpdateReturn(null);
            invoiceModel.exists.mockResolvedValue(null);
            await expect(
                service.update(business, 'gone', { amountLocked: true })
            ).rejects.toBeInstanceOf(NotFoundException);
        });

        it('validUntil у минулому на PATCH → 400 INVOICE_VALID_UNTIL_IN_PAST', async () => {
            // Update теж enforce-ить write-side інваріант. Database не
            // зачіпається (findOneAndUpdate не повинен викликатись).
            const past = new Date(Date.now() - 60_000);
            await expect(
                service.update(business, 'inv-001', { validUntil: past })
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(invoiceModel.findOneAndUpdate).not.toHaveBeenCalled();
        });

        describe('payeeSnapshot.paymentPurpose mirror (Sprint 4 review fix)', () => {
            it('PATCH paymentPurpose → resolved + dual update top-level + snapshot via $cond pipeline', async () => {
                // КРИТИЧНИЙ INVARIANT: snapshot.paymentPurpose — single
                // source of truth для public payload. Без mirror-у клієнт+банк
                // бачать stale текст після ФОП-PATCH-у paymentPurpose.
                mockUpdateReturn({ paymentPurpose: 'Updated' });
                await service.update(business, 'inv-001-x', {
                    paymentPurpose: 'Updated',
                });
                const updateArg =
                    invoiceModel.findOneAndUpdate.mock.calls[0]![1];
                // Pipeline-update (array, not plain doc) — `$cond` керує
                // snapshot mirror-ом без partial-snapshot для legacy (null).
                expect(Array.isArray(updateArg)).toBe(true);
                const setStage = (updateArg as Array<{ $set: Record<string, unknown> }>)[0]!.$set;
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

            it('PATCH paymentPurpose=null → resolve через business.template + mirror у snapshot', async () => {
                // null-inheritance на PATCH: resolved у конкретний рядок,
                // який mirror-иться у snapshot. Frozen forever — наступний
                // PATCH ще раз resolve-ить, snapshot tracks current state.
                mockUpdateReturn({ paymentPurpose: null });
                await service.update(business, 'inv-001-x', {
                    paymentPurpose: null,
                });
                const updateArg =
                    invoiceModel.findOneAndUpdate.mock.calls[0]![1];
                const setStage = (updateArg as Array<{ $set: Record<string, unknown> }>)[0]!.$set;
                // Top-level зберігає null (user-input semantics).
                expect(setStage.paymentPurpose).toBeNull();
                // Snapshot mirror має RESOLVED-string (effectiveInvoicePurpose
                // result), не null — щоб payload завжди мав конкретний текст.
                expect(setStage.payeeSnapshot).toEqual({
                    $cond: [
                        { $eq: ['$payeeSnapshot', null] },
                        '$payeeSnapshot',
                        {
                            $mergeObjects: [
                                '$payeeSnapshot',
                                {
                                    paymentPurpose:
                                        'Default biz purpose',
                                },
                            ],
                        },
                    ],
                });
            });

            it('PATCH без paymentPurpose → не торкає snapshot', async () => {
                // Якщо PATCH не міняє purpose — snapshot.paymentPurpose
                // залишається без змін. setStage не повинен містити
                // payeeSnapshot.
                mockUpdateReturn({ amount: 200000 });
                await service.update(business, 'inv-001-x', {
                    amount: 200000,
                });
                const updateArg =
                    invoiceModel.findOneAndUpdate.mock.calls[0]![1];
                const setStage = (updateArg as Array<{ $set: Record<string, unknown> }>)[0]!.$set;
                expect(setStage.amount).toBe(200000);
                expect(setStage).not.toHaveProperty('payeeSnapshot');
                expect(setStage).not.toHaveProperty('paymentPurpose');
            });
        });

        it('validUntil=null на PATCH → пропускає, дозволяється', async () => {
            mockUpdateReturn({ validUntil: null });
            await expect(
                service.update(business, 'inv-001', { validUntil: null })
            ).resolves.toBeDefined();
        });

        it('PATCH без validUntil поля (undefined) → не валидує time-rule', async () => {
            mockUpdateReturn({ paymentPurpose: 'X' });
            await expect(
                service.update(business, 'inv-001', { paymentPurpose: 'X' })
            ).resolves.toBeDefined();
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
