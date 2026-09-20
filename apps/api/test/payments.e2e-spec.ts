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
    CARD_VERIFICATION_STATUS,
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
import { createCounterStub } from './redis-counter-stub';
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
import {
    ProcessedWebhookEvent,
    ProcessedWebhookEventDocument,
} from '../src/modules/payments/schemas/processed-webhook-event.schema';
import {
    BILLING_CARD_RETENTION_DAYS,
    BILLING_CARD_REVOCATION_MAX_FAILURES,
    BILLING_DUNNING,
    BILLING_GRID,
} from '../src/config/billing.config';

jest.mock('../src/config/env', () => ({
    ENV: {
        NODE_ENV: 'test',
        API_PORT: '4000',
        WEB_URL: 'https://finly.com.ua',
        PAY_PUBLIC_URL: 'https://pay.finly.com.ua',
        MONGODB_URI: 'overridden-by-MongoMemoryReplSet',
        REDIS_URL: 'redis://mock',
        JWT_ACCESS_SECRET: 'e2e-access-secret-must-be-long-enough',
        JWT_REFRESH_SECRET: 'e2e-refresh-secret-must-be-long-enough',
        GOOGLE_CLIENT_ID: 'test-id.apps.googleusercontent.com',
        GOOGLE_CLIENT_SECRET: 'GOCSPX-test',
        RESEND_API_KEY: 're_test',
        RESEND_FROM_EMAIL: 'Finly <test@test.com>',
        MONOBANK_TOKEN: 'test-monobank-token',
        R2_ACCOUNT_ID: 'test-account',
        R2_ACCESS_KEY_ID: 'test-key-id',
        R2_SECRET_ACCESS_KEY: 'test-secret',
        R2_BUCKET_NAME: 'test-bucket',
        R2_PUBLIC_URL: 'https://media.test.local',
    },
}));

@Global()
@Module({
    providers: [
        { provide: REDIS_CLIENT, useFactory: () => createRedisMock() },
        {
            provide: RedisCounterService,
            // Імена методів мусять збігатися з реальним сервісом:
            // `UserRateLimitGuard` викликає саме `incrementFixedWindow`, і
            // stub з іншою назвою падав би TypeError замість роботи ліміту.
            useValue: createCounterStub(),
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
    createCardVerification: jest.fn(async (i: { orderReference: string }) => ({
        checkoutUrl: `https://pay.mbnk.biz/${i.orderReference}`,
        invoiceId: `inv_${i.orderReference}`,
        orderReference: i.orderReference,
    })),
    chargeByToken: jest.fn(),
    getInvoiceStatus: jest.fn(),
    parseWebhook: jest.fn(),
    deleteCardToken: jest.fn().mockResolvedValue(undefined),
};

const emailMock = {
    sendMagicLink: jest.fn().mockResolvedValue(undefined),
    sendDeletionConfirmation: jest.fn().mockResolvedValue(undefined),
    sendSubscriptionPastDue: jest.fn().mockResolvedValue(undefined),
    sendSubscriptionEnded: jest.fn().mockResolvedValue(undefined),
    sendCardChanged: jest.fn().mockResolvedValue(undefined),
    sendManualReviewAlert: jest.fn().mockResolvedValue(undefined),
    sendCardRevocationFailed: jest.fn().mockResolvedValue(undefined),
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
            cardPaymentMethod: 'pan',
            cardPaymentSystem: 'mastercard',
            cardBank: 'ПриватБанк',
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
        expect(data.brand.pricePerBusiness).toBe(
            BILLING_GRID.brand.pricePerBusiness
        );
        expect(data.documents.enabled).toBe(false);
        expect(data.documents.tiers).toHaveLength(
            BILLING_GRID.documents.tiers.length
        );
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

    it('checkout при живому скасованому профілі → 409, склади не зачеплені', async () => {
        // Скасування лишає період оплаченим (статус ACTIVE) і картку на місці:
        // повторний checkout НЕ має зносити склади і доступ — лише 409.
        const user = await createUser();
        const business = await createBusiness(user);
        await seedActiveProfile(user, {
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
        // Рівно на тику клока: час із секундами тик своєї ж години не взяв би, і
        // кожна наступна спроба зсувалась би на годину вперед.
        const nextRetryAt = updated?.nextRetryAt;
        expect(nextRetryAt).toBeTruthy();
        expect(nextRetryAt!.getTime() % (60 * 60 * 1000)).toBe(0);
        expect(nextRetryAt!.getTime()).toBeGreaterThan(Date.now());
    });

    // Sprint 31 — пауза вікна відновлення акаунта перекрита не лише вибіркою
    // планувальника, а й повторною перевіркою під локом: між вибіркою і цим
    // списанням проходить увесь батч, тож підтвердження видалення встигає
    // вклинитись і застарілий список зняв би плату за вимкнений сервіс.
    it('cycle renewal: профіль на паузі видалення акаунта → списання не відбувається', async () => {
        const user = await createUser();
        const profile = await seedActiveProfile(user, {
            currentPeriodEnd: new Date(Date.now() - 1000),
            nextChargeAt: new Date(Date.now() - 1000),
            billingPausedAt: new Date(),
        });
        const boundary = profile.currentPeriodEnd!;

        await billing.chargeDueCycle(user._id.toString());

        expect(providerMock.chargeByToken).not.toHaveBeenCalled();
        const updated = await profileModel.findOne({ userId: user._id });
        expect(updated?.currentPeriodEnd!.getTime()).toBe(boundary.getTime());
        expect(updated?.status).toBe(SUBSCRIPTION_STATUS.ACTIVE);
        expect(
            await paymentRecordModel.countDocuments({ userId: user._id })
        ).toBe(0);
    });

    // ─── Cancel ───

    it('POST /subscription/cancel → cancelAtPeriodEnd, картка лишається до кінця періоду', async () => {
        const user = await createUser();
        await seedActiveProfile(user);
        await supertest(app.getHttpServer())
            .post('/api/payments/subscription/cancel')
            .set('Authorization', bearerFor(user))
            .expect(200);

        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.cancelAtPeriodEnd).toBe(true);
        expect(profile?.nextChargeAt).toBeNull();
        // Платник ще платник до межі періоду: картка на місці, у банку токен
        // не відкликано. Стирання — робота згасання, не скасування.
        expect(profile?.cardToken).toBe('tok-1');
        expect(providerMock.deleteCardToken).not.toHaveBeenCalled();
    });

    it('POST /subscription/renew → скасування відкликано, списання повернуто на межу періоду', async () => {
        const user = await createUser();
        const profile = await seedActiveProfile(user, {
            cancelAtPeriodEnd: true,
            nextChargeAt: null,
        });

        await supertest(app.getHttpServer())
            .post('/api/payments/subscription/renew')
            .set('Authorization', bearerFor(user))
            .expect(200);

        const renewed = await profileModel.findOne({ userId: user._id });
        expect(renewed?.cancelAtPeriodEnd).toBe(false);
        expect(renewed?.nextChargeAt?.getTime()).toBe(
            profile.currentPeriodEnd?.getTime()
        );
        // Грошей дія не рухає: період уже оплачено.
        expect(providerMock.chargeByToken).not.toHaveBeenCalled();
        expect(providerMock.createSubscriptionCheckout).not.toHaveBeenCalled();

        // Після відновлення платні дії знову доступні.
        providerMock.chargeByToken.mockResolvedValueOnce({
            invoiceId: 'inv_pro',
            status: MONOBANK_INVOICE_STATUS.SUCCESS,
            cardToken: 'tok-1',
            failureReason: null,
            errCode: null,
            cardMask: '** 1111',
            cardPaymentMethod: 'pan',
            cardPaymentSystem: 'mastercard',
            cardBank: 'ПриватБанк',
        });
        await supertest(app.getHttpServer())
            .post('/api/payments/capacity')
            .set('Authorization', bearerFor(user))
            .send({ universe: BILLING_UNIVERSE.BRAND, capacity: 2 })
            .expect(200);
        const expanded = await profileModel.findOne({ userId: user._id });
        expect(expanded?.brand.capacity).toBe(2);
    });

    it('renew на нескасованій підписці → 400 BILLING_NOT_CANCELED', async () => {
        const user = await createUser();
        await seedActiveProfile(user);

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/subscription/renew')
            .set('Authorization', bearerFor(user))
            .expect(400);
        expect((res.body as { error: { code: string } }).error.code).toBe(
            'BILLING_NOT_CANCELED'
        );
    });

    it('renew після межі оплаченого періоду → 400 BILLING_PERIOD_ENDED', async () => {
        const user = await createUser();
        await seedActiveProfile(user, {
            cancelAtPeriodEnd: true,
            nextChargeAt: null,
            currentPeriodEnd: new Date(Date.now() - 3600_000),
        });

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/subscription/renew')
            .set('Authorization', bearerFor(user))
            .expect(400);
        expect((res.body as { error: { code: string } }).error.code).toBe(
            'BILLING_PERIOD_ENDED'
        );
        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.cancelAtPeriodEnd).toBe(true);
        expect(profile?.nextChargeAt).toBeNull();
    });

    it('renew без збереженої картки → 400 BILLING_CARD_REQUIRED, підписка лишається скасованою', async () => {
        // Стан усіх, хто скасував до цього спринту: картку вже стерто.
        // Відновлення поновило б списання, якому нема з чого списувати, і
        // профіль завис би у безкоштовному доступі назавжди.
        const user = await createUser();
        await seedActiveProfile(user, {
            cardToken: null,
            cancelAtPeriodEnd: true,
            nextChargeAt: null,
        });

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/subscription/renew')
            .set('Authorization', bearerFor(user))
            .expect(400);
        expect((res.body as { error: { code: string } }).error.code).toBe(
            'BILLING_CARD_REQUIRED'
        );
        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.cancelAtPeriodEnd).toBe(true);
        expect(profile?.nextChargeAt).toBeNull();
    });

    it('renew на профілі, який фонове згасання вже погасило, не воскрешає підписку', async () => {
        // Фонове згасання скасованих працює без per-user лока і цілком може
        // випередити натискання. Погашений профіль більше не entitled, тож
        // відновлення відхиляється, а не роздає доступ безкоштовно. Те саме
        // вікно у вужчому масштабі (між читанням профілю і записом) закриває
        // повтор умов у фільтрі самого запису.
        const user = await createUser();
        await seedActiveProfile(user, {
            status: SUBSCRIPTION_STATUS.CANCELED,
            cancelAtPeriodEnd: true,
            nextChargeAt: null,
            currentPeriodEnd: new Date(Date.now() - 3600_000),
        });

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/subscription/renew')
            .set('Authorization', bearerFor(user))
            .expect(400);
        expect((res.body as { error: { code: string } }).error.code).toBe(
            'BILLING_NOT_CANCELED'
        );
        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.status).toBe(SUBSCRIPTION_STATUS.CANCELED);
        expect(profile?.nextChargeAt).toBeNull();
    });

    it('renew при незакритому списанні → намір повернуто, планувальник лишається зупиненим', async () => {
        // Транспортний збій списання зупиняє планувальник свідомо: поки
        // невідомо, пройшли гроші чи ні, нових списань бути не повинно.
        // Відновлення повертає намір поновлювати, але вісь не чіпає — її
        // поверне settle того списання (clearChargeUncertainty).
        const user = await createUser();
        await seedActiveProfile(user, {
            cancelAtPeriodEnd: true,
            nextChargeAt: null,
            needsManualReview: true,
        });
        await paymentRecordModel.create({
            userId: user._id,
            orderReference: `fin-pro-${user._id.toString()}-c0ffeec0ffeec0ff`,
            type: PAYMENT_RECORD_TYPE.PRORATION,
            amount: BILLING_GRID.brand.pricePerBusiness,
            currency: 'UAH',
            status: PAYMENT_RECORD_STATUS.PENDING,
            providerTransactionId: null,
        });

        await supertest(app.getHttpServer())
            .post('/api/payments/subscription/renew')
            .set('Authorization', bearerFor(user))
            .expect(200);

        const renewed = await profileModel.findOne({ userId: user._id });
        expect(renewed?.cancelAtPeriodEnd).toBe(false);
        expect(renewed?.nextChargeAt).toBeNull();
        expect(providerMock.chargeByToken).not.toHaveBeenCalled();
    });

    // ─── Оплата простроченого місяця ───

    it('«оплатити зараз» у прострочці закриває той самий місяць, день списання не зсувається', async () => {
        const user = await createUser();
        // Межа минула вчора, день щомісячного списання — 10 число.
        const boundary = new Date('2026-05-10T09:00:00.000Z');
        await seedActiveProfile(user, {
            status: SUBSCRIPTION_STATUS.PAST_DUE,
            anchorDay: 10,
            currentPeriodStart: new Date('2026-04-10T09:00:00.000Z'),
            currentPeriodEnd: boundary,
            nextChargeAt: null,
            nextRetryAt: new Date(Date.now() + 3600_000),
            dunningAttempts: 3,
        });

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/subscription/resume')
            .set('Authorization', bearerFor(user))
            .send({ returnPath: '/billing' })
            .expect(200);
        const orderReference =
            (res.body as { data: { checkoutUrl: string } }).data.checkoutUrl
                .split('/')
                .pop() ?? '';

        // Платник оплачує 14 числа, тобто через чотири дні після межі.
        await postWebhook(
            makeEvent({
                orderReference,
                invoiceId: 'inv_resume',
                providerEventId: 'inv_resume:success',
                occurredAt: new Date('2026-05-14T12:00:00.000Z'),
                amount: BILLING_GRID.brand.pricePerBusiness,
            })
        );

        const updated = await profileModel.findOne({ userId: user._id });
        expect(updated?.status).toBe(SUBSCRIPTION_STATUS.ACTIVE);
        // Оплачено САМЕ прострочений місяць: він рахується від старої межі,
        // а не від дня оплати.
        expect(updated?.currentPeriodStart?.toISOString()).toBe(
            boundary.toISOString()
        );
        // Наступне списання — 10 квітня, день щомісячного списання не поїхав.
        expect(updated?.currentPeriodEnd?.toISOString()).toBe(
            '2026-06-10T09:00:00.000Z'
        );
        expect(updated?.nextChargeAt?.toISOString()).toBe(
            '2026-06-10T09:00:00.000Z'
        );
        expect(updated?.anchorDay).toBe(10);
        expect(updated?.dunningAttempts).toBe(0);
        expect(updated?.nextRetryAt).toBeNull();
        expect(updated?.needsManualReview).toBe(false);
        // Оплачено тією самою карткою — відкликати нічого.
        expect(updated?.cardToken).toBe('tok-1');
        expect(providerMock.deleteCardToken).not.toHaveBeenCalled();
    });

    it('перша купівля лишає чинну поведінку: місяць і день списання від дня оплати', async () => {
        const user = await createUser();
        const business = await createBusiness(user);
        await supertest(app.getHttpServer())
            .post('/api/payments/checkout')
            .set('Authorization', bearerFor(user))
            .send({
                universe: BILLING_UNIVERSE.BRAND,
                capacity: 1,
                attachBusinessId: business._id.toString(),
            })
            .expect(201);
        const orderReference =
            providerMock.createSubscriptionCheckout.mock.calls[0][0]
                .orderReference;

        await postWebhook(
            makeEvent({
                orderReference,
                invoiceId: 'inv_first',
                providerEventId: 'inv_first:success',
                occurredAt: new Date('2026-05-14T12:00:00.000Z'),
                amount: BILLING_GRID.brand.pricePerBusiness,
            })
        );

        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.status).toBe(SUBSCRIPTION_STATUS.ACTIVE);
        expect(profile?.anchorDay).toBe(14);
        expect(profile?.currentPeriodStart?.toISOString()).toBe(
            '2026-05-14T12:00:00.000Z'
        );
        expect(profile?.currentPeriodEnd?.toISOString()).toBe(
            '2026-06-14T12:00:00.000Z'
        );
    });

    it('повернення згаслого профілю лишає чинну поведінку: новий місяць від дня оплати', async () => {
        const user = await createUser();
        await seedActiveProfile(user, {
            status: SUBSCRIPTION_STATUS.UNPAID,
            anchorDay: 10,
            currentPeriodEnd: new Date('2026-05-10T09:00:00.000Z'),
            nextChargeAt: null,
        });

        await supertest(app.getHttpServer())
            .post('/api/payments/checkout')
            .set('Authorization', bearerFor(user))
            .send({ universe: BILLING_UNIVERSE.BRAND, capacity: 1 })
            .expect(201);
        const orderReference =
            providerMock.createSubscriptionCheckout.mock.calls[0][0]
                .orderReference;

        await postWebhook(
            makeEvent({
                orderReference,
                invoiceId: 'inv_back',
                providerEventId: 'inv_back:success',
                occurredAt: new Date('2026-04-20T12:00:00.000Z'),
                amount: BILLING_GRID.brand.pricePerBusiness,
            })
        );

        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.status).toBe(SUBSCRIPTION_STATUS.ACTIVE);
        // Дні, коли доступу не було, прощено: новий місяць від дня оплати.
        expect(profile?.anchorDay).toBe(20);
        expect(profile?.currentPeriodEnd?.toISOString()).toBe(
            '2026-05-20T12:00:00.000Z'
        );
    });

    it('друга оплата за вже закритий місяць не зсуває цикл і йде в ручний розбір', async () => {
        const user = await createUser();
        const boundary = new Date('2026-05-10T09:00:00.000Z');
        await seedActiveProfile(user, {
            status: SUBSCRIPTION_STATUS.PAST_DUE,
            anchorDay: 10,
            currentPeriodEnd: boundary,
            nextChargeAt: null,
            nextRetryAt: new Date(Date.now() + 3600_000),
        });

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/subscription/resume')
            .set('Authorization', bearerFor(user))
            .send({})
            .expect(200);
        const orderReference =
            (res.body as { data: { checkoutUrl: string } }).data.checkoutUrl
                .split('/')
                .pop() ?? '';

        const paid = {
            orderReference,
            invoiceId: 'inv_dbl',
            occurredAt: new Date('2026-05-14T12:00:00.000Z'),
            amount: BILLING_GRID.brand.pricePerBusiness,
        };
        await postWebhook(
            makeEvent({ ...paid, providerEventId: 'inv_dbl:success' })
        );
        const afterFirst = await profileModel.findOne({ userId: user._id });
        expect(afterFirst?.currentPeriodEnd?.toISOString()).toBe(
            '2026-06-10T09:00:00.000Z'
        );

        // Другі гроші за той самий місяць (інший рахунок, інша подія).
        await postWebhook(
            makeEvent({
                ...paid,
                invoiceId: 'inv_dbl2',
                providerEventId: 'inv_dbl2:success',
            })
        );

        const updated = await profileModel.findOne({ userId: user._id });
        // Цикл не зсунуто вдруге, гроші видно у розборі.
        expect(updated?.currentPeriodEnd?.toISOString()).toBe(
            '2026-06-10T09:00:00.000Z'
        );
        expect(updated?.needsManualReview).toBe(true);
        const unmatched = await paymentRecordModel.find({
            userId: user._id,
            type: PAYMENT_RECORD_TYPE.UNMATCHED,
        });
        expect(unmatched).toHaveLength(1);
    });

    it('планова спроба, що пройшла вже після «Оплатити зараз», не зараховується мовчки: ручний розбір', async () => {
        const user = await createUser();
        const boundary = new Date('2026-05-10T09:00:00.000Z');
        await seedActiveProfile(user, {
            status: SUBSCRIPTION_STATUS.PAST_DUE,
            anchorDay: 10,
            currentPeriodEnd: boundary,
            nextChargeAt: null,
            nextRetryAt: new Date(Date.now() + 3600_000),
        });

        // Платник відкрив сторінку оплати.
        const res = await supertest(app.getHttpServer())
            .post('/api/payments/subscription/resume')
            .set('Authorization', bearerFor(user))
            .send({})
            .expect(200);
        const checkoutRef =
            (res.body as { data: { checkoutUrl: string } }).data.checkoutUrl
                .split('/')
                .pop() ?? '';

        // Сторінка ще відкрита, пауза спроб минула, планова спроба пішла, а
        // банк її ще обробляє.
        await profileModel.updateOne(
            { userId: user._id },
            { $set: { nextRetryAt: new Date(Date.now() - 1000) } }
        );
        providerMock.chargeByToken.mockResolvedValueOnce({
            invoiceId: 'inv_retry_slow',
            status: MONOBANK_INVOICE_STATUS.PROCESSING,
            cardToken: null,
            failureReason: null,
            errCode: null,
            cardMask: '** 1111',
            cardPaymentMethod: 'pan',
            cardPaymentSystem: 'mastercard',
            cardBank: 'ПриватБанк',
        });
        await app.get(BillingClockService).runBillingClock();
        const cycleRef = providerMock.chargeByToken.mock.calls[0][0]
            .orderReference as string;

        // Платник завершив оплату на сторінці банку: місяць закрито.
        await postWebhook(
            makeEvent({
                orderReference: checkoutRef,
                invoiceId: 'inv_resume_first',
                providerEventId: 'inv_resume_first:success',
                amount: BILLING_GRID.brand.pricePerBusiness,
            })
        );

        // Банк доробив планову спробу: другі гроші за той самий місяць.
        await postWebhook(
            makeEvent({
                orderReference: cycleRef,
                invoiceId: 'inv_retry_slow',
                providerEventId: 'inv_retry_slow:success',
                amount: BILLING_GRID.brand.pricePerBusiness,
            })
        );

        const updated = await profileModel.findOne({ userId: user._id });
        expect(updated?.status).toBe(SUBSCRIPTION_STATUS.ACTIVE);
        expect(updated?.currentPeriodEnd?.toISOString()).toBe(
            '2026-06-10T09:00:00.000Z'
        );
        expect(updated?.needsManualReview).toBe(true);
        // Планувальник не зупинено: наступне місячне списання за розкладом.
        expect(updated?.nextChargeAt?.toISOString()).toBe(
            '2026-06-10T09:00:00.000Z'
        );
        const cycleRecord = await paymentRecordModel.findOne({
            orderReference: cycleRef,
            providerTransactionId: 'inv_retry_slow',
        });
        expect(cycleRecord?.status).toBe(PAYMENT_RECORD_STATUS.APPROVED);
        expect(cycleRecord?.type).toBe(PAYMENT_RECORD_TYPE.UNMATCHED);
    });

    it('відмова планової спроби вже після «Оплатити зараз» не повертає оплаченому профілю прострочку', async () => {
        const user = await createUser();
        const boundary = new Date('2026-05-10T09:00:00.000Z');
        await seedActiveProfile(user, {
            status: SUBSCRIPTION_STATUS.PAST_DUE,
            anchorDay: 10,
            currentPeriodEnd: boundary,
            nextChargeAt: null,
            nextRetryAt: new Date(Date.now() + 3600_000),
            dunningAttempts: 3,
        });

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/subscription/resume')
            .set('Authorization', bearerFor(user))
            .send({})
            .expect(200);
        const checkoutRef =
            (res.body as { data: { checkoutUrl: string } }).data.checkoutUrl
                .split('/')
                .pop() ?? '';

        // Планова спроба пішла, поки сторінка оплати відкрита, і зависла в банку.
        await profileModel.updateOne(
            { userId: user._id },
            { $set: { nextRetryAt: new Date(Date.now() - 1000) } }
        );
        providerMock.chargeByToken.mockResolvedValueOnce({
            invoiceId: 'inv_retry_slow_fail',
            status: MONOBANK_INVOICE_STATUS.PROCESSING,
            cardToken: null,
            failureReason: null,
            errCode: null,
            cardMask: '** 1111',
            cardPaymentMethod: 'pan',
            cardPaymentSystem: 'mastercard',
            cardBank: 'ПриватБанк',
        });
        await app.get(BillingClockService).runBillingClock();
        const cycleRef = providerMock.chargeByToken.mock.calls[0][0]
            .orderReference as string;

        // Платник оплатив на сторінці банку: місяць закрито.
        await postWebhook(
            makeEvent({
                orderReference: checkoutRef,
                invoiceId: 'inv_resume_paid',
                providerEventId: 'inv_resume_paid:success',
                amount: BILLING_GRID.brand.pricePerBusiness,
            })
        );

        // Банк відхилив завислу планову спробу вже за закритий місяць.
        await postWebhook(
            makeEvent({
                orderReference: cycleRef,
                invoiceId: 'inv_retry_slow_fail',
                providerEventId: 'inv_retry_slow_fail:failure',
                status: MONOBANK_INVOICE_STATUS.FAILURE,
                amount: BILLING_GRID.brand.pricePerBusiness,
            })
        );

        const updated = await profileModel.findOne({ userId: user._id });
        expect(updated?.status).toBe(SUBSCRIPTION_STATUS.ACTIVE);
        expect(updated?.dunningAttempts).toBe(0);
        expect(updated?.nextRetryAt).toBeNull();
        expect(updated?.currentPeriodEnd?.toISOString()).toBe(
            '2026-06-10T09:00:00.000Z'
        );
        expect(updated?.nextChargeAt?.toISOString()).toBe(
            '2026-06-10T09:00:00.000Z'
        );
        const cycleRecord = await paymentRecordModel.findOne({
            orderReference: cycleRef,
            providerTransactionId: 'inv_retry_slow_fail',
        });
        expect(cycleRecord?.status).toBe(PAYMENT_RECORD_STATUS.DECLINED);
        expect(emailMock.sendSubscriptionPastDue).not.toHaveBeenCalled();
    });

    it('ручний розбір → один лист адміністраторові з нерозпізнаним списанням, без повторів', async () => {
        const user = await createUser();
        await seedActiveProfile(user, {
            status: SUBSCRIPTION_STATUS.PAST_DUE,
            anchorDay: 10,
            currentPeriodEnd: new Date('2026-05-10T09:00:00.000Z'),
            nextChargeAt: null,
            nextRetryAt: new Date(Date.now() + 3600_000),
        });
        const res = await supertest(app.getHttpServer())
            .post('/api/payments/subscription/resume')
            .set('Authorization', bearerFor(user))
            .send({})
            .expect(200);
        const orderReference =
            (res.body as { data: { checkoutUrl: string } }).data.checkoutUrl
                .split('/')
                .pop() ?? '';
        const paid = {
            orderReference,
            amount: BILLING_GRID.brand.pricePerBusiness,
        };
        await postWebhook(
            makeEvent({
                ...paid,
                invoiceId: 'inv_alert1',
                providerEventId: 'inv_alert1:success',
            })
        );
        await postWebhook(
            makeEvent({
                ...paid,
                invoiceId: 'inv_alert2',
                providerEventId: 'inv_alert2:success',
            })
        );

        const cleanup = app.get(PaymentsCleanupService);
        await cleanup.runManualReviewAlerts();

        expect(emailMock.sendManualReviewAlert).toHaveBeenCalledTimes(1);
        expect(emailMock.sendManualReviewAlert).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: user._id.toString(),
                userEmail: user.email,
                stillFlagged: true,
                unmatched: [
                    expect.objectContaining({
                        invoiceId: 'inv_alert2',
                        amount: BILLING_GRID.brand.pricePerBusiness,
                    }),
                ],
                unsettled: [],
            })
        );
        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.manualReviewAlertDueAt).toBeNull();

        await cleanup.runManualReviewAlerts();
        expect(emailMock.sendManualReviewAlert).toHaveBeenCalledTimes(1);
    });

    it('лист адміністраторові не відправився → мітка лишається, лист іде наступним проходом', async () => {
        const user = await createUser();
        await seedActiveProfile(user, {
            needsManualReview: true,
            manualReviewAlertDueAt: new Date(),
        });
        emailMock.sendManualReviewAlert.mockRejectedValueOnce(
            new Error('resend down')
        );

        const cleanup = app.get(PaymentsCleanupService);
        await cleanup.runManualReviewAlerts();
        const afterFailure = await profileModel.findOne({ userId: user._id });
        expect(afterFailure?.manualReviewAlertDueAt).toBeTruthy();

        await cleanup.runManualReviewAlerts();
        expect(emailMock.sendManualReviewAlert).toHaveBeenCalledTimes(2);
        const afterRetry = await profileModel.findOne({ userId: user._id });
        expect(afterRetry?.manualReviewAlertDueAt).toBeNull();
    });

    it('щогодинна звірка завислого списання не шле адміністраторові той самий лист удруге', async () => {
        const user = await createUser();
        await seedActiveProfile(user);
        const record = await paymentRecordModel.create({
            userId: user._id,
            orderReference: `fin-pro-${user._id.toString()}-abababababababab`,
            type: PAYMENT_RECORD_TYPE.PRORATION,
            amount: 1000,
            currency: 'UAH',
            status: PAYMENT_RECORD_STATUS.PENDING,
        });
        await paymentRecordModel.collection.updateOne(
            { _id: record._id },
            { $set: { createdAt: new Date(Date.now() - 3600_000) } }
        );
        const clock = app.get(BillingClockService);
        const cleanup = app.get(PaymentsCleanupService);

        await clock.runBillingClock();
        await cleanup.runManualReviewAlerts();
        expect(emailMock.sendManualReviewAlert).toHaveBeenCalledTimes(1);
        expect(emailMock.sendManualReviewAlert).toHaveBeenCalledWith(
            expect.objectContaining({
                unsettled: [
                    expect.objectContaining({
                        invoiceId: null,
                        orderReference: record.orderReference,
                    }),
                ],
            })
        );

        await clock.runBillingClock();
        await cleanup.runManualReviewAlerts();
        expect(emailMock.sendManualReviewAlert).toHaveBeenCalledTimes(1);
        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.needsManualReview).toBe(true);
    });

    it('«оплатити зараз» при незавершеному списанні → 409, другого рахунку не створюємо', async () => {
        const user = await createUser();
        await seedActiveProfile(user, {
            status: SUBSCRIPTION_STATUS.PAST_DUE,
            nextChargeAt: null,
            nextRetryAt: new Date(Date.now() + 3600_000),
        });
        await paymentRecordModel.create({
            userId: user._id,
            orderReference: `fin-cyc-${user._id.toString()}-1`,
            type: PAYMENT_RECORD_TYPE.CYCLE,
            amount: BILLING_GRID.brand.pricePerBusiness,
            currency: 'UAH',
            status: PAYMENT_RECORD_STATUS.PENDING,
            providerTransactionId: 'inv_hanging',
        });

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/subscription/resume')
            .set('Authorization', bearerFor(user))
            .send({})
            .expect(409);
        expect((res.body as { error: { code: string } }).error.code).toBe(
            'BILLING_OPERATION_IN_PROGRESS'
        );
        expect(providerMock.createSubscriptionCheckout).not.toHaveBeenCalled();
    });

    it('заміна картки у прострочці одразу гасить борг і повертає доступ', async () => {
        const user = await createUser();
        const boundary = new Date('2026-05-10T09:00:00.000Z');
        await seedActiveProfile(user, {
            status: SUBSCRIPTION_STATUS.PAST_DUE,
            anchorDay: 10,
            currentPeriodEnd: boundary,
            nextChargeAt: null,
            nextRetryAt: new Date(Date.now() + 3600_000),
            dunningAttempts: 2,
        });

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/card/verification')
            .set('Authorization', bearerFor(user))
            .send({})
            .expect(200);
        const orderReference =
            (res.body as { data: { checkoutUrl: string } }).data.checkoutUrl
                .split('/')
                .pop() ?? '';

        providerMock.chargeByToken.mockResolvedValueOnce({
            invoiceId: 'inv_debt',
            status: MONOBANK_INVOICE_STATUS.SUCCESS,
            cardToken: 'tok-new',
            failureReason: null,
            errCode: null,
            cardMask: '** 4242',
            cardPaymentMethod: 'pan',
            cardPaymentSystem: 'visa',
            cardBank: 'monobank',
        });

        await postWebhook(
            makeEvent({
                orderReference,
                invoiceId: 'inv_cvf_debt',
                providerEventId: 'inv_cvf_debt:success',
                amount: 0,
                cardToken: 'tok-new',
                cardMask: '** 4242',
            })
        );

        // Борг списано новою карткою, без окремої дії платника.
        expect(providerMock.chargeByToken).toHaveBeenCalledTimes(1);
        const charged = providerMock.chargeByToken.mock.calls[0][0];
        expect(charged.cardToken).toBe('tok-new');
        expect(charged.amount).toBe(BILLING_GRID.brand.pricePerBusiness);
        // Під локом лише те, що змінює стан підписки: відкликання старої
        // картки і лист ідуть уже після списання боргу.
        expect(providerMock.deleteCardToken).toHaveBeenCalledWith('tok-1');
        expect(
            providerMock.chargeByToken.mock.invocationCallOrder[0]
        ).toBeLessThan(
            providerMock.deleteCardToken.mock.invocationCallOrder[0]
        );
        expect(
            providerMock.chargeByToken.mock.invocationCallOrder[0]
        ).toBeLessThan(emailMock.sendCardChanged.mock.invocationCallOrder[0]);

        const updated = await profileModel.findOne({ userId: user._id });
        expect(updated?.status).toBe(SUBSCRIPTION_STATUS.ACTIVE);
        expect(updated?.currentPeriodEnd?.toISOString()).toBe(
            '2026-06-10T09:00:00.000Z'
        );
        expect(updated?.dunningAttempts).toBe(0);
    });

    it('відмова списання після заміни картки не забирає спробу прострочки', async () => {
        // Заміну ініціював сам платник, а не розклад: інакше заміна картки на
        // останньому дні прострочки вимикала б доступ миттєво.
        const user = await createUser();
        const nextRetryAt = new Date(Date.now() + 3600_000);
        await seedActiveProfile(user, {
            status: SUBSCRIPTION_STATUS.PAST_DUE,
            currentPeriodEnd: new Date('2026-05-10T09:00:00.000Z'),
            nextChargeAt: null,
            nextRetryAt,
            dunningAttempts: BILLING_DUNNING.maxAttempts - 1,
        });

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/card/verification')
            .set('Authorization', bearerFor(user))
            .send({})
            .expect(200);
        const orderReference =
            (res.body as { data: { checkoutUrl: string } }).data.checkoutUrl
                .split('/')
                .pop() ?? '';

        providerMock.chargeByToken.mockResolvedValueOnce({
            invoiceId: 'inv_debt_declined',
            status: MONOBANK_INVOICE_STATUS.FAILURE,
            cardToken: null,
            failureReason: 'insufficient funds',
            errCode: '51',
            cardMask: '** 4242',
            cardPaymentMethod: 'pan',
            cardPaymentSystem: 'visa',
            cardBank: 'monobank',
        });

        await postWebhook(
            makeEvent({
                orderReference,
                invoiceId: 'inv_cvf_last_day',
                providerEventId: 'inv_cvf_last_day:success',
                amount: 0,
                cardToken: 'tok-new',
                cardMask: '** 4242',
            })
        );

        expect(providerMock.chargeByToken).toHaveBeenCalledTimes(1);
        const updated = await profileModel.findOne({ userId: user._id });
        expect(updated?.cardToken).toBe('tok-new');
        expect(updated?.status).toBe(SUBSCRIPTION_STATUS.PAST_DUE);
        expect(updated?.dunningAttempts).toBe(BILLING_DUNNING.maxAttempts - 1);
        expect(updated?.nextRetryAt?.getTime()).toBe(nextRetryAt.getTime());
        expect(emailMock.sendSubscriptionEnded).not.toHaveBeenCalled();
        expect(emailMock.sendSubscriptionPastDue).not.toHaveBeenCalled();
        const record = await paymentRecordModel.findOne({ userId: user._id });
        expect(record?.status).toBe(PAYMENT_RECORD_STATUS.DECLINED);
    });

    // ─── Повернення після вимкнення доступу ───

    it('оплата збереженою карткою після вимкнення → новий місяць від дня оплати, бренд повернуто', async () => {
        const user = await createUser();
        const business = await createBusiness(user);
        await seedActiveProfile(user, {
            status: SUBSCRIPTION_STATUS.UNPAID,
            anchorDay: 10,
            currentPeriodEnd: new Date('2026-05-10T09:00:00.000Z'),
            nextChargeAt: null,
            dunningAttempts: BILLING_DUNNING.maxAttempts,
            dunningExhaustedAt: new Date('2026-05-20T09:00:00.000Z'),
            brand: { capacity: 1, attachedBusinessIds: [business._id] },
        });
        providerMock.chargeByToken.mockResolvedValueOnce({
            invoiceId: 'inv_rea',
            status: MONOBANK_INVOICE_STATUS.SUCCESS,
            cardToken: 'tok-1',
            failureReason: null,
            errCode: null,
            cardMask: '** 1111',
            cardPaymentMethod: 'pan',
            cardPaymentSystem: 'mastercard',
            cardBank: 'ПриватБанк',
        });

        const before = Date.now();
        const res = await supertest(app.getHttpServer())
            .post('/api/payments/subscription/reactivate')
            .set('Authorization', bearerFor(user))
            .expect(200);
        expect(
            (res.body as { data: { scheduled: boolean } }).data.scheduled
        ).toBe(false);

        const charged = providerMock.chargeByToken.mock.calls[0][0];
        expect(charged.amount).toBe(BILLING_GRID.brand.pricePerBusiness);
        expect(charged.orderReference.startsWith('fin-rea-')).toBe(true);

        const updated = await profileModel.findOne({ userId: user._id });
        expect(updated?.status).toBe(SUBSCRIPTION_STATUS.ACTIVE);
        // Місяць рахується від дня оплати, а не від старої межі: дні без
        // доступу прощено, і планувальник не списує кілька місяців поспіль.
        expect(
            updated?.currentPeriodStart?.getTime() ?? 0
        ).toBeGreaterThanOrEqual(before);
        expect(updated?.currentPeriodEnd?.getTime() ?? 0).toBeGreaterThan(
            Date.now()
        );
        expect(updated?.anchorDay).toBe(new Date().getDate());
        expect(updated?.dunningAttempts).toBe(0);
        expect(updated?.dunningExhaustedAt).toBeNull();
        // Бренд прикріпленого отримувача ввімкнено назад.
        const branded = await businessModel.findById(business._id);
        expect(branded?.brandedAt).toBeTruthy();
    });

    it('покинута нова купівля не забирає повернення збереженою карткою', async () => {
        const user = await createUser();
        await seedActiveProfile(user, {
            status: SUBSCRIPTION_STATUS.UNPAID,
            anchorDay: 10,
            currentPeriodEnd: new Date('2026-05-10T09:00:00.000Z'),
            nextChargeAt: null,
            dunningAttempts: BILLING_DUNNING.maxAttempts,
            dunningExhaustedAt: new Date('2026-05-20T09:00:00.000Z'),
        });
        // Платник натиснув купівлю і не дійшов до оплати: статус переїхав на
        // INCOMPLETE, а стан «доступ вимкнено несплатою» лишився тим самим.
        await supertest(app.getHttpServer())
            .post('/api/payments/checkout')
            .set('Authorization', bearerFor(user))
            .send({ universe: BILLING_UNIVERSE.BRAND, capacity: 1 })
            .expect(201);
        expect((await profileModel.findOne({ userId: user._id }))?.status).toBe(
            SUBSCRIPTION_STATUS.INCOMPLETE
        );
        const view = await supertest(app.getHttpServer())
            .get('/api/payments/profile')
            .set('Authorization', bearerFor(user))
            .expect(200);
        const shown = (
            view.body as {
                data: {
                    accessDisabledByNonPayment: boolean;
                    nextChargeAmount: number;
                };
            }
        ).data;
        expect(shown.accessDisabledByNonPayment).toBe(true);
        expect(shown.nextChargeAmount).toBe(
            BILLING_GRID.brand.pricePerBusiness
        );

        providerMock.chargeByToken.mockResolvedValueOnce({
            invoiceId: 'inv_rea_after_checkout',
            status: MONOBANK_INVOICE_STATUS.SUCCESS,
            cardToken: 'tok-1',
            failureReason: null,
            errCode: null,
            cardMask: '** 1111',
            cardPaymentMethod: 'pan',
            cardPaymentSystem: 'mastercard',
            cardBank: 'ПриватБанк',
        });

        await supertest(app.getHttpServer())
            .post('/api/payments/subscription/reactivate')
            .set('Authorization', bearerFor(user))
            .expect(200);

        const updated = await profileModel.findOne({ userId: user._id });
        expect(updated?.status).toBe(SUBSCRIPTION_STATUS.ACTIVE);
        expect(updated?.dunningExhaustedAt).toBeNull();
    });

    it('покинута нова купівля не змінює склад, який відновлює повернення', async () => {
        // Живі поля складу для вимкненого профілю означають «що платник хоче
        // купити»: `startCheckout` перезаписує їх навіть тоді, коли платник
        // закрив сторінку банку. Повернення мусить спиратись на знімок складу
        // з моменту вимкнення, інакше воно тихо оплатило б менший склад і
        // загубило прикріплення, за які вже заплачено.
        const user = await createUser();
        // Slug задаємо явно: авто-slug helper-а бере перші 8 hex ObjectId (це
        // мітка часу), тож два отримувачі в одну секунду зіткнулись би.
        const first = await createBusiness(user, {
            slug: 'snap-first',
            slugLower: 'snap-first',
        });
        const second = await createBusiness(user, {
            slug: 'snap-second',
            slugLower: 'snap-second',
            taxId: '1234567898',
        });
        await seedActiveProfile(user, {
            status: SUBSCRIPTION_STATUS.PAST_DUE,
            dunningAttempts: BILLING_DUNNING.maxAttempts - 1,
            nextChargeAt: null,
            nextRetryAt: new Date(Date.now() - 1000),
            brand: {
                capacity: 2,
                attachedBusinessIds: [first._id, second._id],
            },
        });
        providerMock.chargeByToken.mockResolvedValueOnce({
            invoiceId: 'inv_last_fail',
            status: MONOBANK_INVOICE_STATUS.FAILURE,
            cardToken: null,
            failureReason: 'insufficient funds',
            errCode: '51',
            cardMask: '** 1111',
            cardPaymentMethod: 'pan',
            cardPaymentSystem: 'mastercard',
            cardBank: 'ПриватБанк',
        });
        await app.get(BillingClockService).runBillingClock();
        expect((await profileModel.findOne({ userId: user._id }))?.status).toBe(
            SUBSCRIPTION_STATUS.UNPAID
        );

        // Платник відкриває купівлю одного слота і не доводить її до оплати.
        await supertest(app.getHttpServer())
            .post('/api/payments/checkout')
            .set('Authorization', bearerFor(user))
            .send({ universe: BILLING_UNIVERSE.BRAND, capacity: 1 })
            .expect(201);
        const abandoned = await profileModel.findOne({ userId: user._id });
        expect(abandoned?.brand.capacity).toBe(1);

        // Кабінет далі називає суму оплаченого складу, а не покинутого.
        const view = await supertest(app.getHttpServer())
            .get('/api/payments/profile')
            .set('Authorization', bearerFor(user))
            .expect(200);
        expect(
            (view.body as { data: { nextChargeAmount: number } }).data
                .nextChargeAmount
        ).toBe(2 * BILLING_GRID.brand.pricePerBusiness);

        providerMock.chargeByToken.mockResolvedValueOnce({
            invoiceId: 'inv_rea_snapshot',
            status: MONOBANK_INVOICE_STATUS.SUCCESS,
            cardToken: 'tok-1',
            failureReason: null,
            errCode: null,
            cardMask: '** 1111',
            cardPaymentMethod: 'pan',
            cardPaymentSystem: 'mastercard',
            cardBank: 'ПриватБанк',
        });
        await supertest(app.getHttpServer())
            .post('/api/payments/subscription/reactivate')
            .set('Authorization', bearerFor(user))
            .expect(200);

        const charged = providerMock.chargeByToken.mock.calls[1][0];
        expect(charged.amount).toBe(2 * BILLING_GRID.brand.pricePerBusiness);

        const updated = await profileModel.findOne({ userId: user._id });
        expect(updated?.status).toBe(SUBSCRIPTION_STATUS.ACTIVE);
        expect(updated?.brand.capacity).toBe(2);
        expect(
            updated?.brand.attachedBusinessIds.map((id) => id.toString()).sort()
        ).toEqual([first._id.toString(), second._id.toString()].sort());
        expect(updated?.disabledSnapshot).toBeNull();
        // Обидва отримувачі повернули бренд, не лише той, що пережив покинуту
        // купівлю.
        for (const business of [first, second]) {
            const branded = await businessModel.findById(business._id);
            expect(branded?.brandedAt).toBeTruthy();
        }
    });

    it('повторне натискання повернення не списує вдруге', async () => {
        const user = await createUser();
        await seedActiveProfile(user, {
            status: SUBSCRIPTION_STATUS.UNPAID,
            currentPeriodEnd: new Date('2026-05-10T09:00:00.000Z'),
            nextChargeAt: null,
        });
        // Перше натискання лишило нерозв'язану спробу (банк ще думає).
        providerMock.chargeByToken.mockResolvedValueOnce({
            invoiceId: 'inv_rea_proc',
            status: 'processing',
            cardToken: null,
            failureReason: null,
            errCode: null,
            cardMask: '** 1111',
            cardPaymentMethod: 'pan',
            cardPaymentSystem: 'mastercard',
            cardBank: 'ПриватБанк',
        });
        await supertest(app.getHttpServer())
            .post('/api/payments/subscription/reactivate')
            .set('Authorization', bearerFor(user))
            .expect(200);

        // Друге натискання, поки перша спроба не розв'язана: чесне «зачекайте»
        // замість другого походу по гроші.
        const res = await supertest(app.getHttpServer())
            .post('/api/payments/subscription/reactivate')
            .set('Authorization', bearerFor(user))
            .expect(409);
        expect((res.body as { error: { code: string } }).error.code).toBe(
            'BILLING_OPERATION_IN_PROGRESS'
        );
        expect(providerMock.chargeByToken).toHaveBeenCalledTimes(1);
        const records = await paymentRecordModel.find({ userId: user._id });
        expect(records).toHaveLength(1);

        // Завислу спробу добиває планувальник: маршрутизація за видом операції,
        // інакше запис лишився б PENDING назавжди і мовчки блокував платні дії.
        // Зістарюємо запис — свіжі клок свідомо не чіпає (їх ще може вести
        // живий творець під локом).
        await paymentRecordModel.collection.updateOne(
            { _id: records[0]._id },
            { $set: { createdAt: new Date(Date.now() - 3600_000) } }
        );
        providerMock.getInvoiceStatus.mockResolvedValueOnce({
            ...makeEvent({
                orderReference: records[0].orderReference,
                invoiceId: 'inv_rea_proc',
                providerEventId: 'inv_rea_proc:success',
            }),
        });
        await app.get(BillingClockService).runBillingClock();

        const settled = await paymentRecordModel.findOne({
            userId: user._id,
        });
        expect(settled?.status).toBe(PAYMENT_RECORD_STATUS.APPROVED);
        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.status).toBe(SUBSCRIPTION_STATUS.ACTIVE);
    });

    it('повернення, що пройшло вже після купівлі заново, не зараховується мовчки: ручний розбір', async () => {
        const user = await createUser();
        await seedActiveProfile(user, {
            status: SUBSCRIPTION_STATUS.UNPAID,
            anchorDay: 10,
            currentPeriodEnd: new Date('2026-05-10T09:00:00.000Z'),
            nextChargeAt: null,
        });
        providerMock.chargeByToken.mockResolvedValueOnce({
            invoiceId: 'inv_rea_slow',
            status: MONOBANK_INVOICE_STATUS.PROCESSING,
            cardToken: null,
            failureReason: null,
            errCode: null,
            cardMask: '** 1111',
            cardPaymentMethod: 'pan',
            cardPaymentSystem: 'mastercard',
            cardBank: 'ПриватБанк',
        });
        await supertest(app.getHttpServer())
            .post('/api/payments/subscription/reactivate')
            .set('Authorization', bearerFor(user))
            .expect(200);
        const reactivationRef = providerMock.chargeByToken.mock.calls[0][0]
            .orderReference as string;

        // Не дочекавшись банку, платник купує підписку звичайним шляхом.
        await supertest(app.getHttpServer())
            .post('/api/payments/checkout')
            .set('Authorization', bearerFor(user))
            .send({ universe: BILLING_UNIVERSE.BRAND, capacity: 1 })
            .expect(201);
        const checkoutRef =
            providerMock.createSubscriptionCheckout.mock.calls[0][0]
                .orderReference;
        await postWebhook(
            makeEvent({
                orderReference: checkoutRef,
                invoiceId: 'inv_rebuy',
                providerEventId: 'inv_rebuy:success',
                amount: BILLING_GRID.brand.pricePerBusiness,
            })
        );
        const afterRebuy = await profileModel.findOne({ userId: user._id });
        expect(afterRebuy?.status).toBe(SUBSCRIPTION_STATUS.ACTIVE);

        // Банк доробив повернення: другі гроші.
        await postWebhook(
            makeEvent({
                orderReference: reactivationRef,
                invoiceId: 'inv_rea_slow',
                providerEventId: 'inv_rea_slow:success',
                amount: BILLING_GRID.brand.pricePerBusiness,
            })
        );

        const updated = await profileModel.findOne({ userId: user._id });
        expect(updated?.status).toBe(SUBSCRIPTION_STATUS.ACTIVE);
        expect(updated?.currentPeriodEnd?.toISOString()).toBe(
            afterRebuy?.currentPeriodEnd?.toISOString()
        );
        expect(updated?.needsManualReview).toBe(true);
        const record = await paymentRecordModel.findOne({
            orderReference: reactivationRef,
        });
        expect(record?.status).toBe(PAYMENT_RECORD_STATUS.APPROVED);
        expect(record?.type).toBe(PAYMENT_RECORD_TYPE.UNMATCHED);
    });

    it('відмова банку лишає доступ вимкненим', async () => {
        const user = await createUser();
        await seedActiveProfile(user, {
            status: SUBSCRIPTION_STATUS.UNPAID,
            currentPeriodEnd: new Date('2026-05-10T09:00:00.000Z'),
            nextChargeAt: null,
        });
        providerMock.chargeByToken.mockResolvedValueOnce({
            invoiceId: 'inv_rea_fail',
            status: MONOBANK_INVOICE_STATUS.FAILURE,
            cardToken: null,
            failureReason: 'insufficient funds',
            errCode: '51',
            cardMask: '** 1111',
            cardPaymentMethod: 'pan',
            cardPaymentSystem: 'mastercard',
            cardBank: 'ПриватБанк',
        });

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/subscription/reactivate')
            .set('Authorization', bearerFor(user))
            .expect(400);
        expect((res.body as { error: { code: string } }).error.code).toBe(
            'BILLING_CHARGE_DECLINED'
        );
        const updated = await profileModel.findOne({ userId: user._id });
        expect(updated?.status).toBe(SUBSCRIPTION_STATUS.UNPAID);
    });

    it('повернення на активному профілі → 400 BILLING_NOT_DISABLED', async () => {
        const user = await createUser();
        await seedActiveProfile(user);

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/subscription/reactivate')
            .set('Authorization', bearerFor(user))
            .expect(400);
        expect((res.body as { error: { code: string } }).error.code).toBe(
            'BILLING_NOT_DISABLED'
        );
        expect(providerMock.chargeByToken).not.toHaveBeenCalled();
    });

    it('повернення без збереженої картки → 400 BILLING_CARD_REQUIRED', async () => {
        const user = await createUser();
        await seedActiveProfile(user, {
            status: SUBSCRIPTION_STATUS.UNPAID,
            cardToken: null,
            nextChargeAt: null,
        });

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/subscription/reactivate')
            .set('Authorization', bearerFor(user))
            .expect(400);
        expect((res.body as { error: { code: string } }).error.code).toBe(
            'BILLING_CARD_REQUIRED'
        );
    });

    it('повернення: банк не знає токена (400) → 400 BILLING_CHARGE_DECLINED, запис спроби звільнено', async () => {
        // Відмова саме за карткою остаточна: повтор тією самою карткою дасть те
        // саме. Кажемо це кодом відмови банку, щоб кабінет вів на заміну картки,
        // а не пропонував зачекати і натиснути ще раз.
        const user = await createUser();
        await seedActiveProfile(user, {
            status: SUBSCRIPTION_STATUS.UNPAID,
            nextChargeAt: null,
            dunningExhaustedAt: new Date(),
        });
        providerMock.chargeByToken.mockRejectedValueOnce(
            new ProviderRequestError(
                'monobank HTTP 400: unknown card token',
                true,
                400
            )
        );

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/subscription/reactivate')
            .set('Authorization', bearerFor(user))
            .expect(400);
        expect((res.body as { error: { code: string } }).error.code).toBe(
            'BILLING_CHARGE_DECLINED'
        );

        // Гроші точно не рухались: запис спроби звільнено, тож заміна картки і
        // повторна оплата не впираються у «попередня операція ще виконується».
        const records = await paymentRecordModel.find({ userId: user._id });
        expect(records).toHaveLength(0);
        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.status).toBe(SUBSCRIPTION_STATUS.UNPAID);
        expect(profile?.needsManualReview).toBe(false);
    });

    // ─── Прив'язка і заміна картки ───

    it('заміна картки: нульовий рахунок зберігає нову картку, стару відкликано, підписка не зачеплена', async () => {
        const user = await createUser();
        const profile = await seedActiveProfile(user);

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/card/verification')
            .set('Authorization', bearerFor(user))
            .send({ returnPath: '/billing' })
            .expect(200);
        const { checkoutUrl } = (res.body as { data: { checkoutUrl: string } })
            .data;
        const orderReference = checkoutUrl.split('/').pop() ?? '';
        expect(orderReference.startsWith('fin-cvf-')).toBe(true);
        // Верифікація йде саме нульовим рахунком, а не списанням.
        expect(providerMock.createCardVerification).toHaveBeenCalledTimes(1);
        expect(providerMock.chargeByToken).not.toHaveBeenCalled();

        await postWebhook(
            makeEvent({
                orderReference,
                invoiceId: 'inv_cvf',
                providerEventId: 'inv_cvf:success',
                amount: 0,
                cardToken: 'tok-new',
                cardMask: '** 4242',
            })
        );

        const updated = await profileModel.findOne({ userId: user._id });
        expect(updated?.cardToken).toBe('tok-new');
        expect(updated?.cardMask).toBe('** 4242');
        // Нульовий рахунок не має жодного шляху зрушити підписку.
        expect(updated?.status).toBe(SUBSCRIPTION_STATUS.ACTIVE);
        expect(updated?.currentPeriodEnd?.getTime()).toBe(
            profile.currentPeriodEnd?.getTime()
        );
        expect(updated?.needsManualReview).toBe(false);
        expect(updated?.brand.capacity).toBe(1);
        // Стару картку відкликано у банку, нову — ні.
        expect(providerMock.deleteCardToken).toHaveBeenCalledWith('tok-1');
        expect(providerMock.deleteCardToken).not.toHaveBeenCalledWith(
            'tok-new'
        );
        // Банк підтвердив відкликання — черга порожня.
        expect(updated?.pendingRevokeCardTokens).toEqual([]);
        expect(emailMock.sendCardChanged).toHaveBeenCalledTimes(1);
        // Нульовий рахунок не є рухом грошей і в історію не потрапляє.
        const records = await paymentRecordModel.find({ userId: user._id });
        expect(records).toHaveLength(0);
    });

    it('проміжний статус прив’язки картки: подію закрито як оброблену, картку не зачеплено', async () => {
        const user = await createUser();
        await seedActiveProfile(user);

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/card/verification')
            .set('Authorization', bearerFor(user))
            .send({})
            .expect(200);
        const orderReference =
            (res.body as { data: { checkoutUrl: string } }).data.checkoutUrl
                .split('/')
                .pop() ?? '';

        await postWebhook(
            makeEvent({
                orderReference,
                invoiceId: 'inv_cvf_proc',
                providerEventId: 'inv_cvf_proc:processing',
                status: MONOBANK_INVOICE_STATUS.PROCESSING,
                amount: 0,
                cardToken: null,
            })
        );

        // Лишена «в роботі», подія виглядала б для фонової чистки як
        // обробка, що впала посередині.
        const eventModel = app.get<Model<ProcessedWebhookEventDocument>>(
            getModelToken(ProcessedWebhookEvent.name)
        );
        const stored = await eventModel
            .findOne({ providerEventId: 'inv_cvf_proc:processing' })
            .lean();
        expect(stored?.status).toBe('applied');
        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.cardToken).toBe('tok-1');
        expect(profile?.cardVerification?.status).toBe(
            CARD_VERIFICATION_STATUS.PENDING
        );
    });

    it('заміна картки не лишає у профілі даних попередньої', async () => {
        // `paymentInfo` приходить не повним, а поля картки навмисно не
        // затираються порожнім (щоб циклові списання не стирали відоме). При
        // ЗАМІНІ це працювало б проти платника: банк-емітент і платіжна
        // система старої картки лишились би поруч з маскою нової, і кабінет
        // показував би картку, якої не існує.
        const user = await createUser();
        await seedActiveProfile(user, {
            cardMask: '** 1111',
            cardPaymentMethod: 'pan',
            cardPaymentSystem: 'mastercard',
            cardBank: 'ПриватБанк',
        });

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/card/verification')
            .set('Authorization', bearerFor(user))
            .send({})
            .expect(200);
        const orderReference =
            (res.body as { data: { checkoutUrl: string } }).data.checkoutUrl
                .split('/')
                .pop() ?? '';

        await postWebhook(
            makeEvent({
                orderReference,
                invoiceId: 'inv_cvf_partial',
                providerEventId: 'inv_cvf_partial:success',
                amount: 0,
                cardToken: 'tok-new',
                cardMask: '** 4242',
                cardPaymentMethod: null,
                cardPaymentSystem: null,
                cardBank: null,
            })
        );

        const updated = await profileModel.findOne({ userId: user._id });
        expect(updated?.cardToken).toBe('tok-new');
        expect(updated?.cardMask).toBe('** 4242');
        expect(updated?.cardPaymentSystem).toBeNull();
        expect(updated?.cardBank).toBeNull();
        expect(updated?.cardPaymentMethod).toBeNull();
    });

    it('«оплатити зараз» іншою карткою → стару картку відкликано, дані показу не змішані', async () => {
        const user = await createUser();
        await seedActiveProfile(user, {
            status: SUBSCRIPTION_STATUS.PAST_DUE,
            anchorDay: 10,
            currentPeriodEnd: new Date('2026-05-10T09:00:00.000Z'),
            nextChargeAt: null,
            nextRetryAt: new Date(Date.now() + 3600_000),
            cardPaymentSystem: 'mastercard',
            cardBank: 'ПриватБанк',
        });

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/subscription/resume')
            .set('Authorization', bearerFor(user))
            .send({})
            .expect(200);
        const orderReference =
            (res.body as { data: { checkoutUrl: string } }).data.checkoutUrl
                .split('/')
                .pop() ?? '';

        await postWebhook(
            makeEvent({
                orderReference,
                invoiceId: 'inv_resume_new_card',
                providerEventId: 'inv_resume_new_card:success',
                amount: BILLING_GRID.brand.pricePerBusiness,
                cardToken: 'tok-new',
                cardMask: '** 4242',
                cardPaymentSystem: null,
                cardBank: null,
            })
        );

        const updated = await profileModel.findOne({ userId: user._id });
        expect(updated?.status).toBe(SUBSCRIPTION_STATUS.ACTIVE);
        expect(updated?.cardToken).toBe('tok-new');
        expect(updated?.cardMask).toBe('** 4242');
        expect(updated?.cardBank).toBeNull();
        expect(updated?.cardPaymentSystem).toBeNull();
        expect(providerMock.deleteCardToken).toHaveBeenCalledWith('tok-1');
        expect(providerMock.deleteCardToken).not.toHaveBeenCalledWith(
            'tok-new'
        );
        expect(updated?.pendingRevokeCardTokens).toEqual([]);
    });

    it('нова купівля іншою карткою після вимкнення доступу → збережену картку відкликано', async () => {
        const user = await createUser();
        await seedActiveProfile(user, {
            status: SUBSCRIPTION_STATUS.UNPAID,
            nextChargeAt: null,
            dunningExhaustedAt: new Date(Date.now() - 24 * 3600_000),
        });

        await supertest(app.getHttpServer())
            .post('/api/payments/checkout')
            .set('Authorization', bearerFor(user))
            .send({ universe: BILLING_UNIVERSE.BRAND, capacity: 1 })
            .expect(201);
        const orderReference =
            providerMock.createSubscriptionCheckout.mock.calls[0][0]
                .orderReference;

        await postWebhook(
            makeEvent({
                orderReference,
                invoiceId: 'inv_back_new_card',
                providerEventId: 'inv_back_new_card:success',
                amount: BILLING_GRID.brand.pricePerBusiness,
                cardToken: 'tok-new',
                cardMask: '** 4242',
            })
        );

        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.status).toBe(SUBSCRIPTION_STATUS.ACTIVE);
        expect(profile?.cardToken).toBe('tok-new');
        expect(providerMock.deleteCardToken).toHaveBeenCalledWith('tok-1');
        expect(profile?.pendingRevokeCardTokens).toEqual([]);
    });

    it("прив'язку картки не відкидає списання, оброблене раніше за її сповіщення", async () => {
        // Списання (з часом нашого сервера) пройшло, поки сповіщення про картку
        // чекало черги. Порядок подій різних видів для картки не важливий.
        const user = await createUser();
        await seedActiveProfile(user, {
            lastProviderEventAt: new Date(Date.now() + 60_000),
        });

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/card/verification')
            .set('Authorization', bearerFor(user))
            .send({})
            .expect(200);
        const orderReference =
            (res.body as { data: { checkoutUrl: string } }).data.checkoutUrl
                .split('/')
                .pop() ?? '';

        await postWebhook(
            makeEvent({
                orderReference,
                invoiceId: 'inv_cvf_late',
                providerEventId: 'inv_cvf_late:success',
                amount: 0,
                cardToken: 'tok-new',
            })
        );

        const updated = await profileModel.findOne({ userId: user._id });
        expect(updated?.cardToken).toBe('tok-new');
        expect(updated?.cardVerification?.status).toBe(
            CARD_VERIFICATION_STATUS.SAVED
        );
        expect(providerMock.deleteCardToken).toHaveBeenCalledWith('tok-1');
    });

    it("застаріла прив'язка не перезаписує новішу картку, а її токен відкликано", async () => {
        const user = await createUser();
        await seedActiveProfile(user, {
            cardVerifiedAt: new Date(Date.now() + 60_000),
        });

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/card/verification')
            .set('Authorization', bearerFor(user))
            .send({})
            .expect(200);
        const orderReference =
            (res.body as { data: { checkoutUrl: string } }).data.checkoutUrl
                .split('/')
                .pop() ?? '';

        await postWebhook(
            makeEvent({
                orderReference,
                invoiceId: 'inv_cvf_stale',
                providerEventId: 'inv_cvf_stale:success',
                amount: 0,
                cardToken: 'tok-stale',
            })
        );

        const updated = await profileModel.findOne({ userId: user._id });
        expect(updated?.cardToken).toBe('tok-1');
        expect(updated?.cardVerification?.status).toBe(
            CARD_VERIFICATION_STATUS.FAILED
        );
        expect(providerMock.deleteCardToken).toHaveBeenCalledWith('tok-stale');
        expect(providerMock.deleteCardToken).not.toHaveBeenCalledWith('tok-1');
        expect(updated?.pendingRevokeCardTokens).toEqual([]);
        expect(emailMock.sendCardChanged).not.toHaveBeenCalled();
    });

    it("прив'язка заради відновлення повертає скасовану підписку без другого натискання", async () => {
        const user = await createUser();
        const profile = await seedActiveProfile(user, {
            cardToken: null,
            cardMask: null,
            cancelAtPeriodEnd: true,
            nextChargeAt: null,
        });

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/card/verification')
            .set('Authorization', bearerFor(user))
            .send({ renewAfterSave: true, returnPath: '/billing' })
            .expect(200);
        const orderReference =
            (res.body as { data: { checkoutUrl: string } }).data.checkoutUrl
                .split('/')
                .pop() ?? '';
        expect(orderReference.startsWith('fin-cvr-')).toBe(true);

        await postWebhook(
            makeEvent({
                orderReference,
                invoiceId: 'inv_cvr',
                providerEventId: 'inv_cvr:success',
                amount: 0,
                cardToken: 'tok-new',
            })
        );

        const updated = await profileModel.findOne({ userId: user._id });
        expect(updated?.cardToken).toBe('tok-new');
        expect(updated?.cancelAtPeriodEnd).toBe(false);
        expect(updated?.nextChargeAt?.getTime()).toBe(
            profile.currentPeriodEnd?.getTime()
        );
    });

    it('підписка згасла, поки платник був на сторінці банку → картку збережено, відновлення не сталось', async () => {
        const user = await createUser();
        await seedActiveProfile(user, {
            cardToken: null,
            cardMask: null,
            cancelAtPeriodEnd: true,
            nextChargeAt: null,
        });

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/card/verification')
            .set('Authorization', bearerFor(user))
            .send({ renewAfterSave: true })
            .expect(200);
        const orderReference =
            (res.body as { data: { checkoutUrl: string } }).data.checkoutUrl
                .split('/')
                .pop() ?? '';

        // Фонове згасання скасованих профілів працює без per-user лока і цілком
        // могло пройти, поки платник вводив картку на сторінці банку.
        await profileModel.updateOne(
            { userId: user._id },
            {
                $set: {
                    status: SUBSCRIPTION_STATUS.CANCELED,
                    currentPeriodEnd: new Date(Date.now() - 3600_000),
                },
            }
        );

        await postWebhook(
            makeEvent({
                orderReference,
                invoiceId: 'inv_cvr_late',
                providerEventId: 'inv_cvr_late:success',
                amount: 0,
                cardToken: 'tok-new',
            })
        );

        // Картку банк уже токенізував, тож вона зберігається. А підписку
        // відновлювати нема чого: доступ уже погашено, і відновлення роздало б
        // його безкоштовно.
        const updated = await profileModel.findOne({ userId: user._id });
        expect(updated?.cardToken).toBe('tok-new');
        expect(updated?.cancelAtPeriodEnd).toBe(true);
        expect(updated?.nextChargeAt).toBeNull();
        expect(updated?.status).toBe(SUBSCRIPTION_STATUS.CANCELED);
    });

    it("прив'язка заради відновлення на нескасованій підписці → 400 ще до походу в банк", async () => {
        const user = await createUser();
        await seedActiveProfile(user);

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/card/verification')
            .set('Authorization', bearerFor(user))
            .send({ renewAfterSave: true })
            .expect(400);
        expect((res.body as { error: { code: string } }).error.code).toBe(
            'BILLING_NOT_CANCELED'
        );
        expect(providerMock.createCardVerification).not.toHaveBeenCalled();
    });

    it('невдала верифікація не чіпає збережену картку', async () => {
        const user = await createUser();
        await seedActiveProfile(user);

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/card/verification')
            .set('Authorization', bearerFor(user))
            .send({})
            .expect(200);
        const orderReference =
            (res.body as { data: { checkoutUrl: string } }).data.checkoutUrl
                .split('/')
                .pop() ?? '';

        await postWebhook(
            makeEvent({
                orderReference,
                invoiceId: 'inv_cvf_fail',
                providerEventId: 'inv_cvf_fail:failure',
                status: MONOBANK_INVOICE_STATUS.FAILURE,
                amount: 0,
                cardToken: null,
                cardMask: null,
            })
        );

        const updated = await profileModel.findOne({ userId: user._id });
        expect(updated?.cardToken).toBe('tok-1');
        expect(updated?.cardMask).toBe('** 1111');
        expect(providerMock.deleteCardToken).not.toHaveBeenCalled();
        expect(emailMock.sendCardChanged).not.toHaveBeenCalled();
    });

    it('заміна картки доступна на профілі, вимкненому за несплатою', async () => {
        const user = await createUser();
        await seedActiveProfile(user, {
            status: SUBSCRIPTION_STATUS.UNPAID,
            nextChargeAt: null,
            dunningExhaustedAt: new Date(),
        });

        await supertest(app.getHttpServer())
            .post('/api/payments/card/verification')
            .set('Authorization', bearerFor(user))
            .send({})
            .expect(200);
        expect(providerMock.createCardVerification).toHaveBeenCalledTimes(1);
    });

    it('повернення з банку раніше за сповіщення: результат дозвіряється у банку, повтор сповіщення нічого не дублює', async () => {
        const user = await createUser();
        await seedActiveProfile(user);

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/card/verification')
            .set('Authorization', bearerFor(user))
            .send({ returnPath: '/billing' })
            .expect(200);
        const orderReference =
            (res.body as { data: { checkoutUrl: string } }).data.checkoutUrl
                .split('/')
                .pop() ?? '';
        // Повернення веде на сторінку результату прив'язки, а не «Оплату здійснено».
        expect(providerMock.createCardVerification).toHaveBeenCalledWith(
            expect.objectContaining({
                returnUrl:
                    'https://finly.com.ua/billing-return?returnPath=%2Fbilling&flow=card',
            })
        );

        const event = makeEvent({
            orderReference,
            invoiceId: 'inv_cvf_pull',
            providerEventId: 'inv_cvf_pull:success',
            amount: 0,
            cardToken: 'tok-new',
            cardMask: '** 4242',
        });
        providerMock.getInvoiceStatus.mockResolvedValueOnce(event);

        const result = await supertest(app.getHttpServer())
            .post('/api/payments/card/verification/result')
            .set('Authorization', bearerFor(user))
            .expect(200);
        expect((result.body as { data: { status: string } }).data.status).toBe(
            'saved'
        );
        expect(providerMock.getInvoiceStatus).toHaveBeenCalledWith(
            `inv_${orderReference}`,
            orderReference
        );
        const updated = await profileModel.findOne({ userId: user._id });
        expect(updated?.cardToken).toBe('tok-new');

        await postWebhook(event);
        expect(emailMock.sendCardChanged).toHaveBeenCalledTimes(1);
        expect(providerMock.deleteCardToken).toHaveBeenCalledTimes(1);
        expect(providerMock.deleteCardToken).toHaveBeenCalledWith('tok-1');
    });

    it('банк відхилив картку → сторінка повернення отримує «не вдалося», стара картка чинна', async () => {
        const user = await createUser();
        await seedActiveProfile(user);

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/card/verification')
            .set('Authorization', bearerFor(user))
            .send({})
            .expect(200);
        const orderReference =
            (res.body as { data: { checkoutUrl: string } }).data.checkoutUrl
                .split('/')
                .pop() ?? '';

        providerMock.getInvoiceStatus.mockResolvedValueOnce(
            makeEvent({
                orderReference,
                invoiceId: 'inv_cvf_pull_fail',
                providerEventId: 'inv_cvf_pull_fail:failure',
                status: MONOBANK_INVOICE_STATUS.FAILURE,
                amount: 0,
                cardToken: null,
                cardMask: null,
            })
        );

        const result = await supertest(app.getHttpServer())
            .post('/api/payments/card/verification/result')
            .set('Authorization', bearerFor(user))
            .expect(200);
        expect((result.body as { data: { status: string } }).data.status).toBe(
            'failed'
        );
        const updated = await profileModel.findOne({ userId: user._id });
        expect(updated?.cardToken).toBe('tok-1');
        expect(providerMock.deleteCardToken).not.toHaveBeenCalled();
    });

    it('банк ще не дав остаточної відповіді → «перевіряється», картка не чіпається', async () => {
        const user = await createUser();
        await seedActiveProfile(user);

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/card/verification')
            .set('Authorization', bearerFor(user))
            .send({})
            .expect(200);
        const orderReference =
            (res.body as { data: { checkoutUrl: string } }).data.checkoutUrl
                .split('/')
                .pop() ?? '';

        providerMock.getInvoiceStatus.mockResolvedValueOnce(
            makeEvent({
                orderReference,
                invoiceId: 'inv_cvf_pull_proc',
                providerEventId: 'inv_cvf_pull_proc:processing',
                status: MONOBANK_INVOICE_STATUS.PROCESSING,
                amount: 0,
                cardToken: null,
            })
        );

        const result = await supertest(app.getHttpServer())
            .post('/api/payments/card/verification/result')
            .set('Authorization', bearerFor(user))
            .expect(200);
        expect((result.body as { data: { status: string } }).data.status).toBe(
            'pending'
        );
        const updated = await profileModel.findOne({ userId: user._id });
        expect(updated?.cardToken).toBe('tok-1');
    });

    it("результат прив'язки без розпочатої прив'язки → 400 BILLING_NO_CARD_VERIFICATION", async () => {
        const user = await createUser();
        await seedActiveProfile(user);

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/card/verification/result')
            .set('Authorization', bearerFor(user))
            .expect(400);
        expect((res.body as { error: { code: string } }).error.code).toBe(
            'BILLING_NO_CARD_VERIFICATION'
        );
        expect(providerMock.getInvoiceStatus).not.toHaveBeenCalled();
    });

    it('вичерпана прострочка → доступ знято, картка лишається зі стемпом строку', async () => {
        // Платник не приймав рішення піти — його вибило несплатою. Картка
        // лишається на строк зберігання, щоб повернення коштувало один клік.
        const user = await createUser();
        await seedActiveProfile(user, {
            status: SUBSCRIPTION_STATUS.PAST_DUE,
            dunningAttempts: BILLING_DUNNING.maxAttempts - 1,
            nextChargeAt: null,
            nextRetryAt: new Date(Date.now() - 1000),
        });
        providerMock.chargeByToken.mockResolvedValueOnce({
            invoiceId: 'inv_fail',
            status: MONOBANK_INVOICE_STATUS.FAILURE,
            cardToken: null,
            failureReason: 'insufficient funds',
            errCode: '51',
            cardMask: '** 1111',
            cardPaymentMethod: 'pan',
            cardPaymentSystem: 'mastercard',
            cardBank: 'ПриватБанк',
        });

        await app.get(BillingClockService).runBillingClock();

        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.status).toBe(SUBSCRIPTION_STATUS.UNPAID);
        expect(profile?.cardToken).toBe('tok-1');
        expect(profile?.dunningExhaustedAt).toBeTruthy();
        expect(providerMock.deleteCardToken).not.toHaveBeenCalled();
    });

    it('згасання скасованого профілю → картку забуто і токен відкликано у банку', async () => {
        const user = await createUser();
        await seedActiveProfile(user, {
            cancelAtPeriodEnd: true,
            nextChargeAt: null,
            currentPeriodEnd: new Date(Date.now() - 3600_000),
        });

        await app.get(PaymentsCleanupService).runHourlyExpiry();

        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.status).toBe(SUBSCRIPTION_STATUS.CANCELED);
        expect(profile?.cardToken).toBeNull();
        expect(profile?.cardMask).toBeNull();
        expect(providerMock.deleteCardToken).toHaveBeenCalledWith('tok-1');
    });

    it('картка погашеного профілю, не стерта в годину згасання, стирається наступним проходом', async () => {
        const user = await createUser();
        await seedActiveProfile(user, {
            status: SUBSCRIPTION_STATUS.CANCELED,
            cancelAtPeriodEnd: true,
            nextChargeAt: null,
            currentPeriodEnd: new Date(Date.now() - 3 * 24 * 3600_000),
        });

        await app.get(PaymentsCleanupService).runHourlyExpiry();

        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.cardToken).toBeNull();
        expect(profile?.cardMask).toBeNull();
        expect(providerMock.deleteCardToken).toHaveBeenCalledWith('tok-1');
    });

    it('збій банку при відкликанні не губить картку: вона чекає в черзі і відкликається наступним проходом', async () => {
        const user = await createUser();
        await seedActiveProfile(user, {
            cancelAtPeriodEnd: true,
            nextChargeAt: null,
            currentPeriodEnd: new Date(Date.now() - 3600_000),
        });
        providerMock.deleteCardToken.mockRejectedValueOnce(
            new ProviderRequestError('monobank HTTP 503', false, 503)
        );

        const cleanup = app.get(PaymentsCleanupService);
        await cleanup.runHourlyExpiry();

        const afterFailure = await profileModel.findOne({ userId: user._id });
        expect(afterFailure?.cardToken).toBeNull();
        expect(afterFailure?.pendingRevokeCardTokens).toEqual(['tok-1']);

        await cleanup.runHourlyExpiry();

        const afterRetry = await profileModel.findOne({ userId: user._id });
        expect(providerMock.deleteCardToken).toHaveBeenCalledTimes(2);
        expect(providerMock.deleteCardToken).toHaveBeenLastCalledWith('tok-1');
        expect(afterRetry?.pendingRevokeCardTokens).toEqual([]);
    });

    it('поодинока відмова банку межі не досягає: токен чекає далі, ops не турбуємо', async () => {
        const user = await createUser();
        await seedActiveProfile(user, {
            status: SUBSCRIPTION_STATUS.CANCELED,
            cardToken: null,
            nextChargeAt: null,
            pendingRevokeCardTokens: ['tok-stuck'],
        });
        providerMock.deleteCardToken.mockRejectedValueOnce(
            new ProviderRequestError('monobank HTTP 503', false, 503)
        );

        await billing.revokePendingCardTokens();

        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.pendingRevokeCardTokens).toEqual(['tok-stuck']);
        expect(profile?.cardRevocationFailures).toBe(1);
        expect(emailMock.sendCardRevocationFailed).not.toHaveBeenCalled();
    });

    it('банк відмовляє до вичерпання межі → черга здається, ops отримує лист', async () => {
        const user = await createUser();
        await seedActiveProfile(user, {
            status: SUBSCRIPTION_STATUS.CANCELED,
            cardToken: null,
            nextChargeAt: null,
            pendingRevokeCardTokens: ['tok-stuck'],
            cardRevocationFailures: BILLING_CARD_REVOCATION_MAX_FAILURES - 1,
        });
        providerMock.deleteCardToken.mockRejectedValueOnce(
            new ProviderRequestError('monobank HTTP 503', false, 503)
        );

        await billing.revokePendingCardTokens();

        // Токен здано свідомо: доки він у черзі, профіль не можна знищити, а
        // з ним зависає і остаточне видалення акаунта. Картка лишилась у
        // гаманці банку, тож відступ не мовчазний — про нього йде лист.
        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.pendingRevokeCardTokens).toEqual([]);
        expect(profile?.cardRevocationFailures).toBe(0);
        expect(profile?.cardRevocationAlertDueAt).toBeTruthy();

        await app.get(PaymentsCleanupService).runManualReviewAlerts();

        expect(emailMock.sendCardRevocationFailed).toHaveBeenCalledWith({
            userId: user._id.toString(),
            walletId: user._id.toString(),
            attempts: BILLING_CARD_REVOCATION_MAX_FAILURES,
        });
        const afterAlert = await profileModel.findOne({ userId: user._id });
        expect(afterAlert?.cardRevocationAlertDueAt).toBeNull();
    });

    it('лист про здане відкликання не відправився → мітка лишається, лист іде наступним проходом', async () => {
        const user = await createUser();
        await seedActiveProfile(user, {
            status: SUBSCRIPTION_STATUS.CANCELED,
            cardToken: null,
            nextChargeAt: null,
            cardRevocationAlertDueAt: new Date(),
        });
        emailMock.sendCardRevocationFailed.mockRejectedValueOnce(
            new Error('resend down')
        );

        const cleanup = app.get(PaymentsCleanupService);
        await cleanup.runManualReviewAlerts();
        const afterFailure = await profileModel.findOne({ userId: user._id });
        expect(afterFailure?.cardRevocationAlertDueAt).toBeTruthy();

        await cleanup.runManualReviewAlerts();
        expect(emailMock.sendCardRevocationFailed).toHaveBeenCalledTimes(2);
        const afterRetry = await profileModel.findOne({ userId: user._id });
        expect(afterRetry?.cardRevocationAlertDueAt).toBeNull();
    });

    it('банк не знає токена → відкликання остаточне, черга не блокує назавжди', async () => {
        const user = await createUser();
        await seedActiveProfile(user, {
            status: SUBSCRIPTION_STATUS.CANCELED,
            cardToken: null,
            nextChargeAt: null,
            pendingRevokeCardTokens: ['tok-gone'],
        });
        providerMock.deleteCardToken.mockRejectedValueOnce(
            new ProviderRequestError('monobank HTTP 404', true, 404)
        );

        await billing.revokePendingCardTokens();

        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.pendingRevokeCardTokens).toEqual([]);
    });

    it('токен у черзі, що знову став робочою карткою, у банку не відкликається', async () => {
        const user = await createUser();
        await seedActiveProfile(user, { pendingRevokeCardTokens: ['tok-1'] });

        await billing.revokePendingCardTokens();

        const profile = await profileModel.findOne({ userId: user._id });
        expect(providerMock.deleteCardToken).not.toHaveBeenCalled();
        expect(profile?.cardToken).toBe('tok-1');
        expect(profile?.pendingRevokeCardTokens).toEqual([]);
    });

    it("картка, прив'язана вже після вимкнення доступу, отримує власний строк зберігання", async () => {
        const user = await createUser();
        await seedActiveProfile(user, {
            status: SUBSCRIPTION_STATUS.UNPAID,
            nextChargeAt: null,
            dunningExhaustedAt: new Date(
                Date.now() - (BILLING_CARD_RETENTION_DAYS + 1) * 24 * 3600_000
            ),
        });

        const res = await supertest(app.getHttpServer())
            .post('/api/payments/card/verification')
            .set('Authorization', bearerFor(user))
            .send({})
            .expect(200);
        const orderReference =
            (res.body as { data: { checkoutUrl: string } }).data.checkoutUrl
                .split('/')
                .pop() ?? '';
        await postWebhook(
            makeEvent({
                orderReference,
                invoiceId: 'inv_cvf_after_disable',
                providerEventId: 'inv_cvf_after_disable:success',
                amount: 0,
                cardToken: 'tok-new',
                cardMask: '** 4242',
            })
        );

        await app.get(PaymentsCleanupService).runDailyCleanup();

        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.cardToken).toBe('tok-new');
        expect(profile?.cardVerifiedAt).toBeTruthy();
        expect(providerMock.deleteCardToken).not.toHaveBeenCalledWith(
            'tok-new'
        );
    });

    it('картка вибитого несплатою живе до кінця строку і зникає після нього', async () => {
        const user = await createUser();
        const fresh = await createUser();
        const dayMs = 24 * 3600 * 1000;
        await seedActiveProfile(user, {
            status: SUBSCRIPTION_STATUS.UNPAID,
            nextChargeAt: null,
            dunningExhaustedAt: new Date(
                Date.now() - (BILLING_CARD_RETENTION_DAYS + 1) * dayMs
            ),
        });
        await seedActiveProfile(fresh, {
            status: SUBSCRIPTION_STATUS.UNPAID,
            nextChargeAt: null,
            dunningExhaustedAt: new Date(
                Date.now() - (BILLING_CARD_RETENTION_DAYS - 1) * dayMs
            ),
        });

        await app.get(PaymentsCleanupService).runDailyCleanup();

        const expired = await profileModel.findOne({ userId: user._id });
        expect(expired?.cardToken).toBeNull();
        // Мітка вимкнення переживає стирання картки: доступ лишається
        // вимкненим, і наступна вписана картка має від чого відраховувати
        // власний строк зберігання.
        expect(expired?.dunningExhaustedAt).toBeTruthy();
        expect(providerMock.deleteCardToken).toHaveBeenCalledWith('tok-1');

        // Строк ще не вийшов — картка на місці.
        const kept = await profileModel.findOne({ userId: fresh._id });
        expect(kept?.cardToken).toBe('tok-1');
        expect(kept?.dunningExhaustedAt).toBeTruthy();
    });

    it('картка, вписана після стирання попередньої, теж має кінцевий строк', async () => {
        const user = await createUser();
        const dayMs = 24 * 3600 * 1000;
        // Перша картка вже стерта строком зберігання, друга вписана давно: без
        // відліку за датою прив'язки вона лишалась би у гаманці банку назавжди.
        await seedActiveProfile(user, {
            status: SUBSCRIPTION_STATUS.UNPAID,
            nextChargeAt: null,
            cardToken: 'tok-second',
            dunningExhaustedAt: new Date(
                Date.now() - (BILLING_CARD_RETENTION_DAYS + 30) * dayMs
            ),
            cardVerifiedAt: new Date(
                Date.now() - (BILLING_CARD_RETENTION_DAYS + 1) * dayMs
            ),
        });

        await app.get(PaymentsCleanupService).runDailyCleanup();

        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.cardToken).toBeNull();
        expect(profile?.cardVerifiedAt).toBeNull();
        expect(providerMock.deleteCardToken).toHaveBeenCalledWith('tok-second');
    });

    it('картка профілю, вимкненого ще до появи мітки, теж прибирається', async () => {
        const user = await createUser();
        // Профіль, вибитий несплатою до Sprint 43: мітки вимкнення немає, дати
        // прив'язки теж. Вибірка за самою міткою лишила б картку назавжди.
        await seedActiveProfile(user, {
            status: SUBSCRIPTION_STATUS.UNPAID,
            nextChargeAt: null,
            dunningExhaustedAt: null,
            cardVerifiedAt: null,
        });

        await app.get(PaymentsCleanupService).runDailyCleanup();

        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.cardToken).toBeNull();
        expect(providerMock.deleteCardToken).toHaveBeenCalledWith('tok-1');
    });

    it('покинута нова купівля поверх вимкненого доступу строку зберігання не скидає', async () => {
        const user = await createUser();
        const dayMs = 24 * 3600 * 1000;
        // Статус переписала незавершена купівля, але доступ і далі вимкнено
        // несплатою — стан видно за міткою, і строк добігає свого кінця.
        await seedActiveProfile(user, {
            status: SUBSCRIPTION_STATUS.INCOMPLETE,
            nextChargeAt: null,
            dunningExhaustedAt: new Date(
                Date.now() - (BILLING_CARD_RETENTION_DAYS + 1) * dayMs
            ),
        });

        await app.get(PaymentsCleanupService).runDailyCleanup();

        const profile = await profileModel.findOne({ userId: user._id });
        expect(profile?.cardToken).toBeNull();
        expect(providerMock.deleteCardToken).toHaveBeenCalledWith('tok-1');
    });

    it('POST /capacity на скасованому профілі → 400 BILLING_CANCEL_PENDING, без списання', async () => {
        // Скасований-до-кінця-періоду профіль: доступ і картка живі, але платні
        // дії свідомо заблоковані — куплений слот згас би на межі періоду.
        // Код веде кабінет на відновлення, а не в глухий кут.
        const user = await createUser();
        await seedActiveProfile(user, {
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
        ).toEqual(BILLING_GRID.documents.creditPacks);
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
