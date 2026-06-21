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
import { User, UserDocument } from '../src/modules/users/schemas/user.schema';
import {
    Business,
    BusinessDocument,
} from '../src/modules/businesses/schemas/business.schema';
import {
    BusinessSlugHistory,
    BusinessSlugHistoryDocument,
} from '../src/modules/businesses/schemas/business-slug-history.schema';
import { CURRENT_TERMS_VERSION } from '@finly/types';

// ─── Mock ENV ───

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
        STRIPE_SECRET_KEY: 'sk_test',
        STRIPE_WEBHOOK_SECRET: 'whsec_test',
        AUTH_LOCKOUT_THRESHOLDS: '5:1,10:5,20:15',
        AUTH_LOGIN_ATTEMPTS_TTL_MIN: 15,
        AUTH_MAGIC_LINK_TTL_MIN: 15,
        AUTH_MAGIC_LINK_RATE_LIMIT: 3,
        AUTH_MAGIC_LINK_RATE_WINDOW_MIN: 15,
        AUTH_MAGIC_LINK_DEDUP_SEC: 60,
        ACCOUNT_DELETION_GRACE_DAYS: 30,
        AUTH_PASSWORD_MIN_LENGTH: 8,
        // AuthModule → StorageModule → CloudflareR2Service: env-залежність
        // на R2 keys. Тести QR/upload-flow не запускаємо, але S3Client
        // створюється у constructor-і — fake values уникає fail-fast crash.
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

// ─── Mocks ───

/**
 * In-test @Global module, що експортує fake REDIS_CLIENT + stub
 * RedisCounterService. Production `RedisModule` не реєструється у
 * test-tree (бо ми не імпортуємо `AppModule`); цей замінник дублює його
 * @Global-контракт без ENV-залежності на ioredis. Імпортується перший у
 * RootTestModule, тож AuthService + інші споживачі бачать REDIS_CLIENT
 * через стандартний resolution.
 */
@Global()
@Module({
    providers: [
        {
            provide: REDIS_CLIENT,
            useFactory: () => createRedisMock(),
        },
        {
            provide: RedisCounterService,
            // Stub: повертає інкрементовані значення з in-memory map.
            // Жоден тест businesses-flow не упирається в rate-limit.
            useValue: {
                incrementFixed: jest.fn(async () => 1),
                incrementSliding: jest.fn(async () => 1),
            },
        },
        {
            provide: RedisLockService,
            // Pass-through: e2e — один процес без конкурентних create;
            // fake-Redis не має eval для compare-and-delete release.
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
        async incr(key: string) {
            const n = (parseInt(store.get(key) ?? '0', 10) || 0) + 1;
            store.set(key, String(n));
            return n;
        },
        async expire() {
            return 1;
        },
        async smembers() {
            return [];
        },
        async srem() {
            return 0;
        },
        async getdel(key: string) {
            const val = store.get(key) ?? null;
            if (val !== null) store.delete(key);
            return val;
        },
        pipeline() {
            const pipe = {
                set() {
                    return pipe;
                },
                del() {
                    return pipe;
                },
                incr() {
                    return pipe;
                },
                expire() {
                    return pipe;
                },
                async exec() {
                    return [];
                },
            };
            return pipe;
        },
        eval() {
            return 0;
        },
    };
}

// ─── Fixtures ───

const VALID_TAX_ID = '1234567899';

const VALID_CREATE_PAYLOAD = {
    type: 'fop',
    name: 'ФОП Іваненко',
    taxId: VALID_TAX_ID,
    taxationSystem: 'simplified-3',
    isVatPayer: false,
    paymentPurposeTemplate: 'Оплата за послуги',
};

// ─── Test ───

describe('Businesses E2E', () => {
    let app: INestApplication<App>;
    // Sprint 4 §4.2 — ReplSet (не standalone), бо `BusinessesService.delete`
    // тепер cascade-delete-ає інвойси через `withTransaction` (§SP-5).
    // Standalone mongod кидає `TRANSACTION_REQUIRES_REPLICA_SET` на delete-flow.
    let mongo: Awaited<ReturnType<typeof createReplSetMongo>>;
    let userModel: Model<UserDocument>;
    let businessModel: Model<BusinessDocument>;
    let historyModel: Model<BusinessSlugHistoryDocument>;
    let jwtService: JwtService;

    beforeAll(async () => {
        mongo = await createReplSetMongo();

        // Module-graph mirror's `app.module.ts` — повний набір AuthModule +
        // EmailModule + UsersModule + StorageModule розгортає циркулярні
        // залежності (UsersModule ↔ AuthModule ↔ StorageModule) точно так
        // само як у production. Тестова ізоляція досягається через
        // `.overrideProvider`: REDIS_CLIENT — in-memory mock, EmailService —
        // jest.fn-stub. R2 ENV-fake-keys (вище у jest.mock) уникають
        // fail-fast crash у `CloudflareR2Service` constructor, реальних
        // мережевих викликів S3 client не робить (ми не тестуємо upload-flow).
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
            ],
            providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
        })
            .overrideProvider(EmailService)
            .useValue({
                sendMagicLink: jest.fn().mockResolvedValue(undefined),
                sendDeletionConfirmation: jest
                    .fn()
                    .mockResolvedValue(undefined),
            })
            .compile();

        app = moduleFixture.createNestApplication();
        app.setGlobalPrefix('api');
        app.useGlobalPipes(new ZodValidationPipe());
        app.useGlobalFilters(new AllExceptionsFilter());
        await app.init();

        userModel = moduleFixture.get<Model<UserDocument>>(
            getModelToken(User.name)
        );
        businessModel = moduleFixture.get<Model<BusinessDocument>>(
            getModelToken(Business.name)
        );
        historyModel = moduleFixture.get<Model<BusinessSlugHistoryDocument>>(
            getModelToken(BusinessSlugHistory.name)
        );
        jwtService = moduleFixture.get(JwtService);
    }, 60_000);

    afterAll(async () => {
        await app.close();
        await mongo.stop();
    });

    beforeEach(async () => {
        await userModel.deleteMany({});
        await businessModel.deleteMany({});
    });

    // ─── Helpers ───

    // Sprint 19 — slug-редагування вимагає рівня не нижче brand. Тести rename
    // створюють користувача з активною підпискою brand.
    const ACTIVE_BRAND_BILLING = {
        provider: 'wayforpay',
        orderReference: null,
        recToken: null,
        cardMask: null,
        planCode: 'brand',
        currency: 'UAH',
        subscriptionStatus: 'ACTIVE',
        providerSubscriptionStatus: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        hasActiveSubscription: true,
        lastProviderEventAt: null,
        scheduledPlanCode: null,
        scheduledChangeDate: null,
        pendingUpgradePlanCode: null,
        pendingUpgradeOrderReference: null,
        rebindPendingAt: null,
        oneOffLevel: null,
        oneOffAccessUntil: null,
        oneOffOrderReference: null,
        reconcileRequiredAt: null,
    };

    async function createUser(
        overrides: Partial<UserDocument> = {}
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
            ...overrides,
        });
    }

    function bearerFor(user: UserDocument): string {
        return `Bearer ${jwtService.sign(
            { sub: user._id.toString(), email: user.email },
            { secret: 'e2e-access-secret-must-be-long-enough' }
        )}`;
    }

    // ─── Sprint 3 §3.4 — bookkeeper toggle endpoint (PATCH /users/me) ───

    describe('PATCH /users/me { worksAsBookkeeper }', () => {
        it('перемикає worksAsBookkeeper=true і повертає актуальне значення у response', async () => {
            const user = await createUser();
            const res = await supertest(app.getHttpServer())
                .patch('/api/users/me')
                .set('Authorization', bearerFor(user))
                .send({ worksAsBookkeeper: true })
                .expect(200);

            const body = res.body as {
                data: { worksAsBookkeeper: boolean };
            };
            expect(body.data.worksAsBookkeeper).toBe(true);
        });

        it('перемикає worksAsBookkeeper=false (вимкнення режиму)', async () => {
            const user = await createUser({
                worksAsBookkeeper: true,
            } as Partial<UserDocument>);
            const res = await supertest(app.getHttpServer())
                .patch('/api/users/me')
                .set('Authorization', bearerFor(user))
                .send({ worksAsBookkeeper: false })
                .expect(200);

            const body = res.body as {
                data: { worksAsBookkeeper: boolean };
            };
            expect(body.data.worksAsBookkeeper).toBe(false);
        });

        it('persists у БД (наступний getMe бачить новий стан)', async () => {
            const user = await createUser();
            await supertest(app.getHttpServer())
                .patch('/api/users/me')
                .set('Authorization', bearerFor(user))
                .send({ worksAsBookkeeper: true })
                .expect(200);

            const persisted = await userModel.findById(user._id);
            expect(persisted?.worksAsBookkeeper).toBe(true);
        });

        it('reject non-boolean (string "true") — 400 VALIDATION_ERROR', async () => {
            const user = await createUser();
            await supertest(app.getHttpServer())
                .patch('/api/users/me')
                .set('Authorization', bearerFor(user))
                .send({ worksAsBookkeeper: 'true' })
                .expect(400);
        });

        it('Sprint 3 — без Paid-валідації (toggle доступний усім)', async () => {
            // Free-користувач (без активної підписки) може ввімкнути режим.
            // Sprint 6 додасть frontend-модалку gate; service-layer Sprint 3
            // — без перевірки.
            const user = await createUser();
            expect(user.billing?.hasActiveSubscription).toBeFalsy();

            await supertest(app.getHttpServer())
                .patch('/api/users/me')
                .set('Authorization', bearerFor(user))
                .send({ worksAsBookkeeper: true })
                .expect(200);
        });
    });

    // ─── Cabinet: POST /businesses/me ───

    describe('POST /businesses/me', () => {
        it('створює owned business для звичайного ФОП — 201, slug згенерований', async () => {
            const user = await createUser();
            const res = await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send(VALID_CREATE_PAYLOAD)
                .expect(201);

            const body = res.body as {
                data: { slug: string; slugLower: string; ownerId: string };
            };
            expect(body.data.slug).toMatch(/^[A-Za-z0-9]{8}$/);
            expect(body.data.slugLower).toBe(body.data.slug.toLowerCase());
            expect(body.data.ownerId).toBe(user._id.toString());
        });

        it('створює ownerless business для бухгалтера', async () => {
            const user = await createUser({
                worksAsBookkeeper: true,
            } as Partial<UserDocument>);
            const res = await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send(VALID_CREATE_PAYLOAD)
                .expect(201);

            const body = res.body as {
                data: { ownerId: string | null; managers: string[] };
            };
            expect(body.data.ownerId).toBeNull();
            expect(body.data.managers).toEqual([user._id.toString()]);
        });

        it('reject coupled VAT (simplified-1 + isVatPayer=true) — 400 VALIDATION_ERROR', async () => {
            const user = await createUser();
            const res = await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send({
                    ...VALID_CREATE_PAYLOAD,
                    taxationSystem: 'simplified-1',
                    isVatPayer: true,
                })
                .expect(400);

            const body = res.body as { error: { code: string } };
            expect(body.error.code).toBe('VALIDATION_ERROR');
        });

        it('reject невідомий ключ payload-у через .strict() — 400', async () => {
            const user = await createUser();
            await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send({
                    ...VALID_CREATE_PAYLOAD,
                    slug: 'evil-vanity', // не приймається
                })
                .expect(400);
        });

        it('без auth — 401', async () => {
            await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .send(VALID_CREATE_PAYLOAD)
                .expect(401);
        });

        // ─── Sprint 7 §7.5 — 4 типи платників ───

        describe('Sprint 7 — type-aware create', () => {
            const VALID_RNOKPP = '1234567899';
            const VALID_EDRPOU = '12345678';
            const baseFields = {
                name: 'Іваненко',
                paymentPurposeTemplate: 'Оплата за послуги',
            };

            it('individual — без taxation, RNOKPP 10-digit → 201', async () => {
                const user = await createUser();
                const res = await supertest(app.getHttpServer())
                    .post('/api/businesses/me')
                    .set('Authorization', bearerFor(user))
                    .send({
                        ...baseFields,
                        type: 'individual',
                        taxId: VALID_RNOKPP,
                    })
                    .expect(201);

                const body = res.body as {
                    data: {
                        type: string;
                        taxationSystem: string | null;
                        isVatPayer: boolean | null;
                    };
                };
                expect(body.data.type).toBe('individual');
                expect(body.data.taxationSystem).toBeNull();
                expect(body.data.isVatPayer).toBeNull();
            });

            it('tov — taxation + ЄДРПОУ 8-digit → 201', async () => {
                const user = await createUser();
                const res = await supertest(app.getHttpServer())
                    .post('/api/businesses/me')
                    .set('Authorization', bearerFor(user))
                    .send({
                        ...baseFields,
                        type: 'tov',
                        taxId: VALID_EDRPOU,
                        taxationSystem: 'general',
                        isVatPayer: true,
                    })
                    .expect(201);

                const body = res.body as {
                    data: {
                        type: string;
                        taxationSystem: string;
                        isVatPayer: boolean;
                    };
                };
                expect(body.data.type).toBe('tov');
                expect(body.data.taxationSystem).toBe('general');
                expect(body.data.isVatPayer).toBe(true);
            });

            it('organization — без taxation, ЄДРПОУ 8-digit → 201', async () => {
                const user = await createUser();
                const res = await supertest(app.getHttpServer())
                    .post('/api/businesses/me')
                    .set('Authorization', bearerFor(user))
                    .send({
                        ...baseFields,
                        type: 'organization',
                        taxId: VALID_EDRPOU,
                    })
                    .expect(201);

                const body = res.body as {
                    data: {
                        type: string;
                        taxationSystem: string | null;
                    };
                };
                expect(body.data.type).toBe('organization');
                expect(body.data.taxationSystem).toBeNull();
            });

            it('reject taxation-fields на individual — 400 (.strict() unknown key)', async () => {
                const user = await createUser();
                await supertest(app.getHttpServer())
                    .post('/api/businesses/me')
                    .set('Authorization', bearerFor(user))
                    .send({
                        ...baseFields,
                        type: 'individual',
                        taxId: VALID_RNOKPP,
                        taxationSystem: 'simplified-3',
                        isVatPayer: false,
                    })
                    .expect(400);
            });

            it('reject 8-digit ЄДРПОУ для type=fop — 400 (per-variant validator)', async () => {
                const user = await createUser();
                await supertest(app.getHttpServer())
                    .post('/api/businesses/me')
                    .set('Authorization', bearerFor(user))
                    .send({
                        ...VALID_CREATE_PAYLOAD,
                        taxId: VALID_EDRPOU,
                    })
                    .expect(400);
            });

            it('reject 10-digit RNOKPP для type=organization — 400', async () => {
                const user = await createUser();
                await supertest(app.getHttpServer())
                    .post('/api/businesses/me')
                    .set('Authorization', bearerFor(user))
                    .send({
                        ...baseFields,
                        type: 'organization',
                        taxId: VALID_RNOKPP,
                    })
                    .expect(400);
            });

            it('reject missing taxationSystem для type=tov — 400', async () => {
                const user = await createUser();
                await supertest(app.getHttpServer())
                    .post('/api/businesses/me')
                    .set('Authorization', bearerFor(user))
                    .send({
                        ...baseFields,
                        type: 'tov',
                        taxId: VALID_EDRPOU,
                        isVatPayer: false,
                    })
                    .expect(400);
            });

            it('reject невідомий type-літерал — 400', async () => {
                const user = await createUser();
                await supertest(app.getHttpServer())
                    .post('/api/businesses/me')
                    .set('Authorization', bearerFor(user))
                    .send({
                        ...baseFields,
                        type: 'startup',
                        taxId: VALID_RNOKPP,
                    })
                    .expect(400);
            });

            // ПКУ розд. XIV гл. 1 — групи 1/2 єдиного податку доступні
            // виключно ФОП. ТОВ дозволяється `simplified-3` або `general`.
            it.each(['simplified-1', 'simplified-2'] as const)(
                'reject tov + %s — 400 VALIDATION_ERROR',
                async (taxationSystem) => {
                    const user = await createUser();
                    const res = await supertest(app.getHttpServer())
                        .post('/api/businesses/me')
                        .set('Authorization', bearerFor(user))
                        .send({
                            ...baseFields,
                            type: 'tov',
                            taxId: VALID_EDRPOU,
                            taxationSystem,
                            isVatPayer: false,
                        })
                        .expect(400);
                    const body = res.body as { error: { code: string } };
                    expect(body.error.code).toBe('VALIDATION_ERROR');
                }
            );

            it.each(['simplified-1', 'simplified-2'] as const)(
                'accept fop + %s (для ФОП дозволено усі 4 системи) — 201',
                async (taxationSystem) => {
                    const user = await createUser();
                    await supertest(app.getHttpServer())
                        .post('/api/businesses/me')
                        .set('Authorization', bearerFor(user))
                        .send({
                            ...baseFields,
                            type: 'fop',
                            taxId: VALID_RNOKPP,
                            taxationSystem,
                            isVatPayer: false,
                        })
                        .expect(201);
                }
            );
        });
    });

    // ─── Cabinet: GET /businesses/me ───

    describe('GET /businesses/me', () => {
        it('list owned businesses (bookkeeper OFF)', async () => {
            const user = await createUser();
            await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send(VALID_CREATE_PAYLOAD)
                .expect(201);

            const res = await supertest(app.getHttpServer())
                .get('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .expect(200);

            const body = res.body as { data: unknown[] };
            expect(body.data).toHaveLength(1);
        });

        it('toggle bookkeeper ховає owned-бізнеси (E5)', async () => {
            const user = await createUser();
            await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send(VALID_CREATE_PAYLOAD);

            // Перемикаємо toggle через real endpoint (Sprint 3 §3.4) —
            // covers повний flow: PATCH /users/me → updateProfile →
            // findOneAndUpdate → next request бачить новий стан.
            await supertest(app.getHttpServer())
                .patch('/api/users/me')
                .set('Authorization', bearerFor(user))
                .send({ worksAsBookkeeper: true })
                .expect(200);
            const refreshed = await userModel.findById(user._id);
            const res = await supertest(app.getHttpServer())
                .get('/api/businesses/me')
                .set('Authorization', bearerFor(refreshed!))
                .expect(200);

            const body = res.body as { data: unknown[] };
            expect(body.data).toHaveLength(0); // owned бізнеси приховані
        });

        it('?context=client фільтрує клієнтські навіть коли worksAsBookkeeper=false (фікс read-after-write race)', async () => {
            // User з персистентним флагом OFF + один owned-бізнес.
            const user = await createUser();
            await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send(VALID_CREATE_PAYLOAD)
                .expect(201);

            // GET з явним context=client має повернути клієнтський контекст
            // (0 owned бізнесів) — НЕ чекаючи, поки PATCH флага закомітиться.
            const clientRes = await supertest(app.getHttpServer())
                .get('/api/businesses/me?context=client')
                .set('Authorization', bearerFor(user))
                .expect(200);
            expect((clientRes.body as { data: unknown[] }).data).toHaveLength(
                0
            );

            // А context=own — власний (1), при тому ж незмінному флазі.
            const ownRes = await supertest(app.getHttpServer())
                .get('/api/businesses/me?context=own')
                .set('Authorization', bearerFor(user))
                .expect(200);
            expect((ownRes.body as { data: unknown[] }).data).toHaveLength(1);
        });

        it('?context=own показує власні навіть коли worksAsBookkeeper=true (зворотний override)', async () => {
            const user = await createUser();
            await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send(VALID_CREATE_PAYLOAD)
                .expect(201);
            await supertest(app.getHttpServer())
                .patch('/api/users/me')
                .set('Authorization', bearerFor(user))
                .send({ worksAsBookkeeper: true })
                .expect(200);
            const refreshed = await userModel.findById(user._id);

            const res = await supertest(app.getHttpServer())
                .get('/api/businesses/me?context=own')
                .set('Authorization', bearerFor(refreshed!))
                .expect(200);
            expect((res.body as { data: unknown[] }).data).toHaveLength(1);
        });
    });

    // ─── Cabinet: GET /businesses/me/:slug ───

    describe('GET /businesses/me/:slug', () => {
        it('owner отримує свій бізнес — 200', async () => {
            const user = await createUser();
            const created = await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send(VALID_CREATE_PAYLOAD);
            const { slug } = (created.body as { data: { slug: string } }).data;

            const res = await supertest(app.getHttpServer())
                .get(`/api/businesses/me/${slug}`)
                .set('Authorization', bearerFor(user))
                .expect(200);

            const body = res.body as { data: { slug: string } };
            expect(body.data.slug).toBe(slug);
        });

        it('case-insensitive lookup — slug у URL у нижньому регістрі знаходить бізнес з case-preserved', async () => {
            const user = await createUser();
            const created = await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send(VALID_CREATE_PAYLOAD);
            const { slug } = (created.body as { data: { slug: string } }).data;

            await supertest(app.getHttpServer())
                .get(`/api/businesses/me/${slug.toLowerCase()}`)
                .set('Authorization', bearerFor(user))
                .expect(200);

            await supertest(app.getHttpServer())
                .get(`/api/businesses/me/${slug.toUpperCase()}`)
                .set('Authorization', bearerFor(user))
                .expect(200);
        });

        it('чужий ФОП — 403 BUSINESS_ACCESS_DENIED', async () => {
            const owner = await createUser();
            const stranger = await createUser();
            const created = await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(owner))
                .send(VALID_CREATE_PAYLOAD);
            const { slug } = (created.body as { data: { slug: string } }).data;

            const res = await supertest(app.getHttpServer())
                .get(`/api/businesses/me/${slug}`)
                .set('Authorization', bearerFor(stranger))
                .expect(403);

            const body = res.body as { error: { code: string } };
            expect(body.error.code).toBe('BUSINESS_ACCESS_DENIED');
        });

        it('неіснуючий slug — 404 BUSINESS_NOT_FOUND', async () => {
            const user = await createUser();
            const res = await supertest(app.getHttpServer())
                .get('/api/businesses/me/missing-slug')
                .set('Authorization', bearerFor(user))
                .expect(404);

            const body = res.body as { error: { code: string } };
            expect(body.error.code).toBe('BUSINESS_NOT_FOUND');
        });
    });

    // ─── Cabinet: PATCH /businesses/me/:slug ───

    describe('PATCH /businesses/me/:slug', () => {
        it('update name partial — 200', async () => {
            const user = await createUser();
            const created = await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send(VALID_CREATE_PAYLOAD);
            const { slug } = (created.body as { data: { slug: string } }).data;

            const res = await supertest(app.getHttpServer())
                .patch(`/api/businesses/me/${slug}`)
                .set('Authorization', bearerFor(user))
                .send({ name: 'Нова назва' })
                .expect(200);

            const body = res.body as { data: { name: string } };
            expect(body.data.name).toBe('Нова назва');
        });

        it('Sprint 9 §9.1 contract — list response має `id: string` per item + `accountsCount` + `invoicesCount`', async () => {
            const user = await createUser();
            await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send(VALID_CREATE_PAYLOAD)
                .expect(201);

            const res = await supertest(app.getHttpServer())
                .get('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .expect(200);

            const items = (res.body as { data: Array<Record<string, unknown>> })
                .data;
            expect(items.length).toBeGreaterThan(0);
            for (const item of items) {
                expect(typeof item.id).toBe('string');
                expect(item.id).toMatch(/^[a-f0-9]{24}$/);
                expect(item).not.toHaveProperty('_id');
                expect(item).not.toHaveProperty('__v');
                expect(typeof item.accountsCount).toBe('number');
                expect(typeof item.invoicesCount).toBe('number');
                expect(item).not.toHaveProperty('requisites');
                expect(item).not.toHaveProperty('invoiceSlugPresetDefault');
            }
        });

        it('Sprint 9 §9.1 contract — getBySlug response має `id: string` + `accountsCount` + `invoicesCount`', async () => {
            const user = await createUser();
            const created = await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send(VALID_CREATE_PAYLOAD);
            const { slug } = (created.body as { data: { slug: string } }).data;

            const res = await supertest(app.getHttpServer())
                .get(`/api/businesses/me/${slug}`)
                .set('Authorization', bearerFor(user))
                .expect(200);

            const data = (res.body as { data: Record<string, unknown> }).data;
            expect(typeof data.id).toBe('string');
            expect(data.id).toMatch(/^[a-f0-9]{24}$/);
            expect(data).not.toHaveProperty('_id');
            expect(data).not.toHaveProperty('__v');
            expect(typeof data.accountsCount).toBe('number');
            expect(typeof data.invoicesCount).toBe('number');
            expect(data).not.toHaveProperty('requisites');
            expect(data).not.toHaveProperty('invoiceSlugPresetDefault');
            expect(data.taxId).toBe(VALID_TAX_ID);
        });

        it('Sprint 14 — vanity-slug edit через PATCH (200): slug перейменовується, старий slugLower звільняється', async () => {
            const user = await createUser({ billing: ACTIVE_BRAND_BILLING });
            const created = await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send(VALID_CREATE_PAYLOAD);
            const { slug } = (created.body as { data: { slug: string } }).data;
            const newSlug = 'nova-vanity-adresa';

            const res = await supertest(app.getHttpServer())
                .patch(`/api/businesses/me/${slug}`)
                .set('Authorization', bearerFor(user))
                .send({ slug: newSlug })
                .expect(200);

            const body = res.body as { data: { slug: string } };
            expect(body.data.slug).toBe(newSlug);

            // БД: документ тепер під новим slugLower, зі збереженим case.
            const renamed = await businessModel.findOne({
                slugLower: newSlug.toLowerCase(),
            });
            expect(renamed?.slug).toBe(newSlug);

            // Старий slugLower більше не вказує на живий документ (звільнений).
            const oldStillResolves = await businessModel.findOne({
                slugLower: slug.toLowerCase(),
            });
            expect(oldStillResolves).toBeNull();
        });

        it.each([
            'type',
            'ownerId',
            'managers',
            'slugLower',
            'id',
            'createdAt',
        ])('reject спробу змінити %s через PATCH (.strict())', async (key) => {
            const user = await createUser();
            const created = await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send(VALID_CREATE_PAYLOAD);
            const { slug } = (created.body as { data: { slug: string } }).data;

            await supertest(app.getHttpServer())
                .patch(`/api/businesses/me/${slug}`)
                .set('Authorization', bearerFor(user))
                .send({ [key]: 'evil' })
                .expect(400);
        });

        it('Sprint 9 §SP-1 — `invoiceSlugPresetDefault` видалено з business (переїхав на Account); PATCH reject-ить unknown key', async () => {
            const user = await createUser();
            const created = await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send(VALID_CREATE_PAYLOAD);
            const { slug } = (created.body as { data: { slug: string } }).data;

            await supertest(app.getHttpServer())
                .patch(`/api/businesses/me/${slug}`)
                .set('Authorization', bearerFor(user))
                .send({ invoiceSlugPresetDefault: 'with-month' })
                .expect(400);
        });

        // ─── Sprint 7 §7.5 — PATCH type-aware cross-checks (real DB) ───

        it('Sprint 7 — reject taxation-PATCH на individual бізнесі — 400 TAXATION_NOT_APPLICABLE_FOR_TYPE', async () => {
            const user = await createUser();
            const created = await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send({
                    type: 'individual',
                    name: 'Збір',
                    taxId: VALID_TAX_ID,
                    paymentPurposeTemplate: 'Збір',
                })
                .expect(201);
            const { slug } = (created.body as { data: { slug: string } }).data;

            const res = await supertest(app.getHttpServer())
                .patch(`/api/businesses/me/${slug}`)
                .set('Authorization', bearerFor(user))
                .send({ taxationSystem: 'simplified-3' })
                .expect(400);

            const body = res.body as { error: { code: string } };
            expect(body.error.code).toBe('TAXATION_NOT_APPLICABLE_FOR_TYPE');
        });

        it('Sprint 7 — reject 8-digit ЄДРПОУ-PATCH на fop бізнесі — 400 TAX_ID_FORMAT_MISMATCH_TYPE', async () => {
            const user = await createUser();
            const created = await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send(VALID_CREATE_PAYLOAD);
            const { slug } = (created.body as { data: { slug: string } }).data;

            const res = await supertest(app.getHttpServer())
                .patch(`/api/businesses/me/${slug}`)
                .set('Authorization', bearerFor(user))
                .send({ taxId: '12345678' /* 8-digit ЄДРПОУ */ })
                .expect(400);

            const body = res.body as { error: { code: string } };
            expect(body.error.code).toBe('TAX_ID_FORMAT_MISMATCH_TYPE');
        });

        it('Sprint 7 — reject taxation-clear-out (PATCH null) на fop — 400 TAXATION_REQUIRED_FOR_TYPE (backward-direction)', async () => {
            const user = await createUser();
            const created = await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send(VALID_CREATE_PAYLOAD);
            const { slug } = (created.body as { data: { slug: string } }).data;

            const res = await supertest(app.getHttpServer())
                .patch(`/api/businesses/me/${slug}`)
                .set('Authorization', bearerFor(user))
                .send({ taxationSystem: null })
                .expect(400);

            const body = res.body as { error: { code: string } };
            // backward-direction: окремий код від forward (individual+taxation),
            // бо UX-recovery різний — "оберіть систему" vs "приберіть поле".
            expect(body.error.code).toBe('TAXATION_REQUIRED_FOR_TYPE');
        });

        it.each(['simplified-1', 'simplified-2'] as const)(
            'PATCH ТОВ на %s — 400 TAXATION_SYSTEM_NOT_ALLOWED_FOR_TYPE',
            async (taxationSystem) => {
                const user = await createUser();
                // Створюємо ТОВ на дозволеній системі.
                const created = await supertest(app.getHttpServer())
                    .post('/api/businesses/me')
                    .set('Authorization', bearerFor(user))
                    .send({
                        type: 'tov',
                        name: 'ТОВ',
                        taxId: '12345678',
                        taxationSystem: 'general',
                        isVatPayer: true,
                        paymentPurposeTemplate: 'Оплата',
                    });
                const { slug } = (created.body as { data: { slug: string } })
                    .data;

                // Defense-in-depth: curl-bypass frontend-filter dropdown-а.
                const res = await supertest(app.getHttpServer())
                    .patch(`/api/businesses/me/${slug}`)
                    .set('Authorization', bearerFor(user))
                    .send({ taxationSystem })
                    .expect(400);

                const body = res.body as { error: { code: string } };
                expect(body.error.code).toBe(
                    'TAXATION_SYSTEM_NOT_ALLOWED_FOR_TYPE'
                );
            }
        );

        it('coupled cross-field VAT (PATCH тільки isVatPayer=true з existing simplified-1) — 400', async () => {
            const user = await createUser();
            // Створюємо бізнес з simplified-1
            const created = await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send({
                    ...VALID_CREATE_PAYLOAD,
                    taxationSystem: 'simplified-1',
                    isVatPayer: false,
                });
            const { slug } = (created.body as { data: { slug: string } }).data;

            const res = await supertest(app.getHttpServer())
                .patch(`/api/businesses/me/${slug}`)
                .set('Authorization', bearerFor(user))
                .send({ isVatPayer: true })
                .expect(400);

            // Service-layer cross-field check кидає explicit machine-code
            // (не generic VALIDATION_ERROR від Zod-pipe) — frontend може
            // зматчити саме `INVALID_VAT_FOR_TAXATION_SYSTEM` через
            // `mapApiCode('businesses', code)` і показати inline-помилку.
            const body = res.body as { error: { code: string } };
            expect(body.error.code).toBe('INVALID_VAT_FOR_TAXATION_SYSTEM');
        });
    });

    // ─── Cabinet: DELETE /businesses/me/:slug ───

    describe('DELETE /businesses/me/:slug', () => {
        it('owner може видалити свій бізнес — 200, slug звільняється', async () => {
            const user = await createUser();
            const created = await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send(VALID_CREATE_PAYLOAD);
            const { slug } = (created.body as { data: { slug: string } }).data;

            await supertest(app.getHttpServer())
                .delete(`/api/businesses/me/${slug}`)
                .set('Authorization', bearerFor(user))
                .expect(200);

            // Slug видалений з БД (hard-delete)
            const exists = await businessModel.findOne({
                slugLower: slug.toLowerCase(),
            });
            expect(exists).toBeNull();
        });

        it('чужий — 403 BUSINESS_ACCESS_DENIED', async () => {
            const owner = await createUser();
            const stranger = await createUser();
            const created = await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(owner))
                .send(VALID_CREATE_PAYLOAD);
            const { slug } = (created.body as { data: { slug: string } }).data;

            await supertest(app.getHttpServer())
                .delete(`/api/businesses/me/${slug}`)
                .set('Authorization', bearerFor(stranger))
                .expect(403);
        });
    });

    // ─── Public ───

    describe('GET /businesses/public/:slug', () => {
        it('Sprint 9 §SP-4 — повертає whitelist полів + `accounts: []` (без nbuLinks на business-level)', async () => {
            const user = await createUser();
            const created = await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send(VALID_CREATE_PAYLOAD);
            const { slug } = (created.body as { data: { slug: string } }).data;

            const res = await supertest(app.getHttpServer())
                .get(`/api/businesses/public/${slug}`)
                .expect(200);

            const body = res.body as {
                data: Record<string, unknown> & {
                    accounts: Array<unknown>;
                };
            };
            expect(Object.keys(body.data).sort()).toEqual([
                'accounts',
                'name',
                'seoIndexEnabled',
                'slug',
                'type',
            ]);
            expect(body.data).not.toHaveProperty('requisites');
            expect(body.data).not.toHaveProperty('taxId');
            expect(body.data).not.toHaveProperty('taxationSystem');
            expect(body.data).not.toHaveProperty('isVatPayer');
            expect(body.data).not.toHaveProperty('ownerId');
            expect(body.data).not.toHaveProperty('nbuLinks');
            // Без accounts на бізнесі — empty array.
            expect(body.data.accounts).toEqual([]);
        });

        it('case-insensitive lookup на public', async () => {
            const user = await createUser();
            const created = await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send(VALID_CREATE_PAYLOAD);
            const { slug } = (created.body as { data: { slug: string } }).data;

            await supertest(app.getHttpServer())
                .get(`/api/businesses/public/${slug.toLowerCase()}`)
                .expect(200);
            await supertest(app.getHttpServer())
                .get(`/api/businesses/public/${slug.toUpperCase()}`)
                .expect(200);
        });

        it('повертає 404 для невідомого slug', async () => {
            const res = await supertest(app.getHttpServer())
                .get('/api/businesses/public/missing-slug')
                .expect(404);

            const body = res.body as { error: { code: string } };
            expect(body.error.code).toBe('BUSINESS_NOT_FOUND');
        });

        it('Sprint 19 — заблокований бізнес гасне публічно (404)', async () => {
            const user = await createUser();
            const created = await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send(VALID_CREATE_PAYLOAD);
            const { slug } = (created.body as { data: { slug: string } }).data;

            await businessModel.updateOne(
                { slugLower: slug.toLowerCase() },
                { $set: { accessBlockedAt: new Date() } }
            );

            await supertest(app.getHttpServer())
                .get(`/api/businesses/public/${slug}`)
                .expect(404);
        });

        it('Sprint 19 — lapse-history (redirect:false) не резолвиться публічно (404)', async () => {
            const user = await createUser();
            const created = await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send(VALID_CREATE_PAYLOAD);
            const business = (created.body as { data: { id: string } }).data;

            // Старе ім'я на холді без редіректу (як після lapse-reset).
            await historyModel.create({
                businessId: new Types.ObjectId(business.id),
                slugLower: 'staryj-vanity',
                redirect: false,
            });
            await supertest(app.getHttpServer())
                .get('/api/businesses/public/staryj-vanity')
                .expect(404);

            // Контроль: redirect:true (добровільний rename) резолвиться у бізнес.
            await historyModel.create({
                businessId: new Types.ObjectId(business.id),
                slugLower: 'redirect-vanity',
                redirect: true,
            });
            await supertest(app.getHttpServer())
                .get('/api/businesses/public/redirect-vanity')
                .expect(200);
        });

        it('встановлює Cache-Control: public для shared-CDN', async () => {
            const user = await createUser();
            const created = await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send(VALID_CREATE_PAYLOAD);
            const { slug } = (created.body as { data: { slug: string } }).data;

            const res = await supertest(app.getHttpServer())
                .get(`/api/businesses/public/${slug}`)
                .expect(200);

            expect(res.headers['cache-control']).toMatch(/public/);
            // Sprint 19 — короткий TTL без stale-while-revalidate: сторінка
            // revocable через accessBlockedAt, тож CDN не має віддавати погашену
            // сторінку після спливу max-age.
            expect(res.headers['cache-control']).toMatch(/max-age=300/);
            expect(res.headers['cache-control']).not.toMatch(
                /stale-while-revalidate/
            );
        });

        it('не вимагає auth (public)', async () => {
            const user = await createUser();
            const created = await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send(VALID_CREATE_PAYLOAD);
            const { slug } = (created.body as { data: { slug: string } }).data;

            // Без Authorization header
            await supertest(app.getHttpServer())
                .get(`/api/businesses/public/${slug}`)
                .expect(200);
        });
    });

    // Sprint 9: NBU QR endpoints живуть на `PublicAccountsController`
    // (`/businesses/public/:slug/account/:accountSlug/qr/...`).
    //
    // Sprint 14: на business-level повертається тип-2 QR (вітрина бізнесу).
    // Тип-1 (NBU-payload) тут неможливий — IBAN живе на рахунку.
    describe('GET /businesses/public/:slug/qr/business.png (Sprint 14)', () => {
        async function seedBusinessSlug(): Promise<string> {
            const user = await createUser();
            const created = await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send(VALID_CREATE_PAYLOAD);
            return (created.body as { data: { slug: string } }).data.slug;
        }

        it('повертає Content-Type image/png', async () => {
            const slug = await seedBusinessSlug();
            const res = await supertest(app.getHttpServer())
                .get(`/api/businesses/public/${slug}/qr/business.png`)
                .expect(200);
            expect(res.headers['content-type']).toBe('image/png');
        });

        it('?size=<довільне> → 400 (whitelist)', async () => {
            const slug = await seedBusinessSlug();
            await supertest(app.getHttpServer())
                .get(`/api/businesses/public/${slug}/qr/business.png?size=9999`)
                .expect(400);
        });

        // size=screen (дефолт-розмір) — attachment-заголовок не залежить від
        // розміру; print-рендер (важчий 1024px) покрито integration round-trip.
        it('?download=1 → Content-Disposition attachment', async () => {
            const slug = await seedBusinessSlug();
            const res = await supertest(app.getHttpServer())
                .get(
                    `/api/businesses/public/${slug}/qr/business.png?download=1`
                )
                .expect(200);
            expect(res.headers['content-disposition']).toContain('attachment');
        });

        it('404 на неіснуючому slug', async () => {
            await supertest(app.getHttpServer())
                .get('/api/businesses/public/missing-slug/qr/business.png')
                .expect(404);
        });
    });
});
