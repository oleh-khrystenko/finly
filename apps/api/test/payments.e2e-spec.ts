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
    CURRENT_TERMS_VERSION,
    MONOBANK_INVOICE_STATUS,
    SUBSCRIPTION_STATUS,
    PAYMENT_RECORD_STATUS,
    PAYMENT_RECORD_TYPE,
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
import { PaymentsService } from '../src/modules/payments/payments.service';
import { PAYMENT_PROVIDER } from '../src/modules/payments/interfaces/payment-provider.interface';
import { User, UserDocument } from '../src/modules/users/schemas/user.schema';
import {
    PaymentRecord,
    PaymentRecordDocument,
} from '../src/modules/payments/schemas/payment-record.schema';
import {
    buildSubscriptionOrderReference,
    buildOneOffOrderReference,
} from '../src/modules/payments/order-reference';

const DUNNING_MAX = 4;

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
        PAYMENTS_SUBSCRIPTION_ENABLED: true,
        PAYMENTS_ONE_OFF_ENABLED: true,
        BILLING_DEMO_MODE: false,
        BILLING_DUNNING_MAX_ATTEMPTS: 4,
        BILLING_DUNNING_RETRY_INTERVAL_HOURS: 48,
        BILLING_PRICE_SUBSCRIPTION_BRAND: 49,
        BILLING_PRICE_SUBSCRIPTION_BOOKKEEPER: 99,
        BILLING_PRICE_ONEOFF_BRAND: 69,
        BILLING_PRICE_ONEOFF_BOOKKEEPER: 129,
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

// Контрольований фейк провайдера: тести задають поведінку chargeByToken /
// parseWebhook / getInvoiceStatus, інше — sensible defaults.
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

describe('Payments E2E (monobank self-managed)', () => {
    let app: INestApplication<App>;
    let mongo: Awaited<ReturnType<typeof createReplSetMongo>>;
    let userModel: Model<UserDocument>;
    let paymentRecordModel: Model<PaymentRecordDocument>;
    let paymentsService: PaymentsService;
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
        paymentRecordModel = moduleFixture.get(
            getModelToken(PaymentRecord.name)
        );
        paymentsService = moduleFixture.get(PaymentsService);
        jwtService = moduleFixture.get(JwtService);
    }, 60_000);

    afterAll(async () => {
        await app.close();
        await mongo.stop();
    });

    beforeEach(async () => {
        await userModel.deleteMany({});
        await paymentRecordModel.deleteMany({});
        jest.clearAllMocks();
    });

    // ─── Helpers ───

    async function createUser(
        billing: Record<string, unknown> | null = null
    ): Promise<UserDocument> {
        return userModel.create({
            email: `user-${new Types.ObjectId().toString()}@test.com`,
            profile: {
                firstName: 'Test',
                lastName: 'User',
                acceptedTermsVersion: CURRENT_TERMS_VERSION,
            },
            executions: { balance: 0, freeReportUsed: false },
            worksAsBookkeeper: false,
            billing,
        });
    }

    function bearerFor(user: UserDocument): string {
        return `Bearer ${jwtService.sign(
            { sub: user._id.toString(), email: user.email },
            { secret: 'e2e-access-secret-must-be-long-enough' }
        )}`;
    }

    function activeBilling(over: Record<string, unknown> = {}) {
        const now = new Date();
        return {
            provider: 'monobank',
            cardToken: 'tok-1',
            walletId: 'wallet-1',
            cardMask: '** 1111',
            planCode: 'brand',
            currency: 'UAH',
            subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
            currentPeriodEnd: now,
            nextChargeAt: now,
            cancelAtPeriodEnd: false,
            hasActiveSubscription: true,
            lastProviderEventAt: null,
            dunningAttempts: 0,
            nextRetryAt: null,
            oneOffLevel: null,
            oneOffAccessUntil: null,
            oneOffOrderReference: null,
            reconcileRequiredAt: null,
            ...over,
        };
    }

    function makeEvent(
        over: Partial<BillingWebhookEvent> & { orderReference: string }
    ): BillingWebhookEvent {
        return {
            providerEventId: `inv-x:${over.status ?? 'success'}`,
            invoiceId: 'inv-x',
            occurredAt: new Date(),
            status: MONOBANK_INVOICE_STATUS.SUCCESS,
            amount: 4900,
            currency: 'UAH',
            cardToken: 'tok-captured',
            cardMask: '** 4242',
            failureReason: null,
            errCode: null,
            raw: {},
            ...over,
        };
    }

    function postWebhook(event: BillingWebhookEvent) {
        providerMock.parseWebhook.mockResolvedValueOnce({ event });
        return supertest(app.getHttpServer())
            .post('/api/payments/webhook/monobank')
            .set('x-sign', 'fake')
            .send({ any: 'payload' });
    }

    async function billingOf(userId: Types.ObjectId | string) {
        const doc = await userModel.findById(userId).lean();
        return doc?.billing ?? null;
    }

    // ─── Catalog ───

    it('GET /payments/catalog повертає плани і one-off', async () => {
        const res = await supertest(app.getHttpServer())
            .get('/api/payments/catalog')
            .expect(200);
        const body = res.body as {
            data: {
                subscriptionPlans: unknown[];
                oneOffAccesses: unknown[];
            };
        };
        expect(body.data.subscriptionPlans.length).toBeGreaterThan(0);
        expect(body.data.oneOffAccesses.length).toBeGreaterThan(0);
    });

    // ─── Checkout + guard ───

    it('checkout підписки → checkoutUrl, білінг INCOMPLETE', async () => {
        const user = await createUser();
        const res = await supertest(app.getHttpServer())
            .post('/api/payments/checkout-session')
            .set('Authorization', bearerFor(user))
            .send({ paymentType: 'subscription', planCode: 'brand' })
            .expect(201);
        const body = res.body as { data: { checkoutUrl: string } };
        expect(body.data.checkoutUrl).toContain('mbnk');

        const billing = await billingOf(user._id);
        expect(billing?.subscriptionStatus).toBe(
            SUBSCRIPTION_STATUS.INCOMPLETE
        );
        expect(billing?.hasActiveSubscription).toBe(false);
        expect(billing?.walletId).toBe(user._id.toString());
    });

    it('checkout підписки за активної → 409 ALREADY_SUBSCRIBED', async () => {
        const user = await createUser(activeBilling());
        const res = await supertest(app.getHttpServer())
            .post('/api/payments/checkout-session')
            .set('Authorization', bearerFor(user))
            .send({ paymentType: 'subscription', planCode: 'bookkeeper' })
            .expect(409);
        expect((res.body as { error: { code: string } }).error.code).toBe(
            'ALREADY_SUBSCRIBED'
        );
    });

    // ─── Webhook: first checkout activation + idempotency ───

    it('webhook success першого checkout → ACTIVE, токен захоплено, запис APPROVED', async () => {
        const user = await createUser(
            activeBilling({
                subscriptionStatus: SUBSCRIPTION_STATUS.INCOMPLETE,
                hasActiveSubscription: false,
                cardToken: null,
                currentPeriodEnd: null,
                nextChargeAt: null,
            })
        );
        const ref = buildSubscriptionOrderReference(user._id.toString());

        await postWebhook(
            makeEvent({
                orderReference: ref,
                providerEventId: `inv-1:success`,
                invoiceId: 'inv-1',
            })
        ).expect(200);

        const billing = await billingOf(user._id);
        expect(billing?.subscriptionStatus).toBe(SUBSCRIPTION_STATUS.ACTIVE);
        expect(billing?.hasActiveSubscription).toBe(true);
        expect(billing?.cardToken).toBe('tok-captured');
        expect(billing?.currentPeriodEnd).toBeTruthy();
        expect(billing?.nextChargeAt).toEqual(billing?.currentPeriodEnd);

        const records = await paymentRecordModel.find({
            userId: user._id,
        });
        const approved = records.filter(
            (r) => r.status === PAYMENT_RECORD_STATUS.APPROVED
        );
        expect(approved).toHaveLength(1);
        expect(approved[0].type).toBe(PAYMENT_RECORD_TYPE.SUBSCRIPTION);
    });

    it('повторна доставка тієї ж події ідемпотентна (без подвійного гранту)', async () => {
        const user = await createUser(
            activeBilling({
                subscriptionStatus: SUBSCRIPTION_STATUS.INCOMPLETE,
                hasActiveSubscription: false,
                cardToken: null,
                currentPeriodEnd: null,
                nextChargeAt: null,
            })
        );
        const ref = buildSubscriptionOrderReference(user._id.toString());
        const event = makeEvent({
            orderReference: ref,
            providerEventId: 'inv-dup:success',
            invoiceId: 'inv-dup',
        });

        await postWebhook(event).expect(200);
        const first = await billingOf(user._id);
        await postWebhook(event).expect(200);
        const second = await billingOf(user._id);

        expect(second?.currentPeriodEnd).toEqual(first?.currentPeriodEnd);
        const approved = await paymentRecordModel.countDocuments({
            userId: user._id,
            status: PAYMENT_RECORD_STATUS.APPROVED,
        });
        expect(approved).toBe(1);
    });

    // ─── billing-clock: renewal ───

    it('billing-clock продовжує підписку за токеном: межа просувається', async () => {
        const boundary = new Date('2026-06-01T12:00:00.000Z');
        const user = await createUser(
            activeBilling({
                currentPeriodEnd: boundary,
                nextChargeAt: boundary,
            })
        );
        providerMock.chargeByToken.mockResolvedValueOnce({
            invoiceId: 'inv-renew',
            status: MONOBANK_INVOICE_STATUS.SUCCESS,
            cardMask: '** 1111',
            cardToken: null,
            failureReason: null,
            errCode: null,
        });

        await paymentsService.chargeDueSubscription(user._id.toString());

        const billing = await billingOf(user._id);
        expect(providerMock.chargeByToken).toHaveBeenCalledTimes(1);
        expect(billing?.subscriptionStatus).toBe(SUBSCRIPTION_STATUS.ACTIVE);
        expect(billing?.currentPeriodEnd).toEqual(
            new Date('2026-07-01T12:00:00.000Z')
        );
        const approved = await paymentRecordModel.countDocuments({
            userId: user._id,
            status: PAYMENT_RECORD_STATUS.APPROVED,
        });
        expect(approved).toBe(1);
    });

    it('claim-first: повторний прохід не списує вдруге, звіряє статус', async () => {
        const boundary = new Date('2026-06-01T12:00:00.000Z');
        const user = await createUser(
            activeBilling({
                currentPeriodEnd: boundary,
                nextChargeAt: boundary,
            })
        );
        // Перший прохід: списання «зависло» нетермінальним (processing) — claim
        // лишається PENDING з invoiceId.
        providerMock.chargeByToken.mockResolvedValueOnce({
            invoiceId: 'inv-stuck',
            status: MONOBANK_INVOICE_STATUS.PROCESSING,
            cardMask: null,
            cardToken: null,
            failureReason: null,
            errCode: null,
        });
        await paymentsService.chargeDueSubscription(user._id.toString());
        expect(
            await paymentRecordModel.countDocuments({
                userId: user._id,
                status: PAYMENT_RECORD_STATUS.PENDING,
            })
        ).toBe(1);

        // Другий прохід: claim існує → НЕ списуємо знову, звіряємо статус (success).
        providerMock.getInvoiceStatus.mockResolvedValueOnce(
            makeEvent({
                orderReference: 'ignored',
                invoiceId: 'inv-stuck',
                status: MONOBANK_INVOICE_STATUS.SUCCESS,
            })
        );
        await paymentsService.chargeDueSubscription(user._id.toString());

        expect(providerMock.chargeByToken).toHaveBeenCalledTimes(1);
        expect(providerMock.getInvoiceStatus).toHaveBeenCalledTimes(1);
        const billing = await billingOf(user._id);
        expect(billing?.currentPeriodEnd).toEqual(
            new Date('2026-07-01T12:00:00.000Z')
        );
    });

    // ─── billing-clock: dunning ───

    it('невдале списання → PAST_DUE з повтором і листом (доступ збережено)', async () => {
        const boundary = new Date('2026-06-01T12:00:00.000Z');
        const user = await createUser(
            activeBilling({
                currentPeriodEnd: boundary,
                nextChargeAt: boundary,
            })
        );
        providerMock.chargeByToken.mockResolvedValueOnce({
            invoiceId: 'inv-fail',
            status: MONOBANK_INVOICE_STATUS.FAILURE,
            cardMask: null,
            cardToken: null,
            failureReason: 'insufficient',
            errCode: null,
        });

        await paymentsService.chargeDueSubscription(user._id.toString());

        const billing = await billingOf(user._id);
        expect(billing?.subscriptionStatus).toBe(SUBSCRIPTION_STATUS.PAST_DUE);
        expect(billing?.hasActiveSubscription).toBe(true);
        expect(billing?.dunningAttempts).toBe(1);
        expect(billing?.nextRetryAt).toBeTruthy();
        expect(emailMock.sendSubscriptionPastDue).toHaveBeenCalledTimes(1);
    });

    it('вичерпання грейсу → UNPAID, доступ знято, токен видалено, лист', async () => {
        const boundary = new Date('2026-06-01T12:00:00.000Z');
        const user = await createUser(
            activeBilling({
                subscriptionStatus: SUBSCRIPTION_STATUS.PAST_DUE,
                currentPeriodEnd: boundary,
                nextChargeAt: null,
                nextRetryAt: boundary,
                dunningAttempts: DUNNING_MAX - 1,
            })
        );
        providerMock.chargeByToken.mockResolvedValueOnce({
            invoiceId: 'inv-fail2',
            status: MONOBANK_INVOICE_STATUS.FAILURE,
            cardMask: null,
            cardToken: null,
            failureReason: 'insufficient',
            errCode: null,
        });

        await paymentsService.chargeDueSubscription(user._id.toString());

        const billing = await billingOf(user._id);
        expect(billing?.subscriptionStatus).toBe(SUBSCRIPTION_STATUS.UNPAID);
        expect(billing?.hasActiveSubscription).toBe(false);
        expect(billing?.cardToken).toBeNull();
        expect(emailMock.sendSubscriptionEnded).toHaveBeenCalledTimes(1);
    });

    it('невідомий результат списання (транспортний збій) → прапор ручного розбору, БЕЗ повторного списання', async () => {
        const boundary = new Date('2026-06-01T12:00:00.000Z');
        const user = await createUser(
            activeBilling({
                currentPeriodEnd: boundary,
                nextChargeAt: boundary,
            })
        );
        providerMock.chargeByToken.mockRejectedValue(new Error('network down'));

        await paymentsService.chargeDueSubscription(user._id.toString());

        const billing = await billingOf(user._id);
        expect(billing?.needsManualReview).toBe(true);
        expect(billing?.nextChargeAt).toBeNull();
        // Доступ збережено (клієнт міг сплатити), підписка не знята.
        expect(billing?.hasActiveSubscription).toBe(true);
        expect(billing?.subscriptionStatus).toBe(SUBSCRIPTION_STATUS.ACTIVE);

        // Другий прохід НЕ списує вдруге (claim лишився PENDING без invoiceId).
        await paymentsService.chargeDueSubscription(user._id.toString());
        expect(providerMock.chargeByToken).toHaveBeenCalledTimes(1);
    });

    // ─── Resume (pay-now) ───

    it('resume на активній → 400 SUBSCRIPTION_NOT_PAST_DUE', async () => {
        const user = await createUser(activeBilling());
        const res = await supertest(app.getHttpServer())
            .post('/api/payments/subscription/resume')
            .set('Authorization', bearerFor(user))
            .send({})
            .expect(400);
        expect((res.body as { error: { code: string } }).error.code).toBe(
            'SUBSCRIPTION_NOT_PAST_DUE'
        );
    });

    it('resume у прострочці → checkoutUrl, білінг не скинуто, dunning-повтор відсунуто', async () => {
        const user = await createUser(
            activeBilling({
                subscriptionStatus: SUBSCRIPTION_STATUS.PAST_DUE,
                // Повтор уже настав: без відсуву dunning-годинник списав би старий
                // токен паралельно з оплатою resume (друге списання за період).
                nextRetryAt: new Date(Date.now() - 60_000),
            })
        );
        const res = await supertest(app.getHttpServer())
            .post('/api/payments/subscription/resume')
            .set('Authorization', bearerFor(user))
            .send({})
            .expect(200);
        expect(
            (res.body as { data: { checkoutUrl: string } }).data.checkoutUrl
        ).toContain('mbnk');
        const billing = await billingOf(user._id);
        expect(billing?.subscriptionStatus).toBe(SUBSCRIPTION_STATUS.PAST_DUE);
        // Повтор зсунуто у майбутнє → retryDunning не підбере його, поки користувач
        // на хостованій сторінці monobank.
        expect(billing?.nextRetryAt?.getTime()).toBeGreaterThan(Date.now());
    });

    // ─── Cancel ───

    it('cancel у кінці періоду: планування знято, токен видалено, доступ лишається', async () => {
        const periodEnd = new Date(Date.now() + 10 * 24 * 3600_000);
        const user = await createUser(
            activeBilling({
                currentPeriodEnd: periodEnd,
                nextChargeAt: periodEnd,
            })
        );
        await supertest(app.getHttpServer())
            .post('/api/payments/subscription/cancel')
            .set('Authorization', bearerFor(user))
            .expect(200);

        const billing = await billingOf(user._id);
        expect(billing?.cancelAtPeriodEnd).toBe(true);
        expect(billing?.nextChargeAt).toBeNull();
        expect(billing?.cardToken).toBeNull();
        expect(billing?.hasActiveSubscription).toBe(true);
    });

    // ─── One-off ───

    it('webhook success one-off → грант доступу на місяць', async () => {
        const user = await createUser();
        const ref = buildOneOffOrderReference(user._id.toString(), 'brand');

        await postWebhook(
            makeEvent({
                orderReference: ref,
                providerEventId: 'inv-oneoff:success',
                invoiceId: 'inv-oneoff',
                amount: 6900,
            })
        ).expect(200);

        const billing = await billingOf(user._id);
        expect(billing?.oneOffLevel).toBe('brand');
        expect(billing?.oneOffAccessUntil).toBeTruthy();
        const approved = await paymentRecordModel.countDocuments({
            userId: user._id,
            type: PAYMENT_RECORD_TYPE.ONE_OFF,
            status: PAYMENT_RECORD_STATUS.APPROVED,
        });
        expect(approved).toBe(1);
    });

    // ─── Webhook signature rejection ───

    it('невалідний підпис (provider event=null) → 200 без обробки', async () => {
        const user = await createUser();
        providerMock.parseWebhook.mockResolvedValueOnce({ event: null });
        await supertest(app.getHttpServer())
            .post('/api/payments/webhook/monobank')
            .send({ any: 'x' })
            .expect(200);
        const records = await paymentRecordModel.countDocuments({
            userId: user._id,
        });
        expect(records).toBe(0);
    });
});
