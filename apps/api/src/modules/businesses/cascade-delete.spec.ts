import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { Model, Types } from 'mongoose';

import { createReplSetMongo } from '../../test-utils/mongo';
import { RedisLockService } from '../../common/services/redis-lock.service';
import {
    AccountSlugHistory,
    AccountSlugHistorySchema,
} from '../accounts/schemas/account-slug-history.schema';
import {
    Account,
    AccountDocument,
    AccountSchema,
} from '../accounts/schemas/account.schema';
import {
    InvoiceSlugCounter,
    InvoiceSlugCounterDocument,
    InvoiceSlugCounterSchema,
} from '../invoices/schemas/invoice-slug-counter.schema';
import {
    InvoiceSlugHistory,
    InvoiceSlugHistorySchema,
} from '../invoices/schemas/invoice-slug-history.schema';
import {
    Invoice,
    InvoiceDocument,
    InvoiceSchema,
} from '../invoices/schemas/invoice.schema';
import { BusinessesService } from './businesses.service';
import {
    BusinessSlugHistory,
    BusinessSlugHistorySchema,
} from './schemas/business-slug-history.schema';
import {
    Business,
    BusinessDocument,
    BusinessSchema,
} from './schemas/business.schema';
import { SlugGeneratorService } from './slug-generator.service';

/**
 * Sprint 4 §SP-5 + DoD §4.0 — integration spec для cascade-delete на
 * `MongoMemoryReplSet`. Тести покривають:
 *  1. Happy path: бізнес + N інвойсів → одна transaction видаляє всіх.
 *  2. Mid-transaction failure → rollback (нічого не видалено).
 *
 * **Чому окремий spec, не у `businesses.service.spec.ts`.** Unit-spec
 * мокує Mongo через jest-mocks і `withTransaction(cb)` запускає cb напряму
 * — це покриває control-flow логіку (call ordering, error mapping), але НЕ
 * перевіряє реальну atomicity Mongo transaction-ів. Тут — реальний
 * `MongoMemoryReplSet`, де `withTransaction` справді commits/rollbacks.
 */
describe('BusinessesService cascade-delete (Sprint 4 §SP-5, MongoMemoryReplSet)', () => {
    let mongo: Awaited<ReturnType<typeof createReplSetMongo>>;
    let moduleRef: TestingModule;
    let service: BusinessesService;
    let businessModel: Model<BusinessDocument>;
    let accountModel: Model<AccountDocument>;
    let invoiceModel: Model<InvoiceDocument>;
    let counterModel: Model<InvoiceSlugCounterDocument>;

    beforeAll(async () => {
        mongo = await createReplSetMongo();
        moduleRef = await Test.createTestingModule({
            imports: [
                MongooseModule.forRoot(mongo.uri),
                MongooseModule.forFeature([
                    { name: Business.name, schema: BusinessSchema },
                    {
                        name: BusinessSlugHistory.name,
                        schema: BusinessSlugHistorySchema,
                    },
                    { name: Account.name, schema: AccountSchema },
                    {
                        name: AccountSlugHistory.name,
                        schema: AccountSlugHistorySchema,
                    },
                    { name: Invoice.name, schema: InvoiceSchema },
                    {
                        name: InvoiceSlugCounter.name,
                        schema: InvoiceSlugCounterSchema,
                    },
                    {
                        name: InvoiceSlugHistory.name,
                        schema: InvoiceSlugHistorySchema,
                    },
                ]),
            ],
            providers: [
                BusinessesService,
                {
                    provide: SlugGeneratorService,
                    useValue: { generateRandomSlug: jest.fn() },
                },
                {
                    // Cascade-delete лок не використовує — pass-through stub.
                    provide: RedisLockService,
                    useValue: {
                        withLock: async (
                            _key: string,
                            _ttlMs: number,
                            fn: () => Promise<unknown>
                        ) => fn(),
                    },
                },
            ],
        }).compile();
        service = moduleRef.get(BusinessesService);
        businessModel = moduleRef.get(getModelToken(Business.name));
        accountModel = moduleRef.get(getModelToken(Account.name));
        invoiceModel = moduleRef.get(getModelToken(Invoice.name));
        counterModel = moduleRef.get(getModelToken(InvoiceSlugCounter.name));
    }, 30_000);

    afterAll(async () => {
        await moduleRef.close();
        await mongo.stop();
    });

    beforeEach(async () => {
        await businessModel.deleteMany({});
        await accountModel.deleteMany({});
        await invoiceModel.deleteMany({});
        await counterModel.deleteMany({});
    });

    /** Helper: створює business + accountCount accounts × invoicesPerAccount invoices. */
    async function seedBusinessWithAccountsAndInvoices(
        accountCount: number,
        invoicesPerAccount: number
    ): Promise<{
        business: BusinessDocument;
        accounts: AccountDocument[];
    }> {
        const business = await businessModel.create({
            type: 'fop',
            ownerId: new Types.ObjectId(),
            managers: [],
            slug: 'IvanEnko',
            slugLower: 'ivanenko',
            name: 'Іваненко',
            taxId: '1234567899',
            taxationSystem: 'simplified-3',
            isVatPayer: false,
            paymentPurposeTemplate: 'Оплата',
            seoIndexEnabled: false,
        });
        const accounts: AccountDocument[] = [];
        for (let a = 1; a <= accountCount; a++) {
            const account = await accountModel.create({
                businessId: business._id,
                iban: `UA213223130000026007233566${String(a).padStart(3, '0')}`,
                bankCode: 'privatbank',
                name: `Privat #${a}`,
                slug: `accSlug${a}`,
                slugLower: `accslug${a}`,
            });
            accounts.push(account);
            for (let i = 1; i <= invoicesPerAccount; i++) {
                const invSlug = `inv-${String(i).padStart(3, '0')}-aB3xQ9k${a}${i}`;
                await invoiceModel.create({
                    businessId: business._id,
                    accountId: account._id,
                    slug: invSlug,
                    slugLower: invSlug.toLowerCase(),
                    slugPreset: 'simple',
                    slugCounterScope: 'simple',
                    slugCounter: i,
                    amount: 150000,
                    amountLocked: true,
                    paymentPurpose: 'Оплата',
                    validUntil: null,
                    deletedAt: null,
                });
            }
            await counterModel.create({
                businessId: business._id,
                accountId: account._id,
                scope: 'simple',
                last: invoicesPerAccount,
            });
        }
        return { business, accounts };
    }

    it('Sprint 9 §SP-5 — happy path: business з 2 accounts × 3 invoices → all 4 collections 0', async () => {
        const { business } = await seedBusinessWithAccountsAndInvoices(2, 3);

        const result = await service.delete(business);

        expect(result).toEqual({ affectedAccounts: 2, affectedInvoices: 6 });
        expect(await businessModel.findById(business._id)).toBeNull();
        expect(
            await accountModel.countDocuments({ businessId: business._id })
        ).toBe(0);
        expect(
            await invoiceModel.countDocuments({ businessId: business._id })
        ).toBe(0);
        expect(
            await counterModel.countDocuments({ businessId: business._id })
        ).toBe(0);
    });

    it('happy path: бізнес без accounts/invoices → counters=0', async () => {
        const { business } = await seedBusinessWithAccountsAndInvoices(0, 0);

        const result = await service.delete(business);
        expect(result).toEqual({ affectedAccounts: 0, affectedInvoices: 0 });
        expect(await businessModel.findById(business._id)).toBeNull();
    });

    it('rollback on mid-transaction failure: усе лишається', async () => {
        const { business } = await seedBusinessWithAccountsAndInvoices(2, 3);
        const otherBusinessId = new Types.ObjectId();
        const otherAccountId = new Types.ObjectId();
        await invoiceModel.create({
            businessId: otherBusinessId,
            accountId: otherAccountId,
            slug: 'other-aaaaaaaa',
            slugLower: 'other-aaaaaaaa',
            slugPreset: null,
            slugCounterScope: null,
            slugCounter: null,
            amount: null,
            amountLocked: false,
            paymentPurpose: null,
            validUntil: null,
            deletedAt: null,
        });

        const deleteOneSpy = jest
            .spyOn(businessModel, 'deleteOne')
            .mockImplementationOnce(() => {
                throw new Error('Simulated mid-transaction failure');
            });

        await expect(service.delete(business)).rejects.toThrow(
            'Simulated mid-transaction failure'
        );

        // Atomic-or-nothing: жодних видалень.
        expect(await businessModel.findById(business._id)).not.toBeNull();
        expect(
            await accountModel.countDocuments({ businessId: business._id })
        ).toBe(2);
        expect(
            await invoiceModel.countDocuments({ businessId: business._id })
        ).toBe(6);
        // Інвойс іншого бізнесу — недоторканий.
        expect(
            await invoiceModel.countDocuments({ businessId: otherBusinessId })
        ).toBe(1);

        deleteOneSpy.mockRestore();
    });

    it('cross-business isolation: cascade видаляє лише цей business', async () => {
        const { business: target } = await seedBusinessWithAccountsAndInvoices(
            1,
            2
        );
        const other = await businessModel.create({
            type: 'fop',
            ownerId: new Types.ObjectId(),
            managers: [],
            slug: 'OtherBiz',
            slugLower: 'otherbiz',
            name: 'Other',
            taxId: '1234567899',
            taxationSystem: 'simplified-3',
            isVatPayer: false,
            paymentPurposeTemplate: 'Other',
            seoIndexEnabled: false,
        });
        const otherAccount = await accountModel.create({
            businessId: other._id,
            iban: 'UA213223130000026007233566555',
            bankCode: 'privatbank',
            name: 'Privat #other',
            slug: 'otherAcct',
            slugLower: 'otheracct',
        });
        await invoiceModel.create({
            businessId: other._id,
            accountId: otherAccount._id,
            slug: 'sibling-aaaaaaaa',
            slugLower: 'sibling-aaaaaaaa',
            slugPreset: null,
            slugCounterScope: null,
            slugCounter: null,
            amount: null,
            amountLocked: false,
            paymentPurpose: null,
            validUntil: null,
            deletedAt: null,
        });

        await service.delete(target);

        // Target gone.
        expect(await businessModel.findById(target._id)).toBeNull();
        expect(
            await accountModel.countDocuments({ businessId: target._id })
        ).toBe(0);
        expect(
            await invoiceModel.countDocuments({ businessId: target._id })
        ).toBe(0);
        // Other business + його invoice — недоторкані.
        expect(await businessModel.findById(other._id)).not.toBeNull();
        expect(
            await accountModel.countDocuments({ businessId: other._id })
        ).toBe(1);
        expect(
            await invoiceModel.countDocuments({ businessId: other._id })
        ).toBe(1);
    });
});
