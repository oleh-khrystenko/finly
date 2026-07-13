import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { Model, Types } from 'mongoose';

import { createReplSetMongo, type InMemoryMongo } from '../../test-utils/mongo';
import {
    Account,
    AccountDocument,
    AccountSchema,
} from '../accounts/schemas/account.schema';
import {
    AccountSlugHistory,
    AccountSlugHistorySchema,
} from '../accounts/schemas/account-slug-history.schema';
import {
    InvoiceSlugHistory,
    InvoiceSlugHistorySchema,
} from '../invoices/schemas/invoice-slug-history.schema';
import {
    BusinessSlugHistory,
    BusinessSlugHistorySchema,
} from '../businesses/schemas/business-slug-history.schema';
import {
    Business,
    BusinessDocument,
    BusinessSchema,
} from '../businesses/schemas/business.schema';
import { BusinessesService } from '../businesses/businesses.service';
import { RedisLockService } from '../../common/services/redis-lock.service';
import { SlugGeneratorService } from '../businesses/slug-generator.service';
import { SlugReservationService } from '../slug-reservation/slug-reservation.service';
import { EmailService } from '../email/email.service';
import {
    InvoiceSlugCounter,
    InvoiceSlugCounterDocument,
    InvoiceSlugCounterSchema,
} from '../invoices/schemas/invoice-slug-counter.schema';
import {
    Invoice,
    InvoiceDocument,
    InvoiceSchema,
} from '../invoices/schemas/invoice.schema';
import { User, UserDocument, UserSchema } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { OrphanProfileCleanupService } from './orphan-profile-cleanup.service';

const DAY_MS = 86_400_000;

interface EmailMock {
    sendProfileCompletionReminder: jest.Mock;
    sendProfileCompletionFinalWarning: jest.Mock;
}

describe('OrphanProfileCleanupService (Sprint 12 §12.1c, MongoMemoryReplSet)', () => {
    let mongo: InMemoryMongo;
    let moduleRef: TestingModule;
    let service: OrphanProfileCleanupService;
    let userModel: Model<UserDocument>;
    let businessModel: Model<BusinessDocument>;
    let accountModel: Model<AccountDocument>;
    let invoiceModel: Model<InvoiceDocument>;
    let counterModel: Model<InvoiceSlugCounterDocument>;
    let businessesService: BusinessesService;
    let emailMock: EmailMock;

    beforeAll(async () => {
        mongo = await createReplSetMongo();
        emailMock = {
            sendProfileCompletionReminder: jest
                .fn()
                .mockResolvedValue(undefined),
            sendProfileCompletionFinalWarning: jest
                .fn()
                .mockResolvedValue(undefined),
        };

        moduleRef = await Test.createTestingModule({
            imports: [
                MongooseModule.forRoot(mongo.uri),
                MongooseModule.forFeature([
                    { name: User.name, schema: UserSchema },
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
                        name: InvoiceSlugHistory.name,
                        schema: InvoiceSlugHistorySchema,
                    },
                    {
                        name: InvoiceSlugCounter.name,
                        schema: InvoiceSlugCounterSchema,
                    },
                ]),
            ],
            providers: [
                UsersService,
                BusinessesService,
                OrphanProfileCleanupService,
                {
                    provide: SlugGeneratorService,
                    useValue: { generateRandomSlug: jest.fn() },
                },
                {
                    // Orphan-cleanup лок не використовує — pass-through stub.
                    provide: RedisLockService,
                    useValue: {
                        withLock: async (
                            _key: string,
                            _ttlMs: number,
                            fn: () => Promise<unknown>
                        ) => fn(),
                    },
                },
                {
                    // Orphan-cleanup броні не торкається — stub.
                    provide: SlugReservationService,
                    useValue: {
                        isNameHeldByOther: jest.fn().mockResolvedValue(false),
                        reserve: jest.fn(),
                        consumeForUser: jest.fn().mockResolvedValue(undefined),
                        getActiveForUser: jest.fn().mockResolvedValue(null),
                    },
                },
                { provide: EmailService, useValue: emailMock },
            ],
        }).compile();

        service = moduleRef.get(OrphanProfileCleanupService);
        businessesService = moduleRef.get(BusinessesService);
        userModel = moduleRef.get(getModelToken(User.name));
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
        await Promise.all([
            userModel.deleteMany({}),
            businessModel.deleteMany({}),
            accountModel.deleteMany({}),
            invoiceModel.deleteMany({}),
            counterModel.deleteMany({}),
        ]);
        emailMock.sendProfileCompletionReminder.mockClear();
        emailMock.sendProfileCompletionReminder.mockResolvedValue(undefined);
        emailMock.sendProfileCompletionFinalWarning.mockClear();
        emailMock.sendProfileCompletionFinalWarning.mockResolvedValue(
            undefined
        );
    });

    async function seedUser(opts: {
        firstName?: string;
        lastName?: string;
        firstReminderSentAt?: Date | null;
        finalWarningSentAt?: Date | null;
        pendingPostLoginTarget?: string;
        deletedAt?: Date | null;
    }): Promise<UserDocument> {
        const user = await userModel.create({
            email: `user-${new Types.ObjectId().toString()}@example.com`,
            profile: {
                firstName: opts.firstName,
                lastName: opts.lastName,
            },
            profileCompletionReminders: {
                firstReminderSentAt: opts.firstReminderSentAt ?? null,
                finalWarningSentAt: opts.finalWarningSentAt ?? null,
            },
            pendingPostLoginTarget: opts.pendingPostLoginTarget,
            deletedAt: opts.deletedAt ?? null,
        });
        return user;
    }

    let taxIdSeq = 0;
    async function seedBusinessWithBackdatedCreatedAt(opts: {
        ownerId: Types.ObjectId;
        name: string;
        createdAt: Date;
    }): Promise<BusinessDocument> {
        const slug = `Biz${new Types.ObjectId().toString().slice(-6)}`;
        const business = await businessModel.create({
            type: 'fop',
            ownerId: opts.ownerId,
            managers: [],
            slug,
            slugLower: slug.toLowerCase(),
            name: opts.name,
            // Унікальний per-seed: partial-unique `(ownerId, taxId, type)`
            // інакше валить сідінг другого fop-бізнесу того самого власника.
            taxId: String(1000000000 + taxIdSeq++),
            taxationSystem: 'simplified-3',
            isVatPayer: false,
            paymentPurposeTemplate: 'Оплата',
            seoIndexEnabled: false,
        });
        await businessModel.collection.updateOne(
            { _id: business._id },
            { $set: { createdAt: opts.createdAt } }
        );
        business.createdAt = opts.createdAt;
        return business;
    }

    async function seedAccountAndInvoice(business: BusinessDocument): Promise<{
        account: AccountDocument;
        invoice: InvoiceDocument;
    }> {
        const ibanSuffix = new Types.ObjectId().toString().slice(-9);
        const account = await accountModel.create({
            businessId: business._id,
            iban: `UA21322313000002600723${ibanSuffix}`,
            bankCode: 'privatbank',
            name: 'Privat',
            slug: `acc${ibanSuffix.slice(-6)}`,
            slugLower: `acc${ibanSuffix.slice(-6)}`.toLowerCase(),
        });
        const invoice = await invoiceModel.create({
            businessId: business._id,
            accountId: account._id,
            slug: `inv-${ibanSuffix}`,
            slugLower: `inv-${ibanSuffix}`.toLowerCase(),
            slugPreset: 'simple',
            slugCounterScope: 'simple',
            slugCounter: 1,
            amount: 150000,
            amountLocked: true,
            paymentPurpose: 'Оплата',
            validUntil: null,
            deletedAt: null,
        });
        return { account, invoice };
    }

    async function reloadUserReminders(
        userId: Types.ObjectId
    ): Promise<{ first: Date | null; final: Date | null }> {
        const user = await userModel.findById(userId).lean();
        if (!user) throw new Error('User not found');
        return {
            first: user.profileCompletionReminders.firstReminderSentAt,
            final: user.profileCompletionReminders.finalWarningSentAt,
        };
    }

    it('Stage 1 fires when age=1 day and both stamps null (default schedule 1/6/7)', async () => {
        const user = await seedUser({ firstName: '', lastName: '' });
        await seedBusinessWithBackdatedCreatedAt({
            ownerId: user._id,
            name: 'ФОП Іваненко',
            createdAt: new Date(Date.now() - 1.1 * DAY_MS),
        });

        await service.runDailyCleanup();

        expect(emailMock.sendProfileCompletionReminder).toHaveBeenCalledTimes(
            1
        );
        expect(
            emailMock.sendProfileCompletionFinalWarning
        ).not.toHaveBeenCalled();
        expect(emailMock.sendProfileCompletionReminder).toHaveBeenCalledWith({
            user: { email: user.email },
            businesses: [{ name: 'ФОП Іваненко' }],
        });

        const stamps = await reloadUserReminders(user._id);
        expect(stamps.first).toBeInstanceOf(Date);
        expect(stamps.final).toBeNull();
    });

    it('Stage 2 fires when age=6 days, firstReminderSentAt set, finalWarningSentAt null', async () => {
        const user = await seedUser({
            firstName: '',
            lastName: '',
            firstReminderSentAt: new Date(Date.now() - 5 * DAY_MS),
        });
        await seedBusinessWithBackdatedCreatedAt({
            ownerId: user._id,
            name: 'ФОП Іваненко',
            createdAt: new Date(Date.now() - 6.1 * DAY_MS),
        });

        await service.runDailyCleanup();

        expect(emailMock.sendProfileCompletionReminder).not.toHaveBeenCalled();
        expect(
            emailMock.sendProfileCompletionFinalWarning
        ).toHaveBeenCalledTimes(1);

        const stamps = await reloadUserReminders(user._id);
        expect(stamps.first).toBeInstanceOf(Date);
        expect(stamps.final).toBeInstanceOf(Date);
    });

    it('Stage 3 cascade-deletes businesses and resets reminders + pendingPostLoginTarget on full success', async () => {
        const user = await seedUser({
            firstName: '',
            lastName: '',
            firstReminderSentAt: new Date(Date.now() - 6 * DAY_MS),
            finalWarningSentAt: new Date(Date.now() - 1 * DAY_MS),
            pendingPostLoginTarget: '/business/biz/account/acc',
        });
        const business = await seedBusinessWithBackdatedCreatedAt({
            ownerId: user._id,
            name: 'ФОП Іваненко',
            createdAt: new Date(Date.now() - 7.1 * DAY_MS),
        });
        await seedAccountAndInvoice(business);

        await service.runDailyCleanup();

        expect(emailMock.sendProfileCompletionReminder).not.toHaveBeenCalled();
        expect(
            emailMock.sendProfileCompletionFinalWarning
        ).not.toHaveBeenCalled();

        expect(await businessModel.countDocuments({ ownerId: user._id })).toBe(
            0
        );
        expect(await accountModel.countDocuments({})).toBe(0);
        expect(await invoiceModel.countDocuments({})).toBe(0);

        const reloaded = await userModel.findById(user._id).lean();
        expect(reloaded).not.toBeNull();
        expect(reloaded!.profileCompletionReminders).toEqual({
            firstReminderSentAt: null,
            finalWarningSentAt: null,
        });
        expect(reloaded!.pendingPostLoginTarget).toBeUndefined();
    });

    it('Post-downtime resilience: age=10 days + both stamps null → ONLY Stage 1 fires', async () => {
        const user = await seedUser({ firstName: '', lastName: '' });
        await seedBusinessWithBackdatedCreatedAt({
            ownerId: user._id,
            name: 'ФОП Іваненко',
            createdAt: new Date(Date.now() - 10 * DAY_MS),
        });

        await service.runDailyCleanup();

        expect(emailMock.sendProfileCompletionReminder).toHaveBeenCalledTimes(
            1
        );
        expect(
            emailMock.sendProfileCompletionFinalWarning
        ).not.toHaveBeenCalled();
        expect(await businessModel.countDocuments({ ownerId: user._id })).toBe(
            1
        );

        const stamps = await reloadUserReminders(user._id);
        expect(stamps.first).toBeInstanceOf(Date);
        expect(stamps.final).toBeNull();
    });

    it('Stage 3 partial-cascade failure: 1 business deleted, reminders NOT reset', async () => {
        const user = await seedUser({
            firstName: '',
            lastName: '',
            firstReminderSentAt: new Date(Date.now() - 6 * DAY_MS),
            finalWarningSentAt: new Date(Date.now() - 1 * DAY_MS),
        });
        const bizA = await seedBusinessWithBackdatedCreatedAt({
            ownerId: user._id,
            name: 'BizA',
            createdAt: new Date(Date.now() - 8 * DAY_MS),
        });
        const bizB = await seedBusinessWithBackdatedCreatedAt({
            ownerId: user._id,
            name: 'BizB',
            createdAt: new Date(Date.now() - 7.1 * DAY_MS),
        });

        const deleteSpy = jest
            .spyOn(businessesService, 'delete')
            .mockImplementationOnce(async (b) => {
                await businessModel.deleteOne({ _id: b._id });
                return { affectedAccounts: 0, affectedInvoices: 0 };
            })
            .mockImplementationOnce(async () => {
                throw new Error('Simulated cascade failure mid-loop');
            });

        await service.runDailyCleanup();

        const remaining = await businessModel
            .find({ ownerId: user._id })
            .lean();
        expect(remaining).toHaveLength(1);
        expect(remaining[0]._id.toString()).toBe(bizB._id.toString());

        const stamps = await reloadUserReminders(user._id);
        expect(stamps.first).toBeInstanceOf(Date);
        expect(stamps.final).toBeInstanceOf(Date);

        deleteSpy.mockRestore();
        // bizA reference kept implicit-strict via deleteSpy ordering.
        void bizA;
    });

    it('Email-send failure on Stage 1 → resetSingleStamp reverts firstReminderSentAt to null', async () => {
        const user = await seedUser({ firstName: '', lastName: '' });
        await seedBusinessWithBackdatedCreatedAt({
            ownerId: user._id,
            name: 'ФОП Іваненко',
            createdAt: new Date(Date.now() - 1.1 * DAY_MS),
        });
        emailMock.sendProfileCompletionReminder.mockRejectedValueOnce(
            new Error('Resend rate-limit exceeded')
        );

        await service.runDailyCleanup();

        expect(emailMock.sendProfileCompletionReminder).toHaveBeenCalledTimes(
            1
        );

        const stamps = await reloadUserReminders(user._id);
        expect(stamps.first).toBeNull();
        expect(stamps.final).toBeNull();
    });

    it('Completed-profile user with orphan business is skipped (sanity)', async () => {
        const user = await seedUser({
            firstName: 'Олег',
            lastName: 'Хрістенко',
        });
        await seedBusinessWithBackdatedCreatedAt({
            ownerId: user._id,
            name: 'ФОП Хрістенко',
            createdAt: new Date(Date.now() - 7.1 * DAY_MS),
        });

        await service.runDailyCleanup();

        expect(emailMock.sendProfileCompletionReminder).not.toHaveBeenCalled();
        expect(
            emailMock.sendProfileCompletionFinalWarning
        ).not.toHaveBeenCalled();
        expect(await businessModel.countDocuments({ ownerId: user._id })).toBe(
            1
        );
    });

    it('User with incomplete profile but no businesses is skipped (no candidates)', async () => {
        await seedUser({ firstName: '', lastName: '' });

        await service.runDailyCleanup();

        expect(emailMock.sendProfileCompletionReminder).not.toHaveBeenCalled();
        expect(
            emailMock.sendProfileCompletionFinalWarning
        ).not.toHaveBeenCalled();
    });

    it('Per-candidate isolation: throw in one Stage 3 does not abort subsequent candidates', async () => {
        const userA = await seedUser({
            firstName: '',
            lastName: '',
            firstReminderSentAt: new Date(Date.now() - 6 * DAY_MS),
            finalWarningSentAt: new Date(Date.now() - 1 * DAY_MS),
        });
        await seedBusinessWithBackdatedCreatedAt({
            ownerId: userA._id,
            name: 'BizA',
            createdAt: new Date(Date.now() - 7.1 * DAY_MS),
        });

        const userB = await seedUser({ firstName: '', lastName: '' });
        await seedBusinessWithBackdatedCreatedAt({
            ownerId: userB._id,
            name: 'BizB',
            createdAt: new Date(Date.now() - 1.1 * DAY_MS),
        });

        const deleteSpy = jest
            .spyOn(businessesService, 'delete')
            .mockRejectedValueOnce(
                new Error('Transient Mongo failure during cascade')
            );

        await service.runDailyCleanup();

        expect(await businessModel.countDocuments({ ownerId: userA._id })).toBe(
            1
        );
        expect(emailMock.sendProfileCompletionReminder).toHaveBeenCalledTimes(
            1
        );
        expect(emailMock.sendProfileCompletionReminder).toHaveBeenCalledWith({
            user: { email: userB.email },
            businesses: [{ name: 'BizB' }],
        });

        const stampsB = await reloadUserReminders(userB._id);
        expect(stampsB.first).toBeInstanceOf(Date);

        deleteSpy.mockRestore();
    });
});
