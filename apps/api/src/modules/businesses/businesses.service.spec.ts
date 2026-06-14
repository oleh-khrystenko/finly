import { Test } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    InternalServerErrorException,
    NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { RESPONSE_CODE, VAT_ALLOWED_TAXATION_SYSTEMS } from '@finly/types';
import type {
    CreateBusinessRequest,
    UpdateBusinessRequest,
} from '@finly/types';

import {
    RedisLockBusyError,
    RedisLockService,
} from '../../common/services/redis-lock.service';
import { Account } from '../accounts/schemas/account.schema';
import { AccountSlugHistory } from '../accounts/schemas/account-slug-history.schema';
import { InvoiceSlugCounter } from '../invoices/schemas/invoice-slug-counter.schema';
import { InvoiceSlugHistory } from '../invoices/schemas/invoice-slug-history.schema';
import { Invoice } from '../invoices/schemas/invoice.schema';
import { BusinessesService } from './businesses.service';
import { BusinessSlugHistory } from './schemas/business-slug-history.schema';
import type { BusinessDocument } from './schemas/business.schema';
import { Business } from './schemas/business.schema';
import { SlugReservationService } from '../slug-reservation/slug-reservation.service';
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
        countDocuments: jest.Mock;
    }>;
    // Sprint 14 — BusinessSlugHistory model для slug-rename TX (insert old slug,
    // anti-squatting check, revert-cleanup). Default — порожнє: existing
    // it-блоки не торкають slug, новий PATCH-flow не активний.
    let historyModel: jest.Mocked<{
        create: jest.Mock;
        deleteMany: jest.Mock;
        exists: jest.Mock;
        findOne: jest.Mock;
    }>;
    // Sprint 10 §SP-11 — pre-check / race-protection replay використовує
    // findOne з компаунд-фільтром. У existing-spec findOne уже мокається
    // окремо у update-блоці; create-block тестів використовує власний
    // helper-mock для замикання findOne-chain.
    let accountModel: jest.Mocked<{
        countDocuments: jest.Mock;
        deleteMany: jest.Mock;
    }>;
    let invoiceModel: jest.Mocked<{
        countDocuments: jest.Mock;
        deleteMany: jest.Mock;
    }>;
    let counterModel: jest.Mocked<{
        deleteMany: jest.Mock;
    }>;
    let session: jest.Mocked<{
        withTransaction: jest.Mock;
        endSession: jest.Mock;
    }>;
    let connection: jest.Mocked<{ startSession: jest.Mock }>;
    let slugGenerator: jest.Mocked<{
        generateRandomSlug: jest.Mock;
        isReserved: jest.Mock;
    }>;
    // Sprint 19 — per-user лок на create. Default — pass-through (лок вільний);
    // окремий it-блок форсує RedisLockBusyError для 409-кейсу.
    let lockService: { withLock: jest.Mock };

    const userId = new Types.ObjectId();
    const TEST_USER_ID = '507f1f77bcf86cd799439099';

    const mockSlugReservations = {
        isNameHeldByOther: jest.fn().mockResolvedValue(false),
        reserve: jest.fn(),
        consumeForUser: jest.fn().mockResolvedValue(undefined),
        getActiveForUser: jest.fn().mockResolvedValue(null),
    };

    const VALID_CREATE: CreateBusinessRequest = {
        type: 'fop',
        name: 'Іваненко',
        taxId: '1234567899',
        taxationSystem: 'simplified-3',
        isVatPayer: false,
        paymentPurposeTemplate: 'Оплата',
    };

    beforeEach(async () => {
        businessModel = {
            create: jest.fn(),
            find: jest.fn(),
            findOne: jest.fn(),
            findOneAndUpdate: jest.fn(),
            exists: jest.fn(),
            deleteOne: jest.fn(),
            // Sprint 19 — create-ліміт рахує наявні бізнеси. Default 0 (під
            // лімітом); тести лімітів перевизначають per-call.
            countDocuments: jest.fn().mockResolvedValue(0),
        };
        historyModel = {
            create: jest.fn().mockResolvedValue([]),
            deleteMany: jest.fn().mockReturnValue({
                exec: jest.fn().mockResolvedValue({ deletedCount: 0 }),
            }),
            exists: jest.fn().mockResolvedValue(null),
            findOne: jest.fn().mockReturnValue({
                lean: jest.fn().mockReturnValue({
                    exec: jest.fn().mockResolvedValue(null),
                }),
            }),
        };
        accountModel = {
            countDocuments: jest.fn().mockResolvedValue(0),
            deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
        };
        invoiceModel = {
            countDocuments: jest.fn().mockResolvedValue(0),
            deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
        };
        counterModel = {
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
            // Sprint 14 — slug-rename reserved-check. Default — non-reserved;
            // окремий it-блок для 'api' overrides через mockReturnValueOnce(true).
            isReserved: jest.fn().mockImplementation((slugLower: string) => {
                return ['api', 'qr', 'host-pay', 'auth'].includes(slugLower);
            }),
        };

        lockService = {
            withLock: jest.fn(
                async (
                    _key: string,
                    _ttlMs: number,
                    fn: () => Promise<unknown>
                ) => fn()
            ),
        };

        const module = await Test.createTestingModule({
            providers: [
                BusinessesService,
                {
                    provide: getModelToken(Business.name),
                    useValue: businessModel,
                },
                {
                    provide: getModelToken(BusinessSlugHistory.name),
                    useValue: historyModel,
                },
                {
                    provide: getModelToken(Account.name),
                    useValue: accountModel,
                },
                {
                    provide: getModelToken(Invoice.name),
                    useValue: invoiceModel,
                },
                {
                    provide: getModelToken(InvoiceSlugCounter.name),
                    useValue: counterModel,
                },
                {
                    // Sprint 15 — nested slug-history cascade-cleanup.
                    provide: getModelToken(AccountSlugHistory.name),
                    useValue: {
                        deleteMany: jest
                            .fn()
                            .mockResolvedValue({ deletedCount: 0 }),
                    },
                },
                {
                    provide: getModelToken(InvoiceSlugHistory.name),
                    useValue: {
                        deleteMany: jest
                            .fn()
                            .mockResolvedValue({ deletedCount: 0 }),
                    },
                },
                {
                    provide: getConnectionToken(),
                    useValue: connection,
                },
                { provide: SlugGeneratorService, useValue: slugGenerator },
                { provide: RedisLockService, useValue: lockService },
                {
                    provide: SlugReservationService,
                    useValue: mockSlugReservations,
                },
            ],
        }).compile();
        service = module.get(BusinessesService);
    });

    describe('create', () => {
        it('створює owned business для звичайного ФОП (worksAsBookkeeper=false)', async () => {
            businessModel.create.mockResolvedValue({} as never);
            await service.create(
                userId.toString(),
                VALID_CREATE,
                false,
                'bookkeeper'
            );

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
            await service.create(
                userId.toString(),
                VALID_CREATE,
                true,
                'bookkeeper'
            );

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
            await service.create(
                userId.toString(),
                VALID_CREATE,
                false,
                'bookkeeper'
            );

            const arg = businessModel.create.mock.calls[0]![0];
            expect(arg.slug).toBe('aB3xQ9k7');
            expect(arg.slugLower).toBe('ab3xq9k7');
        });

        it('обгортає race-collision (Mongo 11000) у SLUG_GENERATION_FAILED', async () => {
            const dupErr = Object.assign(new Error('E11000'), { code: 11000 });
            businessModel.create.mockRejectedValue(dupErr);
            await expect(
                service.create(
                    userId.toString(),
                    VALID_CREATE,
                    false,
                    'bookkeeper'
                )
            ).rejects.toBeInstanceOf(InternalServerErrorException);
        });

        it('пропускає інші Mongo errors без обгортання', async () => {
            const otherErr = Object.assign(new Error('Mongo timeout'), {
                code: 99,
            });
            businessModel.create.mockRejectedValue(otherErr);
            await expect(
                service.create(
                    userId.toString(),
                    VALID_CREATE,
                    false,
                    'bookkeeper'
                )
            ).rejects.toThrow('Mongo timeout');
        });

        // ─── Sprint 10 §SP-11 — claimIdempotencyKey replay ───

        describe('claimIdempotencyKey (Sprint 10 §SP-11)', () => {
            const KEY = '00000000-0000-4000-8000-000000000000';
            const mockFindOneExec = (returnValue: unknown) => {
                businessModel.findOne.mockReturnValue({
                    exec: jest.fn().mockResolvedValue(returnValue),
                });
            };

            it('(a) без claimIdempotencyKey — cabinet-create працює як зараз; findOne не викликається', async () => {
                businessModel.create.mockResolvedValue({} as never);
                await service.create(
                    userId.toString(),
                    VALID_CREATE,
                    false,
                    'bookkeeper'
                );
                expect(businessModel.findOne).not.toHaveBeenCalled();
                expect(businessModel.create).toHaveBeenCalledTimes(1);
            });

            it('(b) з claimIdempotencyKey новим — pre-check не знаходить, insert створює документ зі stored key', async () => {
                mockFindOneExec(null);
                businessModel.create.mockResolvedValue({} as never);

                await service.create(
                    userId.toString(),
                    { ...VALID_CREATE, claimIdempotencyKey: KEY },
                    false,
                    'bookkeeper'
                );

                // Pre-check ownership-aware filter (owned-mode).
                const findArg = businessModel.findOne.mock.calls[0]![0];
                expect(findArg.claimIdempotencyKey).toBe(KEY);
                expect((findArg.ownerId as Types.ObjectId).toString()).toBe(
                    userId.toString()
                );
                expect(findArg.managers).toBeUndefined();

                // Insert містить key у документі.
                expect(businessModel.create.mock.calls[0]![0]).toMatchObject({
                    claimIdempotencyKey: KEY,
                });
            });

            it('(b2) з claimIdempotencyKey + bookkeeper-mode — pre-check filter містить ownerId: null + managers', async () => {
                mockFindOneExec(null);
                businessModel.create.mockResolvedValue({} as never);

                await service.create(
                    userId.toString(),
                    { ...VALID_CREATE, claimIdempotencyKey: KEY },
                    true,
                    'bookkeeper'
                );

                const findArg = businessModel.findOne.mock.calls[0]![0];
                expect(findArg.ownerId).toBeNull();
                expect((findArg.managers as Types.ObjectId).toString()).toBe(
                    userId.toString()
                );
                expect(findArg.claimIdempotencyKey).toBe(KEY);
            });

            it('(c) з claimIdempotencyKey existing — pre-check повертає existing, insert НЕ викликається', async () => {
                const existingDoc = {
                    _id: 'existing-business-id',
                    slug: 'AbCd',
                };
                mockFindOneExec(existingDoc);

                const result = await service.create(
                    userId.toString(),
                    { ...VALID_CREATE, claimIdempotencyKey: KEY },
                    false,
                    'bookkeeper'
                );

                expect(result).toBe(existingDoc);
                expect(businessModel.create).not.toHaveBeenCalled();
            });

            it('(c2) race-protection: insert падає на 11000 з keyPattern.claimIdempotencyKey → re-fetch existing', async () => {
                // 1-й findOne (pre-check) → null; 2-й findOne (post-11000 re-fetch) → existing.
                const existingDoc = { _id: 'racing-business-id', slug: 'XyZw' };
                businessModel.findOne
                    .mockReturnValueOnce({
                        exec: jest.fn().mockResolvedValue(null),
                    })
                    .mockReturnValueOnce({
                        exec: jest.fn().mockResolvedValue(existingDoc),
                    });
                const dupErr = Object.assign(new Error('E11000'), {
                    code: 11000,
                    keyPattern: { ownerId: 1, claimIdempotencyKey: 1 },
                });
                businessModel.create.mockRejectedValue(dupErr);

                const result = await service.create(
                    userId.toString(),
                    { ...VALID_CREATE, claimIdempotencyKey: KEY },
                    false,
                    'bookkeeper'
                );

                expect(result).toBe(existingDoc);
                expect(businessModel.findOne).toHaveBeenCalledTimes(2);
            });

            it('(c3) slug-collision 11000 (без claimIdempotencyKey у keyPattern) — продовжує кидати SLUG_GENERATION_FAILED', async () => {
                mockFindOneExec(null);
                const dupErr = Object.assign(new Error('E11000'), {
                    code: 11000,
                    keyPattern: { slugLower: 1 },
                });
                businessModel.create.mockRejectedValue(dupErr);

                await expect(
                    service.create(
                        userId.toString(),
                        { ...VALID_CREATE, claimIdempotencyKey: KEY },
                        false,
                        'bookkeeper'
                    )
                ).rejects.toBeInstanceOf(InternalServerErrorException);
            });
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

        // Sprint 7 §7.5 — `update` робить prelim `findOne({slugLower}, {type:1}).lean().exec()`
        // коли PATCH чіпляє taxation-fields або `requisites.taxId` (один read,
        // обидва cross-check-и). Default mock — type='fop' (existing fixture);
        // тести для individual/tov/organization перевизначають через
        // `mockExistingType(...)`.
        const mockExistingType = (
            type: 'individual' | 'fop' | 'tov' | 'organization' | null
        ) => {
            businessModel.findOne.mockReturnValue({
                lean: jest.fn().mockReturnValue({
                    exec: jest
                        .fn()
                        .mockResolvedValue(type === null ? null : { type }),
                }),
            });
        };

        beforeEach(() => {
            mockExistingType('fop');
        });

        it('без coupled-полів — filter без $expr, findOne не викликається', async () => {
            mockUpdateReturn({ name: 'New' });
            await service.update(
                'IvanEnko',
                { name: 'New' },
                'bookkeeper',
                TEST_USER_ID
            );
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
            await service.update(
                'IvanEnko',
                { isVatPayer: true },
                'bookkeeper',
                TEST_USER_ID
            );
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
            await service.update(
                'IvanEnko',
                { isVatPayer: false },
                'bookkeeper',
                TEST_USER_ID
            );
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
            await service.update(
                'IvanEnko',
                {
                    taxationSystem: 'simplified-1',
                },
                'bookkeeper',
                TEST_USER_ID
            );
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
            await service.update(
                'IvanEnko',
                {
                    isVatPayer: true,
                    taxationSystem: 'simplified-3',
                } as UpdateBusinessRequest,
                'bookkeeper',
                TEST_USER_ID
            );
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
                service.update(
                    'IvanEnko',
                    { isVatPayer: true },
                    'bookkeeper',
                    TEST_USER_ID
                )
            ).rejects.toBeInstanceOf(BadRequestException);
            expect(businessModel.exists).toHaveBeenCalledWith({
                slugLower: 'ivanenko',
            });
        });

        it('coupled violation на taxation: findOneAndUpdate→null + exists→true → BadRequest', async () => {
            mockUpdateReturn(null);
            mockExistsReturn(true);
            await expect(
                service.update(
                    'IvanEnko',
                    { taxationSystem: 'simplified-1' },
                    'bookkeeper',
                    TEST_USER_ID
                )
            ).rejects.toBeInstanceOf(BadRequestException);
        });

        it('cross-field валідна пара — findOneAndUpdate повертає doc, exists() не викликається', async () => {
            mockUpdateReturn({
                taxationSystem: 'simplified-3',
                isVatPayer: true,
            });
            await expect(
                service.update(
                    'IvanEnko',
                    {
                        taxationSystem: 'simplified-3',
                        isVatPayer: true,
                    } as UpdateBusinessRequest,
                    'bookkeeper',
                    TEST_USER_ID
                )
            ).resolves.toBeDefined();
            expect(businessModel.exists).not.toHaveBeenCalled();
        });

        it('NotFound (no coupled fields): findOneAndUpdate→null → NotFound без exists()', async () => {
            mockUpdateReturn(null);
            await expect(
                service.update(
                    'IvanEnko',
                    { name: 'X' },
                    'bookkeeper',
                    TEST_USER_ID
                )
            ).rejects.toBeInstanceOf(NotFoundException);
            expect(businessModel.exists).not.toHaveBeenCalled();
        });

        it('NotFound (coupled fields): findOneAndUpdate→null + exists→false → NotFound', async () => {
            mockUpdateReturn(null);
            mockExistsReturn(false);
            await expect(
                service.update(
                    'IvanEnko',
                    { isVatPayer: true },
                    'bookkeeper',
                    TEST_USER_ID
                )
            ).rejects.toBeInstanceOf(NotFoundException);
        });

        it('lookup для update — case-insensitive по slugLower', async () => {
            mockUpdateReturn({ name: 'X' });
            await service.update(
                'IvanEnko',
                { name: 'X' },
                'bookkeeper',
                TEST_USER_ID
            );
            const filter = businessModel.findOneAndUpdate.mock.calls[0]![0];
            expect(filter).toEqual({ slugLower: 'ivanenko' });
        });

        // ─── Sprint 7 §7.5 — type-aware cross-checks ───

        describe('type-aware cross-checks (Sprint 7 §7.5)', () => {
            it('non-taxation type + PATCH taxationSystem → 400 TAXATION_NOT_APPLICABLE_FOR_TYPE', async () => {
                mockExistingType('individual');
                await expect(
                    service.update(
                        'IvanEnko',
                        {
                            taxationSystem: 'simplified-3',
                        },
                        'bookkeeper',
                        TEST_USER_ID
                    )
                ).rejects.toMatchObject({
                    response: {
                        code: 'TAXATION_NOT_APPLICABLE_FOR_TYPE',
                    },
                });
                expect(businessModel.findOneAndUpdate).not.toHaveBeenCalled();
            });

            it('non-taxation type (organization) + PATCH isVatPayer → 400', async () => {
                mockExistingType('organization');
                await expect(
                    service.update(
                        'IvanEnko',
                        { isVatPayer: false },
                        'bookkeeper',
                        TEST_USER_ID
                    )
                ).rejects.toMatchObject({
                    response: {
                        code: 'TAXATION_NOT_APPLICABLE_FOR_TYPE',
                    },
                });
            });

            it('taxation-required type + PATCH taxationSystem=null → 400 TAXATION_REQUIRED_FOR_TYPE (backward-direction, clear-out заборонено)', async () => {
                mockExistingType('fop');
                await expect(
                    service.update(
                        'IvanEnko',
                        { taxationSystem: null },
                        'bookkeeper',
                        TEST_USER_ID
                    )
                ).rejects.toMatchObject({
                    response: {
                        code: 'TAXATION_REQUIRED_FOR_TYPE',
                    },
                });
            });

            it('taxation-required type + PATCH isVatPayer=null → 400 TAXATION_REQUIRED_FOR_TYPE', async () => {
                mockExistingType('tov');
                await expect(
                    service.update(
                        'IvanEnko',
                        { isVatPayer: null },
                        'bookkeeper',
                        TEST_USER_ID
                    )
                ).rejects.toMatchObject({
                    response: {
                        code: 'TAXATION_REQUIRED_FOR_TYPE',
                    },
                });
            });

            it('fop + PATCH 8-digit ЄДРПОУ → 400 TAX_ID_FORMAT_MISMATCH_TYPE', async () => {
                mockExistingType('fop');
                await expect(
                    service.update(
                        'IvanEnko',
                        {
                            taxId: '12345678', // ЄДРПОУ для tov, не для fop
                        },
                        'bookkeeper',
                        TEST_USER_ID
                    )
                ).rejects.toMatchObject({
                    response: {
                        code: 'TAX_ID_FORMAT_MISMATCH_TYPE',
                    },
                });
            });

            it('tov + PATCH 10-digit RNOKPP → 400 TAX_ID_FORMAT_MISMATCH_TYPE', async () => {
                mockExistingType('tov');
                await expect(
                    service.update(
                        'IvanEnko',
                        {
                            taxId: '1234567899', // RNOKPP для fop, не для tov
                        },
                        'bookkeeper',
                        TEST_USER_ID
                    )
                ).rejects.toMatchObject({
                    response: {
                        code: 'TAX_ID_FORMAT_MISMATCH_TYPE',
                    },
                });
            });

            it.each(['simplified-1', 'simplified-2'] as const)(
                'tov + PATCH %s → 400 TAXATION_SYSTEM_NOT_ALLOWED_FOR_TYPE (ПКУ — заборонено для ТОВ)',
                async (taxationSystem) => {
                    mockExistingType('tov');
                    await expect(
                        service.update(
                            'IvanEnko',
                            { taxationSystem },
                            'bookkeeper',
                            TEST_USER_ID
                        )
                    ).rejects.toMatchObject({
                        response: {
                            code: 'TAXATION_SYSTEM_NOT_ALLOWED_FOR_TYPE',
                        },
                    });
                    expect(
                        businessModel.findOneAndUpdate
                    ).not.toHaveBeenCalled();
                }
            );

            it.each(['simplified-3', 'general'] as const)(
                'tov + PATCH %s → проходить cross-check (allowed-set)',
                async (taxationSystem) => {
                    mockExistingType('tov');
                    mockUpdateReturn({ taxationSystem });
                    await expect(
                        service.update(
                            'IvanEnko',
                            { taxationSystem },
                            'bookkeeper',
                            TEST_USER_ID
                        )
                    ).resolves.toBeDefined();
                }
            );

            it('fop + PATCH simplified-1 → проходить cross-check (для ФОП усі 4 системи валідні)', async () => {
                mockExistingType('fop');
                mockUpdateReturn({ taxationSystem: 'simplified-1' });
                await expect(
                    service.update(
                        'IvanEnko',
                        {
                            taxationSystem: 'simplified-1',
                        },
                        'bookkeeper',
                        TEST_USER_ID
                    )
                ).resolves.toBeDefined();
            });

            it('individual + PATCH valid 10-digit RNOKPP → проходить cross-check', async () => {
                mockExistingType('individual');
                mockUpdateReturn({ name: 'X' });
                await expect(
                    service.update(
                        'IvanEnko',
                        {
                            taxId: '1234567899',
                        },
                        'bookkeeper',
                        TEST_USER_ID
                    )
                ).resolves.toBeDefined();
            });

            it('fop + valid PATCH (RNOKPP + taxation) → cross-check passes', async () => {
                mockExistingType('fop');
                mockUpdateReturn({
                    taxId: '1234567899',
                    taxationSystem: 'simplified-3',
                    isVatPayer: false,
                });
                await expect(
                    service.update(
                        'IvanEnko',
                        {
                            taxId: '1234567899',
                            taxationSystem: 'simplified-3',
                            isVatPayer: false,
                        } as UpdateBusinessRequest,
                        'bookkeeper',
                        TEST_USER_ID
                    )
                ).resolves.toBeDefined();
            });

            it('PATCH name only — findOne не викликається (cross-check skip)', async () => {
                mockUpdateReturn({ name: 'X' });
                await service.update(
                    'IvanEnko',
                    { name: 'X' },
                    'bookkeeper',
                    TEST_USER_ID
                );
                // beforeEach мокає findOne, але .lean()/.exec() не повинні
                // викликатись — перевіряємо це опосередковано через
                // findOne.mock.calls (default mock попередньо викликається у
                // beforeEach НЕ напряму на сервіс — у beforeEach лише
                // configure mock-return, не calls). Service виклику не робить.
                expect(businessModel.findOne).not.toHaveBeenCalled();
            });

            it('PATCH-payload без taxation/taxId, але slug не існує → 404 від $expr-flow (preserves old NotFound semantics)', async () => {
                mockUpdateReturn(null);
                await expect(
                    service.update(
                        'Missing',
                        { name: 'X' },
                        'bookkeeper',
                        TEST_USER_ID
                    )
                ).rejects.toBeInstanceOf(NotFoundException);
                // Без taxation/taxId-payload preliminary findOne не викликається —
                // 404 встановлюється $expr-flow-ом наприкінці update.
                expect(businessModel.findOne).not.toHaveBeenCalled();
            });

            it('PATCH-taxation, але slug не існує → 404 з preliminary findOne', async () => {
                mockExistingType(null);
                await expect(
                    service.update(
                        'Missing',
                        { isVatPayer: true },
                        'bookkeeper',
                        TEST_USER_ID
                    )
                ).rejects.toBeInstanceOf(NotFoundException);
            });
        });

        describe('slug rename (Sprint 14)', () => {
            const businessId = new Types.ObjectId();

            // Mock chain для двох findOne-сайтів slug-rename:
            //  1. pre-write `findCrossBusinessHistoryClash`:
            //     findOne({slugLower:oldLower}, {_id:1}).lean().exec()
            //  2. all-tx `runSlugRenameInsideTx.ownerLookup`:
            //     findOne(...).session(s).lean().exec()
            // Self-chaining mock підтримує обидва — кожен `.session()` /
            // `.lean()` повертає сам chain, `.exec()` повертає Promise.
            const mockBusinessFindOneChain = (found: boolean) => {
                const chain: Record<string, jest.Mock> = {};
                chain.session = jest.fn(() => chain);
                chain.lean = jest.fn(() => chain);
                chain.exec = jest
                    .fn()
                    .mockResolvedValue(found ? { _id: businessId } : null);
                businessModel.findOne.mockReturnValue(chain);
            };

            beforeEach(() => {
                // PATCH тільки slug — type-check preliminary findOne НЕ
                // викликається, тож mockExistingType-mock з outer beforeEach
                // не активується. Переоприділюємо findOne під slug-rename
                // self-chaining mock (підтримує і pre-write, і TX-chain).
                mockBusinessFindOneChain(true);
            });

            it('happy path: вставляє old slug у history + оновлює business з новим slug+slugLower', async () => {
                businessModel.exists.mockResolvedValue(null);
                mockUpdateReturn({
                    slug: 'new-vanity',
                    slugLower: 'new-vanity',
                });

                await service.update(
                    'OldSlug',
                    {
                        slug: 'new-vanity',
                    } as UpdateBusinessRequest,
                    'bookkeeper',
                    TEST_USER_ID
                );

                expect(historyModel.create).toHaveBeenCalledTimes(1);
                const createArg = historyModel.create.mock
                    .calls[0]![0] as Array<{
                    businessId: Types.ObjectId;
                    slugLower: string;
                }>;
                expect(createArg[0].businessId).toEqual(businessId);
                expect(createArg[0].slugLower).toBe('oldslug');

                const setPayload = businessModel.findOneAndUpdate.mock
                    .calls[0]![1] as {
                    $set: { slug: string; slugLower: string };
                };
                expect(setPayload.$set.slug).toBe('new-vanity');
                expect(setPayload.$set.slugLower).toBe('new-vanity');
            });

            it('revert (abc → xyz → abc): TX видаляє self-history-запис перед insert-ом нового', async () => {
                businessModel.exists.mockResolvedValue(null);
                mockUpdateReturn({ slug: 'abc', slugLower: 'abc' });

                await service.update(
                    'XyzSlug',
                    {
                        slug: 'abc',
                    } as UpdateBusinessRequest,
                    'bookkeeper',
                    TEST_USER_ID
                );

                expect(historyModel.deleteMany).toHaveBeenCalledTimes(1);
                const deleteFilter = historyModel.deleteMany.mock
                    .calls[0]![0] as {
                    businessId: Types.ObjectId;
                    slugLower: string;
                };
                expect(deleteFilter.businessId).toEqual(businessId);
                expect(deleteFilter.slugLower).toBe('abc');
            });

            it('reserved slug → 400 SLUG_RESERVED (history.create НЕ викликається)', async () => {
                await expect(
                    service.update(
                        'OldSlug',
                        {
                            slug: 'api',
                        } as UpdateBusinessRequest,
                        'bookkeeper',
                        TEST_USER_ID
                    )
                ).rejects.toMatchObject({
                    response: { code: 'SLUG_RESERVED' },
                });
                expect(historyModel.create).not.toHaveBeenCalled();
                expect(businessModel.findOneAndUpdate).not.toHaveBeenCalled();
            });

            it('business-clash (інший Business має цей slugLower) → 409 SLUG_TAKEN', async () => {
                businessModel.exists.mockResolvedValue({
                    _id: new Types.ObjectId(),
                });

                await expect(
                    service.update(
                        'OldSlug',
                        {
                            slug: 'taken',
                        } as UpdateBusinessRequest,
                        'bookkeeper',
                        TEST_USER_ID
                    )
                ).rejects.toMatchObject({
                    response: { code: 'SLUG_TAKEN' },
                });
                expect(historyModel.create).not.toHaveBeenCalled();
            });

            it('history-clash (recent rename іншого Business) → 409 SLUG_TAKEN', async () => {
                businessModel.exists.mockResolvedValue(null);
                historyModel.exists.mockResolvedValue({
                    _id: new Types.ObjectId(),
                });

                await expect(
                    service.update(
                        'OldSlug',
                        {
                            slug: 'historical',
                        } as UpdateBusinessRequest,
                        'bookkeeper',
                        TEST_USER_ID
                    )
                ).rejects.toMatchObject({
                    response: { code: 'SLUG_TAKEN' },
                });
            });

            it('case-only rename (oldLower === newLower): history НЕ зачіпається, simple update', async () => {
                mockUpdateReturn({ slug: 'OldSlug', slugLower: 'oldslug' });

                await service.update(
                    'OldSlug',
                    {
                        slug: 'OLDSLUG',
                    } as UpdateBusinessRequest,
                    'bookkeeper',
                    TEST_USER_ID
                );

                // newSlugLower === oldSlugLower → slugRenaming=false, TX-flow skip.
                expect(historyModel.create).not.toHaveBeenCalled();
                expect(historyModel.deleteMany).not.toHaveBeenCalled();
            });
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

        it('Sprint 9 §SP-5 — повертає {affectedAccounts, affectedInvoices}', async () => {
            invoiceModel.countDocuments.mockResolvedValue(3);
            accountModel.countDocuments.mockResolvedValue(2);
            mockDeleteOne(1);

            const result = await service.delete(businessFixture);
            expect(result).toEqual({
                affectedAccounts: 2,
                affectedInvoices: 3,
            });
            expect(invoiceModel.countDocuments).toHaveBeenCalledWith({
                businessId,
            });
            expect(accountModel.countDocuments).toHaveBeenCalledWith({
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
                affectedAccounts: 0,
                affectedInvoices: 0,
            });
            expect(session.endSession).toHaveBeenCalledTimes(1);
        });

        it('replica-set absence: ловить "Transaction... replica set" → TRANSACTION_REQUIRES_REPLICA_SET', async () => {
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

    describe('Sprint 19 — access gating', () => {
        const TOV_CREATE: CreateBusinessRequest = {
            type: 'tov',
            name: 'ТОВ Ромашка',
            taxId: '12345678',
            taxationSystem: 'general',
            isVatPayer: false,
            paymentPurposeTemplate: 'Оплата',
        };

        async function expectForbidden(
            promise: Promise<unknown>,
            code: string
        ): Promise<void> {
            const err = await promise.catch((e: unknown) => e);
            expect(err).toBeInstanceOf(ForbiddenException);
            expect((err as ForbiddenException).getResponse()).toMatchObject({
                code,
            });
        }

        // ── Business creation limits ──────────────────────────────────────

        it('owned ФОП понад 1 → BUSINESS_TYPE_LIMIT_REACHED (інваріант, навіть на bookkeeper)', async () => {
            businessModel.countDocuments.mockResolvedValue(1);
            await expectForbidden(
                service.create(
                    userId.toString(),
                    VALID_CREATE,
                    false,
                    'bookkeeper'
                ),
                RESPONSE_CODE.BUSINESS_TYPE_LIMIT_REACHED
            );
            expect(businessModel.create).not.toHaveBeenCalled();
        });

        it('owned ТОВ понад 1 на none/brand → BUSINESS_LIMIT_REQUIRES_PLAN', async () => {
            businessModel.countDocuments.mockResolvedValue(1);
            await expectForbidden(
                service.create(userId.toString(), TOV_CREATE, false, 'brand'),
                RESPONSE_CODE.BUSINESS_LIMIT_REQUIRES_PLAN
            );
        });

        it('owned ТОВ понад 1 на bookkeeper → дозволено (без ліміту)', async () => {
            businessModel.countDocuments.mockResolvedValue(5);
            businessModel.create.mockResolvedValue({} as never);
            await service.create(
                userId.toString(),
                TOV_CREATE,
                false,
                'bookkeeper'
            );
            expect(businessModel.create).toHaveBeenCalled();
        });

        it('клієнтські бізнеси понад 10 на none/brand → BUSINESS_LIMIT_REQUIRES_PLAN', async () => {
            businessModel.countDocuments.mockResolvedValue(10);
            await expectForbidden(
                service.create(userId.toString(), VALID_CREATE, true, 'brand'),
                RESPONSE_CODE.BUSINESS_LIMIT_REQUIRES_PLAN
            );
        });

        it('клієнтські бізнеси на bookkeeper → без ліміту (count не питаємо)', async () => {
            businessModel.create.mockResolvedValue({} as never);
            await service.create(
                userId.toString(),
                VALID_CREATE,
                true,
                'bookkeeper'
            );
            expect(businessModel.countDocuments).not.toHaveBeenCalled();
            expect(businessModel.create).toHaveBeenCalled();
        });

        // ── Create serialization (per-user lock) ──────────────────────────

        it('create йде під per-user локом (count+insert у критичній секції)', async () => {
            businessModel.create.mockResolvedValue({} as never);
            await service.create(
                userId.toString(),
                VALID_CREATE,
                false,
                'bookkeeper'
            );
            expect(lockService.withLock).toHaveBeenCalledTimes(1);
            expect(lockService.withLock.mock.calls[0]![0]).toBe(
                `business_create:${userId.toString()}`
            );
        });

        it('лок зайнятий після всіх ретраїв → 409 BUSINESS_CREATE_IN_PROGRESS', async () => {
            lockService.withLock.mockRejectedValue(
                new RedisLockBusyError('business_create:x')
            );
            const err = await service
                .create(userId.toString(), VALID_CREATE, false, 'bookkeeper')
                .catch((e: unknown) => e);
            expect(err).toBeInstanceOf(ConflictException);
            expect((err as ConflictException).getResponse()).toMatchObject({
                code: RESPONSE_CODE.BUSINESS_CREATE_IN_PROGRESS,
            });
            expect(businessModel.create).not.toHaveBeenCalled();
        }, 10_000);

        it('лок звільнився на ретраї → create проходить', async () => {
            businessModel.create.mockResolvedValue({} as never);
            lockService.withLock.mockRejectedValueOnce(
                new RedisLockBusyError('business_create:x')
            );
            await service.create(
                userId.toString(),
                VALID_CREATE,
                false,
                'bookkeeper'
            );
            expect(lockService.withLock).toHaveBeenCalledTimes(2);
            expect(businessModel.create).toHaveBeenCalled();
        });

        // ── Slug-edit gate ────────────────────────────────────────────────

        it('slug-rename на none → SLUG_EDIT_REQUIRES_PLAN, до DB-роботи', async () => {
            await expectForbidden(
                service.update(
                    'IvanEnko',
                    { slug: 'my-vanity' },
                    'none',
                    TEST_USER_ID
                ),
                RESPONSE_CODE.SLUG_EDIT_REQUIRES_PLAN
            );
            // Cheap-reject: resolveSlugRenameContext (findOne) не викликано.
            expect(businessModel.findOne).not.toHaveBeenCalled();
        });

        it('case-only зміна slug на none → SLUG_EDIT_REQUIRES_PLAN (display-форма теж платна)', async () => {
            await expectForbidden(
                service.update(
                    'IvanEnko',
                    { slug: 'IVANENKO' },
                    'none',
                    TEST_USER_ID
                ),
                RESPONSE_CODE.SLUG_EDIT_REQUIRES_PLAN
            );
            expect(businessModel.findOneAndUpdate).not.toHaveBeenCalled();
        });

        it('case-only зміна slug на brand → проходить + позначає slugCustomized', async () => {
            businessModel.findOneAndUpdate.mockReturnValue({
                exec: jest
                    .fn()
                    .mockResolvedValue({ slug: 'IVANENKO' } as never),
            });
            await service.update(
                'IvanEnko',
                { slug: 'IVANENKO' },
                'brand',
                TEST_USER_ID
            );
            const setArg = businessModel.findOneAndUpdate.mock.calls[0]![1] as {
                $set: Record<string, unknown>;
            };
            expect(setArg.$set.slugCustomized).toBe(true);
            // slugLower незмінний → history не зачіпається.
            expect(historyModel.create).not.toHaveBeenCalled();
        });

        it('PATCH з ідентичним slug — без гейта (no-op, не платний)', async () => {
            businessModel.findOneAndUpdate.mockReturnValue({
                exec: jest
                    .fn()
                    .mockResolvedValue({ slug: 'IvanEnko' } as never),
            });
            await service.update(
                'IvanEnko',
                { slug: 'IvanEnko' },
                'none',
                TEST_USER_ID
            );
            const setArg = businessModel.findOneAndUpdate.mock.calls[0]![1] as {
                $set: Record<string, unknown>;
            };
            expect(setArg.$set.slugCustomized).toBeUndefined();
        });

        it('slug-rename на brand → гейт пропускає (йде у rename-flow)', async () => {
            businessModel.exists.mockResolvedValue(null);
            businessModel.findOne.mockReturnValue({
                lean: jest.fn().mockReturnValue({
                    exec: jest
                        .fn()
                        .mockResolvedValue({ _id: new Types.ObjectId() }),
                }),
            });
            businessModel.findOneAndUpdate.mockReturnValue({
                exec: jest.fn().mockResolvedValue({ slug: 'my-vanity' }),
            });

            await service.update(
                'IvanEnko',
                { slug: 'my-vanity' },
                'brand',
                TEST_USER_ID
            );
            // Гейт пройдено → resolveSlugRenameContext зробив lookup.
            expect(businessModel.findOne).toHaveBeenCalled();
        });
    });
});
