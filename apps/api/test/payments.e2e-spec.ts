import { Test, TestingModule } from '@nestjs/testing';
import { Global, INestApplication, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import * as supertest from 'supertest';
import { App } from 'supertest/types';
import { ZodValidationPipe } from 'nestjs-zod';
import { Model, Types } from 'mongoose';
import {
    BILLING_UNIVERSE,
    CURRENT_TERMS_VERSION,
    MONOBANK_INVOICE_STATUS,
    PAYMENT_RECORD_STATUS,
    PAYMENT_RECORD_TYPE,
    SUBSCRIPTION_STATUS,
    type BillingWebhookEvent,
} from '@finly/types';

import { createReplSetMongo } from '../src/test-utils/mongo';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { REDIS_CLIENT } from '../src/common/modules/redis.module';
import { RedisCounterService } from '../src/common/services/redis-counter.service';
import { RedisLockService } from '../src/common/services/redis-lock.service';
import { AuthModule } from '../src/modules/auth/auth.module';
import { BusinessesModule } from '../src/modules/businesses/businesses.module';
import { EmailModule } from '../src/modules/email/email.module';
import { EmailService } from '../src/modules/email/email.service';
import { QrModule } from '../src/modules/qr/qr.module';
import { StorageModule } from '../src/modules/storage/storage.module';
import { UsersModule } from '../src/modules/users/users.module';
import { PaymentsModule } from '../src/modules/payments/payments.module';
import { BillingProfileService } from '../src/modules/payments/billing-profile.service';
import { BillingClockService } from '../src/modules/payments/billing-clock.service';
import { PaymentsCleanupService } from '../src/modules/payments/payments-cleanup.service';
import { ReconciliationService } from '../src/modules/businesses/reconciliation.service';
import {
    PAYMENT_PROVIDER,
    ProviderRequestError,
} from '../src/modules/payments/interfaces/payment-provider.interface';
import { User, UserDocument } from '../src/modules/users/schemas/user.schema';
import {
    Business,
    BusinessDocument,
} from '../src/modules/businesses/schemas/business.schema';
import {
    BillingProfile,
    BillingProfileDocument,
} from '../src/modules/payments/schemas/billing-profile.schema';
import {
    PaymentRecord,
    PaymentRecordDocument,
} from '../src/modules/payments/schemas/payment-record.schema';

jest.mock('../src/config/env', () => ({
    ENV: {
        NODE_ENV: 'test',
        PORT: '4000',
        WEB_URL: 'https://finly.com.ua',
        PAY_PUBLIC_URL: 'https://pay.finly.com.ua',
        MONGODB_URI: 'overridden-by-MongoMemoryReplSet',
        REDIS_URL: 'redis://mock',
        JWT_ACCESS_SECRET: 'e2e-access-secret-must-be-long-enough',
        JWT_REFRESH_SECRET: 'e2e-refresh-secret-must-be-long-enough',
        GOOGLE_CLIENT_ID: 'test-id.apps.googleusercontent.com',
        GOOGLE_CLIENT_SECRET: 'GOCSPX-test',
        GOOGLE_CALLBACK_URL: 'http://localhost:4000/api/auth/google/callback',
        RESEND_API_KEY: 're_test',
        RESEND_FROM_EMAIL: 'Finly <test@test.com>',
        MONOBANK_TOKEN: 'test-monobank-token',
        BILLING_DEMO_MODE: false,
        BILLING_DUNNING_MAX_ATTEMPTS: 4,
        BILLING_DUNNING_RETRY_INTERVAL_HOURS: 48,
        BILLING_BRAND_ENABLED: true,
        BILLING_DOCUMENTS_ENABLED: false,
        BILLING_GRID: {
            currency: 'UAH',
            brand: { pricePerBusiness: 4900 },
            documents: {
                tiers: [
                    { size: 1, priceAmount: 29900, monthlyCredits: 1000 },
                    { size: 5, priceAmount: 149500, monthlyCredits: 5000 },
                ],
                storageGbPerBusiness: 5,
                storageRentCreditsPerGb: 10,
                creditPacks: [{ credits: 500, priceAmount: 15000 }],
                lowBalanceThreshold: 200,
                criticalBalanceThreshold: 100,
            },
        },
        AUTH_LOCKOUT_THRESHOLDS: '5:1,10:5,20:15',
        AUTH_LOGIN_ATTEMPTS_TTL_MIN: 15,
        AUTH_MAGIC_LINK_TTL_MIN: 15,
        AUTH_MAGIC_LINK_RATE_LIMIT: 3,
        AUTH_MAGIC_LINK_RATE_WINDOW_MIN: 15,
        AUTH_MAGIC_LINK_DEDUP_SEC: 60,
        ACCOUNT_DELETION_GRACE_DAYS: 30,
        AUTH_PASSWORD_MIN_LENGTH: 8,
        R2_ACCOUNT_ID: 'test-account',
        R2_ACCESS_KEY_ID: 'test-key-id',
        R2_SECRET_ACCESS_KEY: 'test-secret',
        R2_BUCKET_NAME: 'test-bucket',
        R2_PUBLIC_URL: 'https://media.test.local',
    },
    parseLockoutThresholds: (raw: string) =>
        raw.split(',').map((entry: string) => {
            const [attempts, blockMin] = entry.split(':').map(Number);
            return { attempts, blockMin };
        }),
}));

@Global()
@Module({
    providers: [
        { provide: REDIS_CLIENT, useFactory: () => createRedisMock() },
        {
            provide: RedisCounterService,
            useValue: {
                incrementFixed: jest.fn(async () => 1),
                incrementSliding: jest.fn(async () => 1),
            },
        },
        {
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
    exports: [REDIS_CLIENT, RedisCounterService, RedisLockService],
})
class TestRedisModule {}

function createRedisMock() {
    const store = new Map<string, string>();
    return {
        async get(key: string) {
            return store.get(key) ?? null;
        },
        async set(key: string, value: string) {
            store.set(key, value);
            return 'OK';
        },
        async del(key: string) {
            store.delete(key);
            return 1;
        },
        async getdel(key: string) {
            const v = store.get(key) ?? null;
            if (v !== null) store.delete(key);
            return v;
        },
        async expire() {
            return 1;
        },
        async smembers() {
            return [];
        },
        eval() {
            return 0;
        },
    };
}

// Контрольований фейк провайдера: тести задають chargeByToken / parseWebhook /
// getInvoiceStatus, решта — sensible defaults.
const providerMock = {
    createSubscriptionCheckout: jest.fn(
        async (i: { orderReference: string }) => ({
            checkoutUrl: `https://pay.mbnk.biz/${i.orderReference}`,
            invoiceId: `inv_${i.orderReference}`,
            orderReference: i.orderReference,
        })
    ),
    createOneOffCheckout: jest.fn(async (i: { orderReference: string }) => ({
        checkoutUrl: `https://pay.mbnk.biz/${i.orderReference}`,
        invoiceId: `inv_${i.orderReference}`,
        orderReference: i.orderReference,
    })),
    chargeByToken: jest.fn(),
    getInvoiceStatus: jest.fn(),
    parseWebhook: jest.fn(),
};

const emailMock = {
    sendMagicLink: jest.fn().mockResolvedValue(undefined),
    sendDeletionConfirmation: jest.fn().mockResolvedValue(undefined),
    sendSubscriptionPastDue: jest.fn().mockResolvedValue(undefined),
    sendSubscriptionEnded: jest.fn().mockResolvedValue(undefined),
};

describe('Payments E2E (Sprint 27 — два всесвіти)', () => {
    let app: INestApplication<App>;
    let mongo: Awaited<ReturnType<typeof createReplSetMongo>>;
    let userModel: Model<UserDocument>;
    let businessModel: Model<BusinessDocument>;
    let profileModel: Model<BillingProfileDocument>;
    let paymentRecordModel: Model<PaymentRecordDocument>;
    let billing: BillingProfileService;
    let jwtService: JwtService;

    beforeAll(async () => {
        mongo = await createReplSetMongo();
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ isGlobal: true }),
                ThrottlerModule.forRoot({
                    throttlers: [{ ttl: 60000, limit: 600 }],
                }),
                MongooseModule.forRoot(mongo.uri),
                TestRedisModule,
                AuthModule,
                EmailModule,
                UsersModule,
                StorageModule,
                BusinessesModule,
                QrModule,
                PaymentsModule,
            ],
            providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
        })
            .overrideProvider(EmailService)
            .useValue(emailMock)
            .overrideProvider(PAYMENT_PROVIDER)
            .useValue(providerMock)
            .compile();

        app = moduleFixture.createNestApplication({ rawBody: true });
        app.setGlobalPrefix('api');
        app.useGlobalPipes(new ZodValidationPipe());
        app.useGlobalFilters(new AllExceptionsFilter());
        await app.init();

        userModel = moduleFixture.get(getModelToken(User.name));
        businessModel = moduleFixture.get(getModelToken(Business.name));
        profileModel = moduleFixture.get(getModelToken(BillingProfile.name));
        paymentRecordModel = moduleFixture.get(
            getModelToken(PaymentRecord.name)
        );
        billing = moduleFixture.get(BillingProfileService);
        jwtService = moduleFixture.get(JwtService);
    }, 60_000);

    afterAll(async () => {
        await app.close();
        await mongo.stop();
    });

    beforeEach(async () => {
        await Promise.all([
            userModel.deleteMany({}),
            businessModel.deleteMany({}),
            profileModel.deleteMany({}),
            paymentRecordModel.deleteMany({}),
        ]);
        jest.clearAllMocks();
    });

    // ─── Helpers ───

    async function createUser(): Promise<UserDocument> {
        return userModel.create({
            email: `user-${new Types.ObjectId().toString()}@test.com`,
            profile: { firstName: 'Test', lastName: 'User' },
            worksAsBookkeeper: false,
            termsVersion: CURRENT_TERMS_VERSION,
        });
    }

    async function createBusiness(
        user: UserDocument,
        over: Record<string, unknown> = {}
    ): Promise<BusinessDocument> {
        return businessModel.create({
            type: 'fop',
            ownerId: user._id,
            managers: [],
            slug: `biz-${new Types.ObjectId().toString().slice(0, 8)}`,
            slugLower: `biz-${new Types.ObjectId().toString().slice(0, 8)}`,
            name: 'ФОП Тест',
            taxId: '1234567899',
            taxationSystem: 'simplified-3',
            isVatPayer: false,
            paymentPurposeTemplate: 'Оплата',
            ...over,
        });
    }

    function bearerFor(user: UserDocument): string {
        return `Bearer ${jwtService.sign(
            { sub: user._id.toString(), email: user.email },
            { secret: 'e2e-access-secret-must-be-long-enough' }
        )}`;
    }

    /** Активний профіль з токеном і повним циклом (для renew/cancel/capacity). */
    async function seedActiveProfile(
        user: UserDocument,
        over: Record<string, unknown> = {}
    ): Promise<BillingProfileDocument> {
        const now = new Date();
        const start = new Date(now.getTime() - 15 * 24 * 3600 * 1000);
        const end = new Date(now.getTime() + 15 * 24 * 3600 * 1000);
        return profileModel.create({
            userId: user._id,
            provider: 'monobank',
            cardToken: 'tok-1',
            walletId: user._id.toString(),
            cardMask: '** 1111',
            currency: 'UAH',
            status: SUBSCRIPTION_STATUS.ACTIVE,
            currentPeriodStart: start,
            currentPeriodEnd: end,
            nextChargeAt: end,
            cancelAtPeriodEnd: false,
            brand: { capacity: 1, attachedBusinessIds: [] },
            documents: { tierSize: null, attachedBusinessIds: [] },
            ...over,
        });
    }

    function makeEvent(
        over: Partial<BillingWebhookEvent> & { orderReference: string }
    ): BillingWebhookEvent {
        return {
            providerEventId: `${over.invoiceId ?? 'inv_x'}:success`,
            invoiceId: 'inv_x',
            occurredAt: new Date(),
            status: MONOBANK_INVOICE_STATUS.SUCCESS,
            amount: 4900,
            currency: 'UAH',
            cardToken: 'tok-1',
            cardMask: '** 1111',
            failureReason: null,
            errCode: null,
            raw: {},
            ...over,
        };
    }

    async function postWebhook(event: BillingWebhookEvent): Promise<void> {
        providerMock.parseWebhook.mockResolvedValueOnce({ event });
        await supertest(app.getHttpServer())
            .post('/api/payments/webhook/monobank')
            .set('x-sign', 'sig')
            .send({ any: 'body' })
            .expect(200);
    }

    // ─── Catalog ───

    it('GET /catalog — два всесвіти з сітки, Документи вимкнені прапором', async () => {
        const res = await supertest(app.getHttpServer())
            .get('/api/payments/catalog')
            .expect(200);
        const data = (
            res.body as {
                data: {
                    brand: { enabled: boolean; pricePerBusiness: number };
                    documents: { enabled: boolean; tiers: unknown[] };
                };
            }
        ).data;
        expect(data.brand.enabled).toBe(true);
        expect(data.brand.pricePerBusiness).toBe(4900);
        expect(data.documents.enabled).toBe(false);
        expect(data.documents.tiers).toHaveLength(2);
    });

    // ─── First purchase → activation via webhook ───

    it('checkout Бренд + attach → webhook success активує профіль і брендує бізнес', async () => {
        const user = await createUser();
        const business = await createBusiness(user);

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/checkout')
            .set('Authorization', bearerFor(user))
            .send({
                universe: BILLING_UNIVERSE.BRAND,
                capacity: 1,
                attachBusinessId: business._id.toString(),
            })
            .expect(201);
        expect(
            (res.body as { data: { checkoutUrl: string } }).data.checkoutUrl
        ).toContain('pay.mbnk.biz');

        // Профіль INCOMPLETE, бізнес ще не брендований.
        const incomplete = await profileModel.findOne({ userId: user._id });
        expect(incomplete?.status).toBe(SUBSCRIPTION_STATUS.INCOMPLETE);
        expect(
            (await businessModel.findById(business._id))?.brandedAt
        ).toBeNull();

        // Вебхук success за checkout-reference (беремо з виклику провайдера).
        const orderReference =
            providerMock.createSubscriptionCheckout.mock.calls[0][0]
                .orderReference;
        await postWebhook(
            makeEvent({ orderReference, invoiceId: 'inv_chk', amount: 4900 })
        );

        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.status).toBe(SUBSCRIPTION_STATUS.ACTIVE);
        expect(profile?.brand.capacity).toBe(1);
        expect(profile?.cardToken).toBe('tok-1');
        expect(profile?.currentPeriodEnd).toBeTruthy();

        const branded = await businessModel.findById(business._id);
        expect(branded?.brandedAt).toBeTruthy();
    });

    it('checkout при живому профілі (скасований, без токена) → 409, склади не зачеплені', async () => {
        // cancel занулює токен, але період оплачено (статус ACTIVE): повторний
        // checkout НЕ має зносити склади і доступ — лише 409 ALREADY_ACTIVE.
        const user = await createUser();
        const business = await createBusiness(user);
        await seedActiveProfile(user, {
            cardToken: null,
            cancelAtPeriodEnd: true,
            nextChargeAt: null,
            brand: { capacity: 2, attachedBusinessIds: [business._id] },
        });

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/checkout')
            .set('Authorization', bearerFor(user))
            .send({ universe: BILLING_UNIVERSE.BRAND, capacity: 1 })
            .expect(409);
        expect((res.body as { error: { code: string } }).error.code).toBe(
            'BILLING_ALREADY_ACTIVE'
        );

        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.status).toBe(SUBSCRIPTION_STATUS.ACTIVE);
        expect(profile?.brand.capacity).toBe(2);
        expect(profile?.brand.attachedBusinessIds).toHaveLength(1);
    });

    it('checkout на скасованому профілі з простроченим періодом → профіль гаситься, checkout проходить', async () => {
        // Скасований профіль після межі періоду фактично згаслий і лише чекає
        // cron-згасання: повторна купівля не мусить блокуватись 409 до крону.
        const user = await createUser();
        const business = await createBusiness(user);
        const now = new Date();
        await seedActiveProfile(user, {
            cardToken: null,
            cancelAtPeriodEnd: true,
            nextChargeAt: null,
            currentPeriodStart: new Date(now.getTime() - 45 * 24 * 3600 * 1000),
            currentPeriodEnd: new Date(now.getTime() - 24 * 3600 * 1000),
            brand: { capacity: 2, attachedBusinessIds: [business._id] },
        });
        await businessModel.updateOne(
            { _id: business._id },
            { $set: { brandedAt: new Date() } }
        );

        await supertest(app.getHttpServer())
            .post('/api/payments/checkout')
            .set('Authorization', bearerFor(user))
            .send({ universe: BILLING_UNIVERSE.BRAND, capacity: 1 })
            .expect(201);

        // Старий профіль погашено (бренд-фічі згасли реконсиляцією), новий
        // checkout переписав його у INCOMPLETE з бажаним складом.
        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.status).toBe(SUBSCRIPTION_STATUS.INCOMPLETE);
        expect(profile?.brand.capacity).toBe(1);
        expect(profile?.brand.attachedBusinessIds).toHaveLength(0);
        expect(
            (await businessModel.findById(business._id))?.brandedAt
        ).toBeNull();
    });

    it('attach на неоплаченому (INCOMPLETE) профілі → 400 NO_ACTIVE_SUBSCRIPTION', async () => {
        const user = await createUser();
        const business = await createBusiness(user);
        await seedActiveProfile(user, {
            status: SUBSCRIPTION_STATUS.INCOMPLETE,
            cardToken: null,
            nextChargeAt: null,
            brand: { capacity: 1, attachedBusinessIds: [] },
        });

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/attach')
            .set('Authorization', bearerFor(user))
            .send({
                universe: BILLING_UNIVERSE.BRAND,
                businessId: business._id.toString(),
            })
            .expect(400);
        expect((res.body as { error: { code: string } }).error.code).toBe(
            'NO_ACTIVE_SUBSCRIPTION'
        );
    });

    it('checkout документного всесвіту під прапором → 400 BILLING_UNIVERSE_DISABLED', async () => {
        const user = await createUser();
        const res = await supertest(app.getHttpServer())
            .post('/api/payments/checkout')
            .set('Authorization', bearerFor(user))
            .send({ universe: BILLING_UNIVERSE.DOCUMENTS, tierSize: 1 })
            .expect(400);
        expect((res.body as { error: { code: string } }).error.code).toBe(
            'BILLING_UNIVERSE_DISABLED'
        );
    });

    // ─── Cycle renewal (billing-clock) ───

    it('cycle renewal: chargeByToken success → період просунуто, запис CYCLE approved', async () => {
        const user = await createUser();
        const profile = await seedActiveProfile(user, {
            currentPeriodEnd: new Date(Date.now() - 1000),
            nextChargeAt: new Date(Date.now() - 1000),
        });
        const boundary = profile.currentPeriodEnd!;
        providerMock.chargeByToken.mockResolvedValueOnce({
            invoiceId: 'inv_cyc',
            status: MONOBANK_INVOICE_STATUS.SUCCESS,
            cardMask: '** 1111',
            cardToken: 'tok-1',
            failureReason: null,
            errCode: null,
        });

        await billing.chargeDueCycle(user._id.toString());

        const updated = await profileModel.findOne({ userId: user._id });
        expect(updated?.currentPeriodEnd!.getTime()).toBeGreaterThan(
            boundary.getTime()
        );
        const record = await paymentRecordModel.findOne({
            userId: user._id,
            type: PAYMENT_RECORD_TYPE.CYCLE,
        });
        expect(record?.status).toBe(PAYMENT_RECORD_STATUS.APPROVED);
    });

    it('cycle renewal: chargeByToken decline → PAST_DUE + dunning', async () => {
        const user = await createUser();
        await seedActiveProfile(user, {
            currentPeriodEnd: new Date(Date.now() - 1000),
            nextChargeAt: new Date(Date.now() - 1000),
        });
        providerMock.chargeByToken.mockResolvedValueOnce({
            invoiceId: 'inv_dec',
            status: MONOBANK_INVOICE_STATUS.FAILURE,
            cardMask: '** 1111',
            cardToken: null,
            failureReason: 'declined',
            errCode: null,
        });

        await billing.chargeDueCycle(user._id.toString());

        const updated = await profileModel.findOne({ userId: user._id });
        expect(updated?.status).toBe(SUBSCRIPTION_STATUS.PAST_DUE);
        expect(updated?.dunningAttempts).toBe(1);
        expect(updated?.nextRetryAt).toBeTruthy();
    });

    // ─── Cancel ───

    it('POST /subscription/cancel → cancelAtPeriodEnd, токен стерто', async () => {
        const user = await createUser();
        await seedActiveProfile(user);
        await supertest(app.getHttpServer())
            .post('/api/payments/subscription/cancel')
            .set('Authorization', bearerFor(user))
            .expect(200);

        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.cancelAtPeriodEnd).toBe(true);
        expect(profile?.cardToken).toBeNull();
        expect(profile?.nextChargeAt).toBeNull();
    });

    it('POST /capacity на скасованому профілі → 400 BILLING_CANCEL_PENDING, без списання', async () => {
        // Скасований-до-кінця-періоду профіль: доступ живий, токен стерто.
        // Платна зміна ємності мусить діставати чесний код (не «немає картки,
        // оформіть першу оплату», бо checkout на entitled-профілі — 409).
        const user = await createUser();
        await seedActiveProfile(user, {
            cardToken: null,
            cancelAtPeriodEnd: true,
            nextChargeAt: null,
            brand: { capacity: 1, attachedBusinessIds: [] },
        });

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/capacity')
            .set('Authorization', bearerFor(user))
            .send({ universe: BILLING_UNIVERSE.BRAND, capacity: 2 })
            .expect(400);
        expect((res.body as { error: { code: string } }).error.code).toBe(
            'BILLING_CANCEL_PENDING'
        );
        expect(providerMock.chargeByToken).not.toHaveBeenCalled();
        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.brand.capacity).toBe(1);
    });

    // ─── Credit packs (докупівля) ───

    it('POST /credits/buy за значенням пакета → списання, баланс поповнено, пакети у view', async () => {
        const user = await createUser();
        await seedActiveProfile(user, {
            documents: { tierSize: 1, attachedBusinessIds: [] },
        });
        providerMock.chargeByToken.mockResolvedValueOnce({
            invoiceId: 'inv_crd',
            status: MONOBANK_INVOICE_STATUS.SUCCESS,
            cardMask: '** 1111',
            cardToken: null,
            failureReason: null,
            errCode: null,
        });

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/credits/buy')
            .set('Authorization', bearerFor(user))
            .send({ credits: 500, priceAmount: 15000 })
            .expect(200);
        expect((res.body as { data: { charged: number } }).data.charged).toBe(
            15000
        );
        expect(providerMock.chargeByToken.mock.calls[0][0].amount).toBe(15000);

        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.documents.credits.balance).toBe(500);
        const record = await paymentRecordModel.findOne({
            userId: user._id,
            type: PAYMENT_RECORD_TYPE.CREDIT_PACK,
        });
        expect(record?.status).toBe(PAYMENT_RECORD_STATUS.APPROVED);

        // Профіль — єдина точка, де клієнт бачить приховані пакети докупівлі
        // (каталог їх навмисно не містить).
        const view = await supertest(app.getHttpServer())
            .get('/api/payments/profile')
            .set('Authorization', bearerFor(user))
            .expect(200);
        expect(
            (
                view.body as {
                    data: {
                        documents: {
                            creditPacks: Array<{
                                credits: number;
                                priceAmount: number;
                            }>;
                        };
                    };
                }
            ).data.documents.creditPacks
        ).toEqual([{ credits: 500, priceAmount: 15000 }]);
    });

    it('POST /credits/buy зі старою ціною (сітка змінилась) → 400 INVALID_CREDIT_PACK, без списання', async () => {
        const user = await createUser();
        await seedActiveProfile(user, {
            documents: { tierSize: 1, attachedBusinessIds: [] },
        });

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/credits/buy')
            .set('Authorization', bearerFor(user))
            .send({ credits: 500, priceAmount: 9900 })
            .expect(400);
        expect((res.body as { error: { code: string } }).error.code).toBe(
            'INVALID_CREDIT_PACK'
        );
        expect(providerMock.chargeByToken).not.toHaveBeenCalled();
        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.documents.credits.balance).toBe(0);
    });

    // ─── Capacity increase (proration) ───

    it('POST /capacity збільшення Бренду → пропорційна доплата за токеном, ємність зросла', async () => {
        const user = await createUser();
        await seedActiveProfile(user, {
            brand: { capacity: 1, attachedBusinessIds: [] },
        });
        providerMock.chargeByToken.mockResolvedValueOnce({
            invoiceId: 'inv_pro',
            status: MONOBANK_INVOICE_STATUS.SUCCESS,
            cardMask: '** 1111',
            cardToken: null,
            failureReason: null,
            errCode: null,
        });

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/capacity')
            .set('Authorization', bearerFor(user))
            .send({ universe: BILLING_UNIVERSE.BRAND, capacity: 2 })
            .expect(200);

        expect(
            (res.body as { data: { immediateCharge: number } }).data
                .immediateCharge
        ).toBeGreaterThan(0);
        expect(providerMock.chargeByToken).toHaveBeenCalledTimes(1);
        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.brand.capacity).toBe(2);
    });

    it('POST /capacity збільшення з attachBusinessId → слот і прикріплення атомарно', async () => {
        const user = await createUser();
        const business = await createBusiness(user);
        await seedActiveProfile(user, {
            brand: { capacity: 1, attachedBusinessIds: [] },
        });
        providerMock.chargeByToken.mockResolvedValueOnce({
            invoiceId: 'inv_pro_att',
            status: MONOBANK_INVOICE_STATUS.SUCCESS,
            cardMask: '** 1111',
            cardToken: null,
            failureReason: null,
            errCode: null,
        });

        await supertest(app.getHttpServer())
            .post('/api/payments/capacity')
            .set('Authorization', bearerFor(user))
            .send({
                universe: BILLING_UNIVERSE.BRAND,
                capacity: 2,
                attachBusinessId: business._id.toString(),
            })
            .expect(200);

        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.brand.capacity).toBe(2);
        expect(
            profile?.brand.attachedBusinessIds.map((id) => id.toString())
        ).toContain(business._id.toString());
        expect(
            (await businessModel.findById(business._id))?.brandedAt
        ).toBeTruthy();
    });

    it('POST /capacity з attachBusinessId без збільшення → 400 INVALID_CAPACITY', async () => {
        const user = await createUser();
        const business = await createBusiness(user);
        await seedActiveProfile(user, {
            brand: { capacity: 2, attachedBusinessIds: [] },
        });

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/capacity')
            .set('Authorization', bearerFor(user))
            .send({
                universe: BILLING_UNIVERSE.BRAND,
                capacity: 1,
                attachBusinessId: business._id.toString(),
            })
            .expect(400);
        expect((res.body as { error: { code: string } }).error.code).toBe(
            'INVALID_CAPACITY'
        );
        expect(providerMock.chargeByToken).not.toHaveBeenCalled();
    });

    it('POST /capacity збільшення на PAST_DUE → 400 BILLING_PAST_DUE, без списання', async () => {
        const user = await createUser();
        const now = new Date();
        // Прострочка: період минув, dunning веде профіль через nextRetryAt.
        // daysRemaining=0 → пропорція нульова, тож без замка розширення
        // діставалось би безкоштовно на весь грейс.
        await seedActiveProfile(user, {
            status: SUBSCRIPTION_STATUS.PAST_DUE,
            currentPeriodStart: new Date(now.getTime() - 45 * 24 * 3600 * 1000),
            currentPeriodEnd: new Date(now.getTime() - 15 * 24 * 3600 * 1000),
            nextChargeAt: null,
            nextRetryAt: new Date(now.getTime() + 3600 * 1000),
            dunningAttempts: 1,
        });

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/capacity')
            .set('Authorization', bearerFor(user))
            .send({ universe: BILLING_UNIVERSE.BRAND, capacity: 2 })
            .expect(400);
        expect((res.body as { error: { code: string } }).error.code).toBe(
            'BILLING_PAST_DUE'
        );
        expect(providerMock.chargeByToken).not.toHaveBeenCalled();
        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.brand.capacity).toBe(1);
    });

    it('POST /capacity зменшення на PAST_DUE лишається доступним (знижує суму dunning-retry)', async () => {
        const user = await createUser();
        const now = new Date();
        await seedActiveProfile(user, {
            status: SUBSCRIPTION_STATUS.PAST_DUE,
            currentPeriodStart: new Date(now.getTime() - 45 * 24 * 3600 * 1000),
            currentPeriodEnd: new Date(now.getTime() - 15 * 24 * 3600 * 1000),
            nextChargeAt: null,
            nextRetryAt: new Date(now.getTime() + 3600 * 1000),
            dunningAttempts: 1,
            brand: { capacity: 3, attachedBusinessIds: [] },
        });

        await supertest(app.getHttpServer())
            .post('/api/payments/capacity')
            .set('Authorization', bearerFor(user))
            .send({ universe: BILLING_UNIVERSE.BRAND, capacity: 1 })
            .expect(200);
        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.brand.pendingCapacity).toBe(1);
        expect(providerMock.chargeByToken).not.toHaveBeenCalled();
    });

    it('завислий негайний PENDING блокує наступну платну дію → 409, без другого списання', async () => {
        const user = await createUser();
        await seedActiveProfile(user, {
            brand: { capacity: 1, attachedBusinessIds: [] },
        });
        // Банк відповів нетермінально: ефект відкладено у pendingEffect,
        // claim лишається PENDING до вебхука / clock-reconcile.
        providerMock.chargeByToken.mockResolvedValueOnce({
            invoiceId: 'inv_pro_hold',
            status: MONOBANK_INVOICE_STATUS.PROCESSING,
            cardMask: '** 1111',
            cardToken: null,
            failureReason: null,
            errCode: null,
        });
        const first = await supertest(app.getHttpServer())
            .post('/api/payments/capacity')
            .set('Authorization', bearerFor(user))
            .send({ universe: BILLING_UNIVERSE.BRAND, capacity: 2 })
            .expect(200);
        expect(
            (first.body as { data: { scheduled: boolean } }).data.scheduled
        ).toBe(true);

        // Цілі ефектів абсолютні (обчислені від ємності ДО застосування
        // завислого ефекту): друге списання у цьому вікні взяло б гроші за ту
        // саму ємність — подвійна оплата одного слота.
        const res = await supertest(app.getHttpServer())
            .post('/api/payments/capacity')
            .set('Authorization', bearerFor(user))
            .send({ universe: BILLING_UNIVERSE.BRAND, capacity: 2 })
            .expect(409);
        expect((res.body as { error: { code: string } }).error.code).toBe(
            'BILLING_OPERATION_IN_PROGRESS'
        );
        expect(providerMock.chargeByToken).toHaveBeenCalledTimes(1);
        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.brand.capacity).toBe(1);
    });

    it('завислий цикловий PENDING блокує зміну ємності → 409, без безкоштовного розширення', async () => {
        const user = await createUser();
        const now = new Date();
        const boundary = new Date(now.getTime() - 3600 * 1000);
        await seedActiveProfile(user, {
            currentPeriodStart: new Date(
                boundary.getTime() - 30 * 24 * 3600 * 1000
            ),
            currentPeriodEnd: boundary,
            nextChargeAt: boundary,
            brand: { capacity: 1, attachedBusinessIds: [] },
        });
        // Clock уже заклеймив циклове списання за СТАРОЮ ємністю (банк відповів
        // нетермінально, claim висить PENDING). Межа минула → пропорція нульова:
        // без гейта збільшення застосувалось би безкоштовно на весь щойно
        // оплачуваний цикл, а зменшення advanceCycle зрізав би цикл, списаний
        // за повною сумою.
        await paymentRecordModel.create({
            userId: user._id,
            orderReference: `fin-cyc-${user._id.toString()}-${boundary.getTime()}`,
            type: PAYMENT_RECORD_TYPE.CYCLE,
            amount: 4900,
            currency: 'UAH',
            status: PAYMENT_RECORD_STATUS.PENDING,
            providerTransactionId: 'inv_cycle_hold',
            cardMask: null,
            refundAmount: null,
            pendingEffect: null,
        });

        const increase = await supertest(app.getHttpServer())
            .post('/api/payments/capacity')
            .set('Authorization', bearerFor(user))
            .send({ universe: BILLING_UNIVERSE.BRAND, capacity: 2 })
            .expect(409);
        expect((increase.body as { error: { code: string } }).error.code).toBe(
            'BILLING_OPERATION_IN_PROGRESS'
        );

        const decrease = await supertest(app.getHttpServer())
            .post('/api/payments/capacity')
            .set('Authorization', bearerFor(user))
            .send({ universe: BILLING_UNIVERSE.BRAND, capacity: 0 })
            .expect(409);
        expect((decrease.body as { error: { code: string } }).error.code).toBe(
            'BILLING_OPERATION_IN_PROGRESS'
        );

        expect(providerMock.chargeByToken).not.toHaveBeenCalled();
        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.brand.capacity).toBe(1);
        expect(profile?.brand.pendingCapacity).toBeNull();
    });

    // ─── Transport-unknown → вебхук добиває claim-запис ───

    it('transport-збій доплати → success-вебхук застосовує ефект, знімає прапор і повертає планувальник', async () => {
        const user = await createUser();
        const seeded = await seedActiveProfile(user, {
            brand: { capacity: 1, attachedBusinessIds: [] },
        });
        // Таймаут/5xx: результат НЕВІДОМИЙ (chargeDefinitelyNotApplied=false),
        // гроші могли піти — повторне списання заборонене.
        providerMock.chargeByToken.mockRejectedValueOnce(
            new ProviderRequestError('socket timeout', false)
        );

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/capacity')
            .set('Authorization', bearerFor(user))
            .send({ universe: BILLING_UNIVERSE.BRAND, capacity: 2 })
            .expect(409);
        expect((res.body as { error: { code: string } }).error.code).toBe(
            'BILLING_OPERATION_IN_PROGRESS'
        );

        // Невизначеність: ops-прапор, планувальник зупинено, claim без invoiceId.
        let profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.needsManualReview).toBe(true);
        expect(profile?.nextChargeAt).toBeNull();
        expect(profile?.brand.capacity).toBe(1);
        const pending = await paymentRecordModel.findOne({
            userId: user._id,
            type: PAYMENT_RECORD_TYPE.PRORATION,
            status: PAYMENT_RECORD_STATUS.PENDING,
        });
        expect(pending).toBeTruthy();
        expect(pending?.providerTransactionId).toBeNull();

        // Гроші насправді списались — monobank приносить це вебхуком.
        await postWebhook(
            makeEvent({
                orderReference: pending!.orderReference,
                invoiceId: 'inv_late',
                providerEventId: 'inv_late:success',
            })
        );

        const settled = await paymentRecordModel.findById(pending!._id);
        expect(settled?.status).toBe(PAYMENT_RECORD_STATUS.APPROVED);
        expect(settled?.providerTransactionId).toBe('inv_late');
        profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.brand.capacity).toBe(2);
        expect(profile?.needsManualReview).toBe(false);
        expect(profile?.nextChargeAt?.getTime()).toBe(
            seeded.currentPeriodEnd!.getTime()
        );
    });

    it('transport-збій доплати → failure-вебхук: DECLINED без ефекту, прапор знято, планувальник живий', async () => {
        const user = await createUser();
        const seeded = await seedActiveProfile(user, {
            brand: { capacity: 1, attachedBusinessIds: [] },
        });
        providerMock.chargeByToken.mockRejectedValueOnce(
            new ProviderRequestError('socket timeout', false)
        );

        await supertest(app.getHttpServer())
            .post('/api/payments/capacity')
            .set('Authorization', bearerFor(user))
            .send({ universe: BILLING_UNIVERSE.BRAND, capacity: 2 })
            .expect(409);
        const pending = await paymentRecordModel.findOne({
            userId: user._id,
            type: PAYMENT_RECORD_TYPE.PRORATION,
            status: PAYMENT_RECORD_STATUS.PENDING,
        });
        expect(pending).toBeTruthy();

        await postWebhook(
            makeEvent({
                orderReference: pending!.orderReference,
                invoiceId: 'inv_late_fail',
                providerEventId: 'inv_late_fail:failure',
                status: MONOBANK_INVOICE_STATUS.FAILURE,
            })
        );

        const settled = await paymentRecordModel.findById(pending!._id);
        expect(settled?.status).toBe(PAYMENT_RECORD_STATUS.DECLINED);
        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.brand.capacity).toBe(1);
        expect(profile?.needsManualReview).toBe(false);
        expect(profile?.nextChargeAt?.getTime()).toBe(
            seeded.currentPeriodEnd!.getTime()
        );
    });

    it('billing-clock бачить завислий claim БЕЗ invoiceId → ops-прапор замість вічного тихого блоку', async () => {
        // Крах процесу між claim-ом і збереженням invoiceId (інвойс до monobank
        // не дійшов): вебхука не буде, авто-розвʼязки немає. Clock мусить
        // підняти needsManualReview — інакше claim вічно і невидимо блокував би
        // всі платні мутації платника через assertNoUnsettledCharge.
        const user = await createUser();
        await seedActiveProfile(user, {
            brand: { capacity: 1, attachedBusinessIds: [] },
        });
        const created = await paymentRecordModel.create({
            userId: user._id,
            orderReference: `fin-pro-${user._id.toString()}-deadbeefcafef00d`,
            type: PAYMENT_RECORD_TYPE.PRORATION,
            amount: 4900,
            currency: 'UAH',
            status: PAYMENT_RECORD_STATUS.PENDING,
            providerTransactionId: null,
            cardMask: null,
            refundAmount: null,
            pendingEffect: {
                universe: BILLING_UNIVERSE.BRAND,
                targetCapacity: 2,
                targetTierSize: null,
                grantCredits: 0,
                attachBusinessId: null,
            },
        });
        // Старший за поріг «ще в роботі» (5 хв); createdAt керує Mongoose,
        // тож відсуваємо його напряму через колекцію.
        await paymentRecordModel.collection.updateOne(
            { _id: created._id },
            { $set: { createdAt: new Date(Date.now() - 10 * 60 * 1000) } }
        );

        await app.get(BillingClockService).runBillingClock();

        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.needsManualReview).toBe(true);
        expect(profile?.nextChargeAt).toBeNull();
        // Без invoiceId звіряти нема що; claim лишається PENDING (чи рухались
        // гроші — рішення за ops), ефект не застосовано.
        expect(providerMock.getInvoiceStatus).not.toHaveBeenCalled();
        const record = await paymentRecordModel.findById(created._id);
        expect(record?.status).toBe(PAYMENT_RECORD_STATUS.PENDING);
        expect(profile?.brand.capacity).toBe(1);
    });

    // ─── Scheduled capacity decrease ───

    it('POST /capacity зменшення → заплановано, view показує pending і нову суму', async () => {
        const user = await createUser();
        await seedActiveProfile(user, {
            brand: { capacity: 3, attachedBusinessIds: [] },
        });

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/capacity')
            .set('Authorization', bearerFor(user))
            .send({ universe: BILLING_UNIVERSE.BRAND, capacity: 1 })
            .expect(200);
        const data = (
            res.body as {
                data: { immediateCharge: number; scheduled: boolean };
            }
        ).data;
        expect(data.immediateCharge).toBe(0);
        expect(data.scheduled).toBe(true);
        expect(providerMock.chargeByToken).not.toHaveBeenCalled();

        const view = await supertest(app.getHttpServer())
            .get('/api/payments/profile')
            .set('Authorization', bearerFor(user))
            .expect(200);
        const profileView = (
            view.body as {
                data: {
                    nextChargeAmount: number;
                    brand: { capacity: number; pendingCapacity: number | null };
                };
            }
        ).data;
        // Ємність поточного циклу не змінилась, але наступне списання — за
        // ефективним (зменшеним) складом.
        expect(profileView.brand.capacity).toBe(3);
        expect(profileView.brand.pendingCapacity).toBe(1);
        expect(profileView.nextChargeAmount).toBe(4900);
    });

    it('cycle renewal із запланованим зменшенням → списується нова (менша) сума, зменшення застосовано', async () => {
        const user = await createUser();
        await seedActiveProfile(user, {
            currentPeriodEnd: new Date(Date.now() - 1000),
            nextChargeAt: new Date(Date.now() - 1000),
            brand: {
                capacity: 3,
                attachedBusinessIds: [],
                pendingCapacity: 1,
                pendingKeepBusinessIds: [],
            },
        });
        providerMock.chargeByToken.mockResolvedValueOnce({
            invoiceId: 'inv_cyc_dec',
            status: MONOBANK_INVOICE_STATUS.SUCCESS,
            cardMask: '** 1111',
            cardToken: 'tok-1',
            failureReason: null,
            errCode: null,
        });

        await billing.chargeDueCycle(user._id.toString());

        // Списано за ефективним складом (1 слот), не за старими трьома.
        expect(providerMock.chargeByToken).toHaveBeenCalledTimes(1);
        expect(providerMock.chargeByToken.mock.calls[0][0].amount).toBe(4900);

        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.brand.capacity).toBe(1);
        expect(profile?.brand.pendingCapacity).toBeNull();
        const record = await paymentRecordModel.findOne({
            userId: user._id,
            type: PAYMENT_RECORD_TYPE.CYCLE,
        });
        expect(record?.amount).toBe(4900);
        expect(record?.status).toBe(PAYMENT_RECORD_STATUS.APPROVED);
    });

    it('cycle renewal зі зменшенням: збій реконсиляції не губить detached — durable-слід і добивання sweep-ом', async () => {
        const user = await createUser();
        const kept = await createBusiness(user);
        // Інший taxId (partial-unique `(ownerId, taxId, type)`) і явний slug:
        // helper бере перші 8 hex ObjectId — це секундний timestamp, у межах
        // однієї секунди два create колізують на unique slugLower.
        const dropped = await createBusiness(user, {
            taxId: '2222222222',
            slug: 'biz-dropped',
            slugLower: 'biz-dropped',
        });
        await businessModel.updateMany(
            { _id: { $in: [kept._id, dropped._id] } },
            { $set: { brandedAt: new Date() } }
        );
        // capacity 2 → заплановано 1; keep-список порожній, тож лишається
        // найперший за порядком прикріплення (`kept`), другий (`dropped`)
        // відкріпляється на межі циклу і мусить розбрендуватись.
        await seedActiveProfile(user, {
            currentPeriodEnd: new Date(Date.now() - 1000),
            nextChargeAt: new Date(Date.now() - 1000),
            brand: {
                capacity: 2,
                attachedBusinessIds: [kept._id, dropped._id],
                pendingCapacity: 1,
                pendingKeepBusinessIds: [],
            },
        });
        providerMock.chargeByToken.mockResolvedValueOnce({
            invoiceId: 'inv_cyc_reconc_fail',
            status: MONOBANK_INVOICE_STATUS.SUCCESS,
            cardMask: '** 1111',
            cardToken: 'tok-1',
            failureReason: null,
            errCode: null,
        });
        const reconcileSpy = jest
            .spyOn(app.get(ReconciliationService), 'reconcileBusinesses')
            .mockRejectedValueOnce(new Error('transient mongo failure'));
        try {
            await billing.chargeDueCycle(user._id.toString());

            // Цикл просунуто, але реконсиляція впала: durable-слід (маркер +
            // detached-список) записаний атомарно з тримом прикріплень — без
            // нього відкріплений бізнес лишився б branded назавжди (у складах
            // його вже немає, sweep по прикріплених його не бачить).
            expect(
                (await businessModel.findById(dropped._id))?.brandedAt
            ).not.toBeNull();
            const stamped = await profileModel.findOne({ userId: user._id });
            expect(
                stamped?.brand.attachedBusinessIds.map((id) => id.toString())
            ).toEqual([kept._id.toString()]);
            expect(stamped?.reconcileRequiredAt).not.toBeNull();
            expect(
                stamped?.pendingReconcileBusinessIds.map((id) => id.toString())
            ).toEqual([dropped._id.toString()]);

            // Daily-sweep добиває за durable-слідом: відкріплений бізнес
            // розбрендовано, прикріплений лишився, слід зачищено.
            await app.get(PaymentsCleanupService).runDailyCleanup();
            expect(
                (await businessModel.findById(dropped._id))?.brandedAt
            ).toBeNull();
            expect(
                (await businessModel.findById(kept._id))?.brandedAt
            ).not.toBeNull();
            const swept = await profileModel.findOne({ userId: user._id });
            expect(swept?.reconcileRequiredAt).toBeNull();
            expect(swept?.pendingReconcileBusinessIds).toHaveLength(0);
        } finally {
            reconcileSpy.mockRestore();
        }
    });

    it('вузький reconcile-тригер (attach) не стирає durable-слід чужої незавершеної реконсиляції', async () => {
        const user = await createUser();
        // `stale` — відкріплений раніше бізнес, чия реконсиляція не завершилась:
        // у складах його вже немає, але він досі branded; durable-слід (маркер +
        // pendingReconcileBusinessIds) чекає добивання.
        const stale = await createBusiness(user, {
            taxId: '2222222222',
            slug: 'biz-stale',
            slugLower: 'biz-stale',
        });
        const fresh = await createBusiness(user, {
            taxId: '3333333333',
            slug: 'biz-fresh',
            slugLower: 'biz-fresh',
        });
        await businessModel.updateOne(
            { _id: stale._id },
            { $set: { brandedAt: new Date() } }
        );
        await seedActiveProfile(user, {
            brand: { capacity: 1, attachedBusinessIds: [] },
            reconcileRequiredAt: new Date(Date.now() - 3600 * 1000),
            pendingReconcileBusinessIds: [stale._id],
        });

        // Вільний слот → безкоштовне прикріплення `fresh`. Attach перезаписує
        // маркер власним стемпом, тож його прохід мусить покрити ПОВНИЙ борг
        // профілю (включно зі stale-detached) — інакше зняття маркера стерло б
        // єдиний retry-тригер, і stale лишився б branded назавжди.
        await supertest(app.getHttpServer())
            .post('/api/payments/attach')
            .set('Authorization', bearerFor(user))
            .send({
                universe: BILLING_UNIVERSE.BRAND,
                businessId: fresh._id.toString(),
            })
            .expect(200);

        expect(
            (await businessModel.findById(fresh._id))?.brandedAt
        ).not.toBeNull();
        expect((await businessModel.findById(stale._id))?.brandedAt).toBeNull();
        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.reconcileRequiredAt).toBeNull();
        expect(profile?.pendingReconcileBusinessIds).toHaveLength(0);
    });

    it('заплановане зменшення до нуля → межа циклу без списання: CANCELED, бізнес розбрендовано', async () => {
        const user = await createUser();
        const business = await createBusiness(user);
        await businessModel.updateOne(
            { _id: business._id },
            { $set: { brandedAt: new Date() } }
        );
        await seedActiveProfile(user, {
            currentPeriodEnd: new Date(Date.now() - 1000),
            nextChargeAt: new Date(Date.now() - 1000),
            brand: {
                capacity: 1,
                attachedBusinessIds: [business._id],
                pendingCapacity: 0,
                pendingKeepBusinessIds: [],
            },
        });

        await billing.chargeDueCycle(user._id.toString());

        expect(providerMock.chargeByToken).not.toHaveBeenCalled();
        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.status).toBe(SUBSCRIPTION_STATUS.CANCELED);
        expect(profile?.brand.capacity).toBe(0);
        expect(profile?.brand.attachedBusinessIds).toHaveLength(0);
        expect(profile?.brand.pendingCapacity).toBeNull();
        expect(profile?.cardToken).toBeNull();
        expect(
            (await businessModel.findById(business._id))?.brandedAt
        ).toBeNull();
    });

    it('attach у слот, що зникає за запланованим зменшенням → 400 BILLING_CAPACITY_EXCEEDED', async () => {
        // capacity 2 (1 вільний слот), але заплановано зменшення до 1: ефективна
        // ємність = 1 і вона вже зайнята. Прикріплення у «зникаючий» слот
        // блокується — інакше на межі циклу applyDecrease тихо відкріпив би
        // щойно прикріплений бізнес зі slug-rent.
        const user = await createUser();
        const kept = await createBusiness(user);
        const candidate = await businessModel.create({
            type: 'fop',
            ownerId: user._id,
            managers: [],
            slug: `biz2-${new Types.ObjectId().toString().slice(0, 8)}`,
            slugLower: `biz2-${new Types.ObjectId().toString().slice(0, 8)}`,
            name: 'ФОП Другий',
            taxId: '9876543210',
            taxationSystem: 'simplified-3',
            isVatPayer: false,
            paymentPurposeTemplate: 'Оплата',
        });
        await seedActiveProfile(user, {
            brand: {
                capacity: 2,
                attachedBusinessIds: [kept._id],
                pendingCapacity: 1,
                pendingKeepBusinessIds: [kept._id],
            },
        });

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/attach')
            .set('Authorization', bearerFor(user))
            .send({
                universe: BILLING_UNIVERSE.BRAND,
                businessId: candidate._id.toString(),
            })
            .expect(400);
        expect((res.body as { error: { code: string } }).error.code).toBe(
            'BILLING_CAPACITY_EXCEEDED'
        );
        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.brand.attachedBusinessIds).toHaveLength(1);

        // Після скасування зменшення той самий attach проходить у вільний слот.
        await supertest(app.getHttpServer())
            .post('/api/payments/capacity')
            .set('Authorization', bearerFor(user))
            .send({ universe: BILLING_UNIVERSE.BRAND, capacity: 2 })
            .expect(200);
        await supertest(app.getHttpServer())
            .post('/api/payments/attach')
            .set('Authorization', bearerFor(user))
            .send({
                universe: BILLING_UNIVERSE.BRAND,
                businessId: candidate._id.toString(),
            })
            .expect(200);
    });

    it('збільшення ємності скасовує заплановане зменшення', async () => {
        const user = await createUser();
        await seedActiveProfile(user, {
            brand: {
                capacity: 1,
                attachedBusinessIds: [],
                pendingCapacity: 0,
                pendingKeepBusinessIds: [],
            },
        });
        providerMock.chargeByToken.mockResolvedValueOnce({
            invoiceId: 'inv_pro_undo',
            status: MONOBANK_INVOICE_STATUS.SUCCESS,
            cardMask: '** 1111',
            cardToken: null,
            failureReason: null,
            errCode: null,
        });

        await supertest(app.getHttpServer())
            .post('/api/payments/capacity')
            .set('Authorization', bearerFor(user))
            .send({ universe: BILLING_UNIVERSE.BRAND, capacity: 2 })
            .expect(200);

        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.brand.capacity).toBe(2);
        expect(profile?.brand.pendingCapacity).toBeNull();
    });

    it('виклик з поточною ємністю скасовує заплановане зменшення без списання', async () => {
        const user = await createUser();
        await seedActiveProfile(user, {
            brand: {
                capacity: 2,
                attachedBusinessIds: [],
                pendingCapacity: 1,
                pendingKeepBusinessIds: [],
            },
        });

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/capacity')
            .set('Authorization', bearerFor(user))
            .send({ universe: BILLING_UNIVERSE.BRAND, capacity: 2 })
            .expect(200);
        expect(
            (res.body as { data: { immediateCharge: number } }).data
                .immediateCharge
        ).toBe(0);
        expect(providerMock.chargeByToken).not.toHaveBeenCalled();

        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.brand.capacity).toBe(2);
        expect(profile?.brand.pendingCapacity).toBeNull();
    });

    // ─── Checkout amount verification ───

    it('checkout: оплачена сума не збігається зі складом → без активації, ручний розбір', async () => {
        const user = await createUser();
        await supertest(app.getHttpServer())
            .post('/api/payments/checkout')
            .set('Authorization', bearerFor(user))
            .send({ universe: BILLING_UNIVERSE.BRAND, capacity: 2 })
            .expect(201);

        const orderReference =
            providerMock.createSubscriptionCheckout.mock.calls[0][0]
                .orderReference;
        // Оплата «дешевого» інвойсу (4900) при очікуваних 2 × 4900 = 9800:
        // застарілий checkout не сміє активувати дорожчий склад.
        await postWebhook(
            makeEvent({ orderReference, invoiceId: 'inv_stale', amount: 4900 })
        );

        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.status).toBe(SUBSCRIPTION_STATUS.INCOMPLETE);
        expect(profile?.needsManualReview).toBe(true);
        const record = await paymentRecordModel.findOne({
            userId: user._id,
            orderReference,
        });
        expect(record?.type).toBe(PAYMENT_RECORD_TYPE.UNMATCHED);
        expect(record?.status).toBe(PAYMENT_RECORD_STATUS.APPROVED);
        expect(record?.amount).toBe(4900);
    });

    it('success застарілого checkout-інвойсу поверх активного профілю → UNMATCHED, цикл не скинуто', async () => {
        // Обидва checkout-інвойси живуть у monobank до expiry: перший оплачений
        // активував профіль, оплата другого (та сама сума) не сміє повторно
        // активувати — це скинуло б день-якір і межі оплаченого циклу.
        const user = await createUser();
        const seeded = await seedActiveProfile(user, { anchorDay: 15 });
        const periodEndBefore = seeded.currentPeriodEnd;

        const staleRef = `fin-chk-${user._id.toString()}-deadbeef00000000`;
        await postWebhook(
            makeEvent({
                orderReference: staleRef,
                invoiceId: 'inv_stale_active',
                amount: 4900,
            })
        );

        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.status).toBe(SUBSCRIPTION_STATUS.ACTIVE);
        expect(profile?.currentPeriodEnd?.getTime()).toBe(
            periodEndBefore?.getTime()
        );
        expect(profile?.anchorDay).toBe(15);
        expect(profile?.needsManualReview).toBe(true);
        const record = await paymentRecordModel.findOne({
            userId: user._id,
            orderReference: staleRef,
        });
        expect(record?.type).toBe(PAYMENT_RECORD_TYPE.UNMATCHED);
        expect(record?.status).toBe(PAYMENT_RECORD_STATUS.APPROVED);
    });

    // ─── Calculator ───

    it('POST /calculator — жива ціна складу без мутацій', async () => {
        const user = await createUser();
        await seedActiveProfile(user, {
            brand: { capacity: 1, attachedBusinessIds: [] },
        });
        const res = await supertest(app.getHttpServer())
            .post('/api/payments/calculator')
            .set('Authorization', bearerFor(user))
            .send({ universe: BILLING_UNIVERSE.BRAND, capacity: 3 })
            .expect(200);
        const data = (res.body as { data: Record<string, number> }).data;
        expect(data.currentMonthlyAmount).toBe(4900);
        expect(data.newMonthlyAmount).toBe(14700);
        expect(data.immediateCharge).toBeGreaterThan(0);
    });
});
