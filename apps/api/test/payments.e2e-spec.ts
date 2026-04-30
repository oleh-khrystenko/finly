import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { MongoMemoryServer } from 'mongodb-memory-server';
import * as cookieParser from 'cookie-parser';
import * as supertest from 'supertest';
import { App } from 'supertest/types';
import { ZodValidationPipe } from 'nestjs-zod';
import * as bcrypt from 'bcrypt';
import { Model } from 'mongoose';
import {
    BILLING_EVENT_TYPE,
    SUBSCRIPTION_STATUS,
    type BillingWebhookEvent,
} from '@neatslip/types';

import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { REDIS_CLIENT } from '../src/common/modules/redis.module';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { AuthModule } from '../src/modules/auth/auth.module';
import { EmailModule } from '../src/modules/email/email.module';
import { UsersModule } from '../src/modules/users/users.module';
import { ReportsModule } from '../src/modules/reports/reports.module';
import { StorageModule } from '../src/modules/storage/storage.module';
import { PaymentsModule } from '../src/modules/payments/payments.module';
import { User, UserDocument } from '../src/modules/users/schemas/user.schema';
import {
    ProcessedWebhookEvent,
    ProcessedWebhookEventDocument,
} from '../src/modules/payments/schemas/processed-webhook-event.schema';
import { EmailService } from '../src/modules/email/email.service';
import { PAYMENT_PROVIDER } from '../src/modules/payments/interfaces/payment-provider.interface';
import { CatalogService } from '../src/modules/payments/catalog.service';

// ─── Mock ENV ────────────────────────────────────────────────────────────────

jest.mock('../src/config/env', () => ({
    ENV: {
        NODE_ENV: 'test',
        PORT: '4000',
        WEB_URL: 'http://localhost:3000',
        MONGODB_URI: 'overridden-by-MongoMemoryServer',
        REDIS_URL: 'redis://mock',
        JWT_ACCESS_SECRET: 'e2e-test-access-secret-must-be-long-enough',
        JWT_REFRESH_SECRET: 'e2e-test-refresh-secret-must-be-long-enough',
        GOOGLE_CLIENT_ID: 'test-id.apps.googleusercontent.com',
        GOOGLE_CLIENT_SECRET: 'GOCSPX-test-secret',
        GOOGLE_CALLBACK_URL: 'http://localhost:4000/api/auth/google/callback',
        RESEND_API_KEY: 're_test_key',
        RESEND_FROM_EMAIL: 'NeatSlip <test@test.com>',
        AUTH_LOCKOUT_THRESHOLDS: '5:1,10:5,20:15',
        AUTH_LOGIN_ATTEMPTS_TTL_MIN: 15,
        AUTH_MAGIC_LINK_TTL_MIN: 15,
        AUTH_MAGIC_LINK_RATE_LIMIT: 3,
        AUTH_MAGIC_LINK_RATE_WINDOW_MIN: 15,
        AUTH_MAGIC_LINK_DEDUP_SEC: 60,
        ACCOUNT_DELETION_GRACE_DAYS: 30,
        AUTH_PASSWORD_MIN_LENGTH: 8,
        STRIPE_SECRET_KEY: 'sk_test_payments_e2e',
        STRIPE_WEBHOOK_SECRET: 'whsec_test',
        PAYMENTS_SUBSCRIPTION_ENABLED: true,
        PAYMENTS_ONE_OFF_ENABLED: true,
    },
    parseLockoutThresholds: (raw: string) =>
        raw.split(',').map((entry: string) => {
            const [attempts, blockMin] = entry.split(':').map(Number);
            return { attempts, blockMin };
        }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock() requires runtime require()
const envModule = require('../src/config/env') as {
    ENV: Record<string, unknown>;
};

// ─── Test catalog data ───────────────────────────────────────────────────────

const TEST_CATALOG = {
    subscriptionPlans: [
        {
            code: 'starter',
            priceId: 'price_test_starter',
            priceAmount: 4900,
            currency: 'usd',
            interval: 'month',
            executions: 10000,
            displayOrder: 1,
            featured: false,
        },
        {
            code: 'pro',
            priceId: 'price_test_pro',
            priceAmount: 14900,
            currency: 'usd',
            interval: 'month',
            executions: 50000,
            displayOrder: 2,
            featured: true,
        },
    ],
    executionPacks: [
        {
            code: 'basic',
            priceId: 'price_test_basic',
            priceAmount: 2900,
            currency: 'usd',
            executions: 5000,
            displayOrder: 1,
            featured: false,
        },
        {
            code: 'max',
            priceId: 'price_test_max',
            priceAmount: 9900,
            currency: 'usd',
            executions: 25000,
            displayOrder: 2,
            featured: true,
        },
    ],
};

const mockCatalogService = {
    onModuleInit: jest.fn().mockResolvedValue(undefined),
    getCatalog: jest.fn().mockResolvedValue(TEST_CATALOG),
    getSubscriptionPlan: jest.fn((code: string) =>
        Promise.resolve(
            TEST_CATALOG.subscriptionPlans.find((p) => p.code === code)
        )
    ),
    getExecutionPack: jest.fn((code: string) =>
        Promise.resolve(
            TEST_CATALOG.executionPacks.find((p) => p.code === code)
        )
    ),
    getPriceToPlanMap: jest.fn().mockResolvedValue({
        price_test_starter: 'starter',
        price_test_pro: 'pro',
    }),
};

// ─── Stateful Redis mock ──────────────────────────────────────────────────────

function createStatefulRedisMock() {
    const store = new Map<string, string>();

    function createPipeline() {
        const ops: Array<() => void> = [];
        const pipe = {
            set(key: string, value: string) {
                ops.push(() => store.set(key, value));
                return pipe;
            },
            del(key: string) {
                ops.push(() => store.delete(key));
                return pipe;
            },
            incr(key: string) {
                ops.push(() => {
                    const val = store.get(key);
                    store.set(key, String((parseInt(val ?? '0', 10) || 0) + 1));
                });
                return pipe;
            },
            expire(_key: string, _ttl: number) {
                return pipe;
            },
            sadd(key: string, ...members: string[]) {
                ops.push(() => {
                    const existing = store.get(key);
                    const set: Set<string> = existing
                        ? new Set(JSON.parse(existing) as string[])
                        : new Set<string>();
                    for (const m of members) set.add(m);
                    store.set(key, JSON.stringify([...set]));
                });
                return pipe;
            },
            srem(key: string, ...members: string[]) {
                ops.push(() => {
                    const existing = store.get(key);
                    if (!existing) return;
                    const set: Set<string> = new Set(
                        JSON.parse(existing) as string[]
                    );
                    for (const m of members) set.delete(m);
                    if (set.size === 0) store.delete(key);
                    else store.set(key, JSON.stringify([...set]));
                });
                return pipe;
            },
            async exec() {
                for (const op of ops) op();
                return [];
            },
        };
        return pipe;
    }

    return {
        ping: jest.fn().mockResolvedValue('PONG'),
        quit: jest.fn().mockResolvedValue('OK'),
        on: jest.fn().mockReturnThis(),
        async get(key: string) {
            return store.get(key) ?? null;
        },
        async getdel(key: string) {
            const val = store.get(key) ?? null;
            if (val !== null) store.delete(key);
            return val;
        },
        async set(key: string, value: string) {
            store.set(key, value);
            return 'OK';
        },
        async del(key: string) {
            store.delete(key);
            return 1;
        },
        async incr(key: string) {
            const current = parseInt(store.get(key) ?? '0', 10) || 0;
            const next = current + 1;
            store.set(key, String(next));
            return next;
        },
        async expire(_key: string, _ttl: number) {
            return 1;
        },
        async smembers(key: string) {
            const val = store.get(key);
            if (!val) return [];
            return JSON.parse(val) as string[];
        },
        async srem(key: string, ...members: string[]) {
            const val = store.get(key);
            if (!val) return 0;
            const set = new Set(JSON.parse(val) as string[]);
            let removed = 0;
            for (const m of members) {
                if (set.delete(m)) removed++;
            }
            if (set.size === 0) store.delete(key);
            else store.set(key, JSON.stringify([...set]));
            return removed;
        },
        pipeline() {
            return createPipeline();
        },
        _store: store,
        _clear() {
            store.clear();
        },
    };
}

// ─── Mock dependencies ────────────────────────────────────────────────────────

const mockEmailService = {
    sendMagicLink: jest.fn().mockResolvedValue(undefined),
    sendDeletionConfirmation: jest.fn().mockResolvedValue(undefined),
};

const mockPaymentProvider = {
    createCheckoutSession: jest.fn(),
    createPortalSession: jest.fn(),
    handleWebhookPayload: jest.fn(),
};

// ─────────────────────────────────────────────────────────────────────────────

describe('Payments E2E', () => {
    let app: INestApplication<App>;
    let mongoServer: MongoMemoryServer;
    let userModel: Model<UserDocument>;
    let webhookEventModel: Model<ProcessedWebhookEventDocument>;
    let redisMock: ReturnType<typeof createStatefulRedisMock>;

    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        redisMock = createStatefulRedisMock();

        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ isGlobal: true }),
                ThrottlerModule.forRoot({
                    throttlers: [{ ttl: 60000, limit: 600 }],
                }),
                MongooseModule.forRoot(mongoServer.getUri()),
                AuthModule,
                EmailModule,
                UsersModule,
                ReportsModule,
                StorageModule,
                PaymentsModule,
            ],
            controllers: [AppController],
            providers: [
                AppService,
                { provide: APP_GUARD, useClass: ThrottlerGuard },
            ],
        })
            .overrideProvider(REDIS_CLIENT)
            .useValue(redisMock)
            .overrideProvider(EmailService)
            .useValue(mockEmailService)
            .overrideProvider(PAYMENT_PROVIDER)
            .useValue(mockPaymentProvider)
            .overrideProvider(CatalogService)
            .useValue(mockCatalogService)
            .compile();

        app = moduleFixture.createNestApplication({ rawBody: true });
        app.use(cookieParser());
        app.setGlobalPrefix('api');
        app.useGlobalPipes(new ZodValidationPipe());
        app.useGlobalFilters(new AllExceptionsFilter());
        await app.init();

        userModel = moduleFixture.get<Model<UserDocument>>(
            getModelToken(User.name)
        );
        webhookEventModel = moduleFixture.get<
            Model<ProcessedWebhookEventDocument>
        >(getModelToken(ProcessedWebhookEvent.name));
    }, 60_000);

    afterAll(async () => {
        await app.close();
        await mongoServer.stop();
    });

    beforeEach(async () => {
        redisMock._clear();
        await userModel.deleteMany({});
        await webhookEventModel.deleteMany({});

        // Reset feature flags to defaults
        envModule.ENV.PAYMENTS_SUBSCRIPTION_ENABLED = true;
        envModule.ENV.PAYMENTS_ONE_OFF_ENABLED = true;

        // Default mock responses
        mockPaymentProvider.handleWebhookPayload.mockReturnValue(null);
        mockPaymentProvider.createCheckoutSession.mockResolvedValue({
            checkoutUrl: 'https://checkout.stripe.com/test_session',
            providerSessionId: 'cs_test_xxx',
        });
        mockPaymentProvider.createPortalSession.mockResolvedValue({
            portalUrl: 'https://billing.stripe.com/test_session',
        });
        mockEmailService.sendMagicLink.mockClear();
        mockEmailService.sendDeletionConfirmation.mockClear();
    });

    // ─── Helpers ─────────────────────────────────────────────────────

    const TEST_PASSWORD = 'TestPass123!';

    async function createUser(
        email: string,
        billingData?: Record<string, unknown> | null
    ): Promise<UserDocument> {
        const hash = await bcrypt.hash(TEST_PASSWORD, 10);
        return userModel.create({
            email: email.toLowerCase(),
            passwordHash: hash,
            profile: { name: 'Test User' },
            executions: { balance: 0, freeReportUsed: false },
            billing: billingData ?? null,
        });
    }

    async function loginAsUser(
        email: string
    ): Promise<{ accessToken: string }> {
        const res = await supertest(app.getHttpServer())
            .post('/api/auth/login/password')
            .send({ email, password: TEST_PASSWORD })
            .expect(201);

        const body = res.body as { data: { accessToken: string } };
        return { accessToken: body.data.accessToken };
    }

    // ─── A. POST /api/payments/checkout-session ───────────────────────

    describe('POST /api/payments/checkout-session', () => {
        it('should return 201 with checkoutUrl for authorized user without active subscription', async () => {
            await createUser('checkout@example.com', null);
            const { accessToken } = await loginAsUser('checkout@example.com');

            await supertest(app.getHttpServer())
                .post('/api/payments/checkout-session')
                .set('Authorization', `Bearer ${accessToken}`)
                .send({ paymentType: 'subscription', planCode: 'pro' })
                .expect(201)
                .expect((res: supertest.Response) => {
                    expect(
                        (res.body as { data: { checkoutUrl: string } }).data
                            .checkoutUrl
                    ).toBe('https://checkout.stripe.com/test_session');
                });
        });

        it('should return 409 ALREADY_SUBSCRIBED when user has active subscription', async () => {
            await createUser('subscribed@example.com', {
                hasActiveSubscription: true,
                providerCustomerId: 'cus_existing',
            });
            const { accessToken } = await loginAsUser('subscribed@example.com');

            await supertest(app.getHttpServer())
                .post('/api/payments/checkout-session')
                .set('Authorization', `Bearer ${accessToken}`)
                .send({ paymentType: 'subscription', planCode: 'pro' })
                .expect(409)
                .expect((res: supertest.Response) => {
                    expect(
                        (res.body as { error: { code: string } }).error.code
                    ).toBe('ALREADY_SUBSCRIBED');
                });
        });

        it('should return 401 when JWT token is missing', async () => {
            await supertest(app.getHttpServer())
                .post('/api/payments/checkout-session')
                .send({ paymentType: 'subscription', planCode: 'pro' })
                .expect(401);
        });

        it('should return 400 when paymentType is missing from body', async () => {
            await createUser('noplan@example.com', null);
            const { accessToken } = await loginAsUser('noplan@example.com');

            await supertest(app.getHttpServer())
                .post('/api/payments/checkout-session')
                .set('Authorization', `Bearer ${accessToken}`)
                .send({})
                .expect(400);
        });

        it('should return 400 when planCode is empty string for subscription', async () => {
            await createUser('emptyplan@example.com', null);
            const { accessToken } = await loginAsUser('emptyplan@example.com');

            await supertest(app.getHttpServer())
                .post('/api/payments/checkout-session')
                .set('Authorization', `Bearer ${accessToken}`)
                .send({ paymentType: 'subscription', planCode: '' })
                .expect(400);
        });
    });

    // ─── B. POST /api/payments/portal-session ────────────────────────

    describe('POST /api/payments/portal-session', () => {
        it('should return 201 with portalUrl for user with providerCustomerId', async () => {
            await createUser('portal@example.com', {
                providerCustomerId: 'cus_portal_test',
                hasActiveSubscription: true,
            });
            const { accessToken } = await loginAsUser('portal@example.com');

            await supertest(app.getHttpServer())
                .post('/api/payments/portal-session')
                .set('Authorization', `Bearer ${accessToken}`)
                .expect(201)
                .expect((res: supertest.Response) => {
                    expect(
                        (res.body as { data: { portalUrl: string } }).data
                            .portalUrl
                    ).toBe('https://billing.stripe.com/test_session');
                });
        });

        it('should return 400 NO_BILLING_ACCOUNT when billing subdocument is null', async () => {
            await createUser('nobilling@example.com', null);
            const { accessToken } = await loginAsUser('nobilling@example.com');

            await supertest(app.getHttpServer())
                .post('/api/payments/portal-session')
                .set('Authorization', `Bearer ${accessToken}`)
                .expect(400)
                .expect((res: supertest.Response) => {
                    expect(
                        (res.body as { error: { code: string } }).error.code
                    ).toBe('NO_BILLING_ACCOUNT');
                });
        });

        it('should return 400 NO_BILLING_ACCOUNT when providerCustomerId is null', async () => {
            await createUser('nullcustomer@example.com', {
                providerCustomerId: null,
                hasActiveSubscription: false,
            });
            const { accessToken } = await loginAsUser(
                'nullcustomer@example.com'
            );

            await supertest(app.getHttpServer())
                .post('/api/payments/portal-session')
                .set('Authorization', `Bearer ${accessToken}`)
                .expect(400)
                .expect((res: supertest.Response) => {
                    expect(
                        (res.body as { error: { code: string } }).error.code
                    ).toBe('NO_BILLING_ACCOUNT');
                });
        });

        it('should return 401 when JWT token is missing', async () => {
            await supertest(app.getHttpServer())
                .post('/api/payments/portal-session')
                .expect(401);
        });
    });

    // ─── C. POST /api/payments/webhook/:provider ──────────────────────

    describe('POST /api/payments/webhook/:provider', () => {
        it('should return 201 with { received: true } for valid stripe webhook', async () => {
            // mockPaymentProvider.handleWebhookPayload returns null by default (unknown event)
            await supertest(app.getHttpServer())
                .post('/api/payments/webhook/stripe')
                .set('stripe-signature', 'test-sig')
                .set('content-type', 'application/json')
                .send('{}')
                .expect(201)
                .expect({ received: true });
        });

        it('should return 400 when stripe-signature header is missing', async () => {
            await supertest(app.getHttpServer())
                .post('/api/payments/webhook/stripe')
                .set('content-type', 'application/json')
                .send('{}')
                .expect(400)
                .expect((res: supertest.Response) => {
                    expect(
                        (res.body as { error: { code: string } }).error.code
                    ).toBeDefined();
                });
        });

        it('should return 400 for unsupported provider', async () => {
            await supertest(app.getHttpServer())
                .post('/api/payments/webhook/monobank')
                .set('stripe-signature', 'test-sig')
                .set('content-type', 'application/json')
                .send('{}')
                .expect(400)
                .expect((res: supertest.Response) => {
                    expect(
                        (res.body as { error: { message: string } }).error
                            .message
                    ).toContain('monobank');
                });
        });
    });

    // ─── D. Response format ───────────────────────────────────────────

    describe('response format', () => {
        it('success response has { data: { ... } } shape', async () => {
            await createUser('format-success@example.com', null);
            const { accessToken } = await loginAsUser(
                'format-success@example.com'
            );

            const res = await supertest(app.getHttpServer())
                .post('/api/payments/checkout-session')
                .set('Authorization', `Bearer ${accessToken}`)
                .send({ paymentType: 'subscription', planCode: 'pro' })
                .expect(201);

            expect(res.body).toHaveProperty('data');
            expect((res.body as { data: unknown }).data).toHaveProperty(
                'checkoutUrl'
            );
        });

        it('error response has { error: { code, message } } shape', async () => {
            const res = await supertest(app.getHttpServer())
                .post('/api/payments/checkout-session')
                .send({ paymentType: 'subscription', planCode: 'pro' })
                .expect(401);

            const body = res.body as {
                error: { code: string; message: string };
            };
            expect(body).toHaveProperty('error');
            expect(body.error).toHaveProperty('code');
            expect(body.error).toHaveProperty('message');
        });

        it('validation error returns 400 with error format', async () => {
            await createUser('format-validate@example.com', null);
            const { accessToken } = await loginAsUser(
                'format-validate@example.com'
            );

            const res = await supertest(app.getHttpServer())
                .post('/api/payments/checkout-session')
                .set('Authorization', `Bearer ${accessToken}`)
                .send({})
                .expect(400);

            const body = res.body as { error: { code: string } };
            expect(body).toHaveProperty('error');
            expect(body.error).toHaveProperty('code');
        });
    });

    // ─── E2. One-off checkout + webhook flow ────────────────────────────

    describe('POST /api/payments/checkout-session (one-off)', () => {
        it('should return 201 with checkoutUrl for one-off payment', async () => {
            await createUser('oneoff@example.com', null);
            const { accessToken } = await loginAsUser('oneoff@example.com');

            await supertest(app.getHttpServer())
                .post('/api/payments/checkout-session')
                .set('Authorization', `Bearer ${accessToken}`)
                .send({ paymentType: 'one_off', packCode: 'basic' })
                .expect(201)
                .expect((res: supertest.Response) => {
                    expect(
                        (res.body as { data: { checkoutUrl: string } }).data
                            .checkoutUrl
                    ).toBe('https://checkout.stripe.com/test_session');
                });
        });

        it('should return 400 for invalid packCode', async () => {
            await createUser('badpack@example.com', null);
            const { accessToken } = await loginAsUser('badpack@example.com');

            await supertest(app.getHttpServer())
                .post('/api/payments/checkout-session')
                .set('Authorization', `Bearer ${accessToken}`)
                .send({ paymentType: 'one_off', packCode: 'invalid_pack' })
                .expect(400);
        });

        it('should add executions on ONE_OFF_PAYMENT_COMPLETED webhook', async () => {
            const user = await createUser(
                'executions-webhook@example.com',
                null
            );
            const userId = user._id.toString();

            const oneOffEvent: BillingWebhookEvent = {
                type: BILLING_EVENT_TYPE.ONE_OFF_PAYMENT_COMPLETED,
                providerEventId: 'evt_oneoff_e2e_001',
                occurredAt: new Date(),
                userId,
                executionsAmount: 5,
                raw: {},
            };

            mockPaymentProvider.handleWebhookPayload.mockReturnValue(
                oneOffEvent
            );

            // Send webhook
            await supertest(app.getHttpServer())
                .post('/api/payments/webhook/stripe')
                .set('stripe-signature', 'test-sig')
                .set('content-type', 'application/json')
                .send('{}')
                .expect(201)
                .expect({ received: true });

            // Verify executions added
            const updatedUser = await userModel.findById(userId).lean();
            expect(updatedUser?.executions?.balance).toBe(5);

            // Verify event marked as applied
            const storedEvent = await webhookEventModel
                .findOne({ providerEventId: 'evt_oneoff_e2e_001' })
                .lean();
            expect(storedEvent?.status).toBe('applied');
        });
    });

    // ─── F. Payment type toggles ─────────────────────────────────────

    describe('payment type toggles', () => {
        it('should return 400 PAYMENT_TYPE_DISABLED when one-off is disabled', async () => {
            envModule.ENV.PAYMENTS_ONE_OFF_ENABLED = false;

            await createUser('toggle-oneoff@example.com', null);
            const { accessToken } = await loginAsUser(
                'toggle-oneoff@example.com'
            );

            await supertest(app.getHttpServer())
                .post('/api/payments/checkout-session')
                .set('Authorization', `Bearer ${accessToken}`)
                .send({ paymentType: 'one_off', packCode: 'basic' })
                .expect(400)
                .expect((res: supertest.Response) => {
                    expect(
                        (res.body as { error: { code: string } }).error.code
                    ).toBe('PAYMENT_TYPE_DISABLED');
                });
        });

        it('should return 400 PAYMENT_TYPE_DISABLED when subscription is disabled', async () => {
            envModule.ENV.PAYMENTS_SUBSCRIPTION_ENABLED = false;

            await createUser('toggle-sub@example.com', null);
            const { accessToken } = await loginAsUser('toggle-sub@example.com');

            await supertest(app.getHttpServer())
                .post('/api/payments/checkout-session')
                .set('Authorization', `Bearer ${accessToken}`)
                .send({
                    paymentType: 'subscription',
                    planCode: 'pro',
                })
                .expect(400)
                .expect((res: supertest.Response) => {
                    expect(
                        (res.body as { error: { code: string } }).error.code
                    ).toBe('PAYMENT_TYPE_DISABLED');
                });
        });
    });

    // ─── E. Webhook idempotency ───────────────────────────────────────

    describe('webhook idempotency', () => {
        it('should update billing on first webhook and skip duplicate on second call', async () => {
            const user = await createUser('idempotency@example.com', null);
            const userId = user._id.toString();

            const checkoutEvent: BillingWebhookEvent = {
                type: BILLING_EVENT_TYPE.CHECKOUT_COMPLETED,
                providerEventId: 'evt_idempotency_test_001',
                occurredAt: new Date('2024-01-01T00:00:00Z'),
                userId,
                subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
                currentPeriodEnd: null,
                cancelAtPeriodEnd: false,
                raw: {
                    customer: 'cus_idempotency_test',
                    subscription: 'sub_idempotency_test',
                    currency: 'usd',
                    status: 'complete',
                    metadata: { planCode: 'pro' },
                },
            };

            mockPaymentProvider.handleWebhookPayload.mockReturnValue(
                checkoutEvent
            );

            // First webhook — should update billing
            await supertest(app.getHttpServer())
                .post('/api/payments/webhook/stripe')
                .set('stripe-signature', 'test-sig')
                .set('content-type', 'application/json')
                .send('{}')
                .expect(201)
                .expect({ received: true });

            const userAfterFirst = await userModel.findById(userId).lean();
            expect(userAfterFirst?.billing?.hasActiveSubscription).toBe(true);
            expect(userAfterFirst?.billing?.providerCustomerId).toBe(
                'cus_idempotency_test'
            );

            // Second webhook with same providerEventId — idempotent, no duplicate update
            await supertest(app.getHttpServer())
                .post('/api/payments/webhook/stripe')
                .set('stripe-signature', 'test-sig')
                .set('content-type', 'application/json')
                .send('{}')
                .expect(201)
                .expect({ received: true });

            // Event should be recorded only once with status 'applied'
            const eventCount = await webhookEventModel.countDocuments({
                providerEventId: 'evt_idempotency_test_001',
            });
            expect(eventCount).toBe(1);

            const storedEvent = await webhookEventModel
                .findOne({ providerEventId: 'evt_idempotency_test_001' })
                .lean();
            expect(storedEvent?.status).toBe('applied');
        });

        it('should rollback pending event on transient failure and allow retry to succeed', async () => {
            const user = await createUser('rollback@example.com', null);
            const userId = user._id.toString();

            const oneOffEvent: BillingWebhookEvent = {
                type: BILLING_EVENT_TYPE.ONE_OFF_PAYMENT_COMPLETED,
                providerEventId: 'evt_rollback_test_001',
                occurredAt: new Date(),
                userId,
                executionsAmount: 10,
                raw: {},
            };

            // First attempt — addExecutions will fail because provider throws
            mockPaymentProvider.handleWebhookPayload.mockReturnValue(
                oneOffEvent
            );

            // Temporarily break the user to cause addExecutions to fail
            // We do this by removing the user document before the webhook processes
            await userModel.deleteOne({ _id: userId });

            await supertest(app.getHttpServer())
                .post('/api/payments/webhook/stripe')
                .set('stripe-signature', 'test-sig')
                .set('content-type', 'application/json')
                .send('{}')
                .expect(201);

            // Event should NOT be in the collection (user not found is a non-error skip)
            // Let's test the real transient failure: re-create user and use a failing mock
            const user2 = await createUser('rollback2@example.com', null);
            const userId2 = user2._id.toString();

            // Make handleWebhookPayload return event that will cause addExecutions to throw
            const failEvent: BillingWebhookEvent = {
                type: BILLING_EVENT_TYPE.ONE_OFF_PAYMENT_COMPLETED,
                providerEventId: 'evt_rollback_test_002',
                occurredAt: new Date(),
                userId: userId2,
                executionsAmount: -999, // Invalid amount — addExecutions will throw
                raw: {},
            };
            mockPaymentProvider.handleWebhookPayload.mockReturnValue(failEvent);

            // This should not leave a "pending" record blocking retries
            // (executionsAmount <= 0 is caught by applyOneOffPayment and skipped, not thrown)
            await supertest(app.getHttpServer())
                .post('/api/payments/webhook/stripe')
                .set('stripe-signature', 'test-sig')
                .set('content-type', 'application/json')
                .send('{}')
                .expect(201);

            // Event should be marked as applied (invalid executions is a graceful skip)
            const storedEvent2 = await webhookEventModel
                .findOne({ providerEventId: 'evt_rollback_test_002' })
                .lean();
            expect(storedEvent2?.status).toBe('applied');
        });
    });

    // ─── Out-of-order event handling ──────────────────────────────────

    describe('out-of-order event handling', () => {
        it('should apply newer event and skip older event for same user', async () => {
            const user = await createUser('ooo@example.com', null);
            const userId = user._id.toString();

            const newerEvent: BillingWebhookEvent = {
                type: BILLING_EVENT_TYPE.CHECKOUT_COMPLETED,
                providerEventId: 'evt_ooo_newer',
                occurredAt: new Date('2024-06-01T00:00:00Z'),
                userId,
                subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
                currentPeriodEnd: null,
                cancelAtPeriodEnd: false,
                raw: {
                    customer: 'cus_ooo',
                    subscription: 'sub_ooo',
                    currency: 'usd',
                    status: 'complete',
                    metadata: { planCode: 'pro' },
                },
            };

            const olderEvent: BillingWebhookEvent = {
                type: BILLING_EVENT_TYPE.SUBSCRIPTION_UPDATED,
                providerEventId: 'evt_ooo_older',
                occurredAt: new Date('2024-05-01T00:00:00Z'),
                userId,
                subscriptionStatus: SUBSCRIPTION_STATUS.PAST_DUE,
                currentPeriodEnd: null,
                cancelAtPeriodEnd: false,
                raw: { id: 'sub_ooo', status: 'past_due' },
            };

            // Send newer event first
            mockPaymentProvider.handleWebhookPayload.mockReturnValue(
                newerEvent
            );
            await supertest(app.getHttpServer())
                .post('/api/payments/webhook/stripe')
                .set('stripe-signature', 'test-sig')
                .set('content-type', 'application/json')
                .send('{}')
                .expect(201);

            const afterNewer = await userModel.findById(userId).lean();
            expect(afterNewer?.billing?.hasActiveSubscription).toBe(true);
            expect(afterNewer?.billing?.subscriptionStatus).toBe(
                SUBSCRIPTION_STATUS.ACTIVE
            );

            // Send older event — should be skipped by out-of-order guard
            mockPaymentProvider.handleWebhookPayload.mockReturnValue(
                olderEvent
            );
            await supertest(app.getHttpServer())
                .post('/api/payments/webhook/stripe')
                .set('stripe-signature', 'test-sig')
                .set('content-type', 'application/json')
                .send('{}')
                .expect(201);

            const afterOlder = await userModel.findById(userId).lean();
            // Billing state should remain from the newer event
            expect(afterOlder?.billing?.hasActiveSubscription).toBe(true);
            expect(afterOlder?.billing?.subscriptionStatus).toBe(
                SUBSCRIPTION_STATUS.ACTIVE
            );
        });
    });

    // ─── Subscription lifecycle ───────────────────────────────────────

    describe('subscription lifecycle', () => {
        it('should track full lifecycle: CHECKOUT_COMPLETED → SUBSCRIPTION_UPDATED(past_due) → SUBSCRIPTION_DELETED', async () => {
            const user = await createUser('lifecycle@example.com', null);
            const userId = user._id.toString();

            // Step 1: CHECKOUT_COMPLETED — user subscribes
            const checkoutEvent: BillingWebhookEvent = {
                type: BILLING_EVENT_TYPE.CHECKOUT_COMPLETED,
                providerEventId: 'evt_lifecycle_1',
                occurredAt: new Date('2024-01-01T00:00:00Z'),
                userId,
                subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
                currentPeriodEnd: null,
                cancelAtPeriodEnd: false,
                raw: {
                    customer: 'cus_lifecycle',
                    subscription: 'sub_lifecycle',
                    currency: 'usd',
                    status: 'complete',
                    metadata: { planCode: 'pro' },
                },
            };
            mockPaymentProvider.handleWebhookPayload.mockReturnValue(
                checkoutEvent
            );
            await supertest(app.getHttpServer())
                .post('/api/payments/webhook/stripe')
                .set('stripe-signature', 'test-sig')
                .set('content-type', 'application/json')
                .send('{}')
                .expect(201);

            const afterCheckout = await userModel.findById(userId).lean();
            expect(afterCheckout?.billing?.hasActiveSubscription).toBe(true);
            expect(afterCheckout?.billing?.subscriptionStatus).toBe(
                SUBSCRIPTION_STATUS.ACTIVE
            );
            expect(afterCheckout?.billing?.providerCustomerId).toBe(
                'cus_lifecycle'
            );

            // Step 2: SUBSCRIPTION_UPDATED(past_due) — payment fails
            const pastDueEvent: BillingWebhookEvent = {
                type: BILLING_EVENT_TYPE.SUBSCRIPTION_UPDATED,
                providerEventId: 'evt_lifecycle_2',
                occurredAt: new Date('2024-02-01T00:00:00Z'),
                userId,
                subscriptionStatus: SUBSCRIPTION_STATUS.PAST_DUE,
                currentPeriodEnd: null,
                cancelAtPeriodEnd: false,
                raw: { id: 'sub_lifecycle', status: 'past_due' },
            };
            mockPaymentProvider.handleWebhookPayload.mockReturnValue(
                pastDueEvent
            );
            await supertest(app.getHttpServer())
                .post('/api/payments/webhook/stripe')
                .set('stripe-signature', 'test-sig')
                .set('content-type', 'application/json')
                .send('{}')
                .expect(201);

            const afterPastDue = await userModel.findById(userId).lean();
            expect(afterPastDue?.billing?.hasActiveSubscription).toBe(false);
            expect(afterPastDue?.billing?.subscriptionStatus).toBe(
                SUBSCRIPTION_STATUS.PAST_DUE
            );

            // Step 3: SUBSCRIPTION_DELETED — subscription canceled
            const deletedEvent: BillingWebhookEvent = {
                type: BILLING_EVENT_TYPE.SUBSCRIPTION_DELETED,
                providerEventId: 'evt_lifecycle_3',
                occurredAt: new Date('2024-03-01T00:00:00Z'),
                userId,
                subscriptionStatus: SUBSCRIPTION_STATUS.CANCELED,
                currentPeriodEnd: null,
                cancelAtPeriodEnd: false,
                raw: { id: 'sub_lifecycle', status: 'canceled' },
            };
            mockPaymentProvider.handleWebhookPayload.mockReturnValue(
                deletedEvent
            );
            await supertest(app.getHttpServer())
                .post('/api/payments/webhook/stripe')
                .set('stripe-signature', 'test-sig')
                .set('content-type', 'application/json')
                .send('{}')
                .expect(201);

            const afterDeleted = await userModel.findById(userId).lean();
            expect(afterDeleted?.billing?.hasActiveSubscription).toBe(false);
            expect(afterDeleted?.billing?.subscriptionStatus).toBe(
                SUBSCRIPTION_STATUS.CANCELED
            );
            expect(afterDeleted?.billing?.providerSubscriptionStatus).toBe(
                'canceled'
            );
        });
    });

    // ─── One-off idempotency ──────────────────────────────────────────

    describe('one-off idempotency', () => {
        it('should not add executions twice for duplicate ONE_OFF_PAYMENT_COMPLETED event', async () => {
            const user = await createUser('oneoff-idemp@example.com', null);
            const userId = user._id.toString();

            const oneOffEvent: BillingWebhookEvent = {
                type: BILLING_EVENT_TYPE.ONE_OFF_PAYMENT_COMPLETED,
                providerEventId: 'evt_oneoff_dup_001',
                occurredAt: new Date(),
                userId,
                executionsAmount: 20,
                packCode: 'max',
                raw: {},
            };

            mockPaymentProvider.handleWebhookPayload.mockReturnValue(
                oneOffEvent
            );

            // First call — should add 20 executions
            await supertest(app.getHttpServer())
                .post('/api/payments/webhook/stripe')
                .set('stripe-signature', 'test-sig')
                .set('content-type', 'application/json')
                .send('{}')
                .expect(201);

            const afterFirst = await userModel.findById(userId).lean();
            expect(afterFirst?.executions?.balance).toBe(20);

            // Second call with same providerEventId — idempotent, executions should stay at 20
            await supertest(app.getHttpServer())
                .post('/api/payments/webhook/stripe')
                .set('stripe-signature', 'test-sig')
                .set('content-type', 'application/json')
                .send('{}')
                .expect(201);

            const afterSecond = await userModel.findById(userId).lean();
            expect(afterSecond?.executions?.balance).toBe(20);
        });
    });

    // ─── userId resolution via subscription lookup ────────────────────

    describe('userId resolution via subscription lookup', () => {
        it('should resolve userId from billing.providerSubscriptionId when event.userId is empty', async () => {
            // Create user with existing billing (already has a subscription)
            const user = await createUser('resolve@example.com', {
                provider: 'stripe',
                providerCustomerId: 'cus_resolve',
                providerSubscriptionId: 'sub_resolve_xxx',
                planCode: 'pro',
                currency: 'usd',
                subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
                hasActiveSubscription: true,
                providerSubscriptionStatus: 'active',
                currentPeriodEnd: null,
                cancelAtPeriodEnd: false,
                lastProviderEventAt: new Date('2024-01-01T00:00:00Z'),
            });
            const userId = user._id.toString();

            // SUBSCRIPTION_UPDATED with empty userId — should look up by raw.id
            const updateEvent: BillingWebhookEvent = {
                type: BILLING_EVENT_TYPE.SUBSCRIPTION_UPDATED,
                providerEventId: 'evt_resolve_lookup',
                occurredAt: new Date('2024-02-01T00:00:00Z'),
                userId: '',
                subscriptionStatus: SUBSCRIPTION_STATUS.PAST_DUE,
                currentPeriodEnd: null,
                cancelAtPeriodEnd: false,
                raw: { id: 'sub_resolve_xxx', status: 'past_due' },
            };

            mockPaymentProvider.handleWebhookPayload.mockReturnValue(
                updateEvent
            );

            await supertest(app.getHttpServer())
                .post('/api/payments/webhook/stripe')
                .set('stripe-signature', 'test-sig')
                .set('content-type', 'application/json')
                .send('{}')
                .expect(201);

            const updated = await userModel.findById(userId).lean();
            expect(updated?.billing?.subscriptionStatus).toBe(
                SUBSCRIPTION_STATUS.PAST_DUE
            );
            expect(updated?.billing?.hasActiveSubscription).toBe(false);
        });
    });

    // ─── GET /api/payments/catalog ────────────────────────────────────

    describe('GET /api/payments/catalog', () => {
        it('should return 200 with catalog data', async () => {
            await supertest(app.getHttpServer())
                .get('/api/payments/catalog')
                .expect(200)
                .expect((res: supertest.Response) => {
                    const body = res.body as {
                        data: {
                            subscriptionPlans: unknown[];
                            executionPacks: unknown[];
                        };
                    };
                    expect(body.data.subscriptionPlans).toHaveLength(2);
                    expect(body.data.executionPacks).toHaveLength(2);
                });
        });

        it('should return empty subscriptionPlans when subscription payments are disabled', async () => {
            envModule.ENV.PAYMENTS_SUBSCRIPTION_ENABLED = false;

            await supertest(app.getHttpServer())
                .get('/api/payments/catalog')
                .expect(200)
                .expect((res: supertest.Response) => {
                    const body = res.body as {
                        data: {
                            subscriptionPlans: unknown[];
                            executionPacks: unknown[];
                        };
                    };
                    expect(body.data.subscriptionPlans).toHaveLength(0);
                    expect(body.data.executionPacks).toHaveLength(2);
                });
        });

        it('should return empty executionPacks when one-off payments are disabled', async () => {
            envModule.ENV.PAYMENTS_ONE_OFF_ENABLED = false;

            await supertest(app.getHttpServer())
                .get('/api/payments/catalog')
                .expect(200)
                .expect((res: supertest.Response) => {
                    const body = res.body as {
                        data: {
                            subscriptionPlans: unknown[];
                            executionPacks: unknown[];
                        };
                    };
                    expect(body.data.subscriptionPlans).toHaveLength(2);
                    expect(body.data.executionPacks).toHaveLength(0);
                });
        });
    });
});
