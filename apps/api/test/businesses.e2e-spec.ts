import { Test, TestingModule } from '@nestjs/testing';
import { Global, INestApplication, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { MongoMemoryServer } from 'mongodb-memory-server';
import * as supertest from 'supertest';
import { App } from 'supertest/types';
import { ZodValidationPipe } from 'nestjs-zod';
import { Model, Types } from 'mongoose';

import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { REDIS_CLIENT } from '../src/common/modules/redis.module';
import { RedisCounterService } from '../src/common/services/redis-counter.service';
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
import { CURRENT_TERMS_VERSION } from '@finly/types';

// ─── Mock ENV ───

jest.mock('../src/config/env', () => ({
    ENV: {
        NODE_ENV: 'test',
        PORT: '4000',
        WEB_URL: 'https://finly.com.ua',
        PAY_PUBLIC_URL: 'https://pay.finly.com.ua',
        MONGODB_URI: 'overridden-by-MongoMemoryServer',
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
    ],
    exports: [REDIS_CLIENT, RedisCounterService],
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

const VALID_IBAN = 'UA213223130000026007233566001';
const VALID_TAX_ID = '1234567899';

const VALID_CREATE_PAYLOAD = {
    type: 'fop',
    name: 'ФОП Іваненко',
    requisites: { iban: VALID_IBAN, taxId: VALID_TAX_ID },
    taxationSystem: 'simplified-3',
    isVatPayer: false,
    paymentPurposeTemplate: 'Оплата за послуги',
    acceptedBanks: ['privatbank', 'monobank'],
};

// ─── Test ───

describe('Businesses E2E', () => {
    let app: INestApplication<App>;
    let mongoServer: MongoMemoryServer;
    let userModel: Model<UserDocument>;
    let businessModel: Model<BusinessDocument>;
    let jwtService: JwtService;

    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();

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
                MongooseModule.forRoot(mongoServer.getUri()),
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
        jwtService = moduleFixture.get(JwtService);
    }, 60_000);

    afterAll(async () => {
        await app.close();
        await mongoServer.stop();
    });

    beforeEach(async () => {
        await userModel.deleteMany({});
        await businessModel.deleteMany({});
    });

    // ─── Helpers ───

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

        it('reject empty acceptedBanks (мінімум 1 — B6) — 400', async () => {
            const user = await createUser();
            await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send({
                    ...VALID_CREATE_PAYLOAD,
                    acceptedBanks: [],
                })
                .expect(400);
        });

        it('без auth — 401', async () => {
            await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .send(VALID_CREATE_PAYLOAD)
                .expect(401);
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

        it('reject спробу змінити slug через PATCH — 400 (slug-immutability via .strict())', async () => {
            const user = await createUser();
            const created = await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send(VALID_CREATE_PAYLOAD);
            const { slug } = (created.body as { data: { slug: string } }).data;

            const res = await supertest(app.getHttpServer())
                .patch(`/api/businesses/me/${slug}`)
                .set('Authorization', bearerFor(user))
                .send({ slug: 'evil-vanity' })
                .expect(400);

            const body = res.body as { error: { code: string } };
            expect(body.error.code).toBe('VALIDATION_ERROR');

            // Перевіримо, що БД не змінилась
            const stillThere = await businessModel.findOne({
                slugLower: slug.toLowerCase(),
            });
            expect(stillThere?.slug).toBe(slug);
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

        it('Sprint 4 §4.1 — PATCH invoiceSlugPresetDefault зберігає поле і getBySlug повертає його (e2e cycle)', async () => {
            const user = await createUser();
            const created = await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send(VALID_CREATE_PAYLOAD);
            const { slug } = (created.body as { data: { slug: string } }).data;

            // На create — поле = null (default)
            const initial = await supertest(app.getHttpServer())
                .get(`/api/businesses/me/${slug}`)
                .set('Authorization', bearerFor(user))
                .expect(200);
            expect(
                (initial.body as { data: { invoiceSlugPresetDefault: string | null } }).data
                    .invoiceSlugPresetDefault
            ).toBeNull();

            // PATCH на 'with-month'
            const patched = await supertest(app.getHttpServer())
                .patch(`/api/businesses/me/${slug}`)
                .set('Authorization', bearerFor(user))
                .send({ invoiceSlugPresetDefault: 'with-month' })
                .expect(200);
            expect(
                (patched.body as { data: { invoiceSlugPresetDefault: string } }).data
                    .invoiceSlugPresetDefault
            ).toBe('with-month');

            // GET знову — поле persisted
            const reread = await supertest(app.getHttpServer())
                .get(`/api/businesses/me/${slug}`)
                .set('Authorization', bearerFor(user))
                .expect(200);
            expect(
                (reread.body as { data: { invoiceSlugPresetDefault: string } }).data
                    .invoiceSlugPresetDefault
            ).toBe('with-month');

            // Reset на null — теж валідно (semantic "не визначено")
            const resetRes = await supertest(app.getHttpServer())
                .patch(`/api/businesses/me/${slug}`)
                .set('Authorization', bearerFor(user))
                .send({ invoiceSlugPresetDefault: null })
                .expect(200);
            expect(
                (resetRes.body as { data: { invoiceSlugPresetDefault: string | null } })
                    .data.invoiceSlugPresetDefault
            ).toBeNull();
        });

        it('Sprint 4 §4.1 — rejects unknown slug-preset value (Zod enum)', async () => {
            const user = await createUser();
            const created = await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send(VALID_CREATE_PAYLOAD);
            const { slug } = (created.body as { data: { slug: string } }).data;

            await supertest(app.getHttpServer())
                .patch(`/api/businesses/me/${slug}`)
                .set('Authorization', bearerFor(user))
                .send({ invoiceSlugPresetDefault: 'unknown-preset' })
                .expect(400);
        });

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
        it('повертає whitelist полів + nbuLinks; реквізити не leak-нуті у JSON', async () => {
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
                    nbuLinks: { primary: string; legacy: string };
                };
            };
            expect(Object.keys(body.data).sort()).toEqual([
                'acceptedBanks',
                'name',
                'nbuLinks',
                'seoIndexEnabled',
                'slug',
                'type',
            ]);
            // Реквізити НЕ leak-нуто прямо у JSON
            expect(body.data).not.toHaveProperty('requisites');
            expect(body.data).not.toHaveProperty('taxationSystem');
            expect(body.data).not.toHaveProperty('isVatPayer');
            expect(body.data).not.toHaveProperty('ownerId');
            // nbuLinks ведуть на правильні host-и (рішення A2)
            expect(body.data.nbuLinks.primary).toMatch(
                /^https:\/\/qr\.bank\.gov\.ua\//
            );
            expect(body.data.nbuLinks.legacy).toMatch(
                /^https:\/\/bank\.gov\.ua\/qr\//
            );
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
            expect(res.headers['cache-control']).toMatch(/max-age=3600/);
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

    describe('GET /businesses/public/:slug/qr/business.png', () => {
        it('віддає PNG з Cache-Control public', async () => {
            const user = await createUser();
            const created = await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send(VALID_CREATE_PAYLOAD);
            const { slug } = (created.body as { data: { slug: string } }).data;

            const res = await supertest(app.getHttpServer())
                .get(`/api/businesses/public/${slug}/qr/business.png`)
                .expect(200);

            expect(res.headers['content-type']).toContain('image/png');
            expect(res.headers['cache-control']).toMatch(/public/);
            expect(res.body.length).toBeGreaterThan(0);
        });

        it('QR кодує PAY_PUBLIC_URL host (не WEB_URL/cabinet) — round-trip jsqr', async () => {
            // Регресія: QR на cabinet host (`finly.com.ua/{slug}`) ламає UX, бо
            // host-aware middleware §3.9 на cabinet root-slug повертає 404.
            // Декодуємо PNG-buffer назад у URL і перевіряємо host.
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const jsQR = require('jsqr') as typeof import('jsqr').default;
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const sharp = require('sharp') as typeof import('sharp');

            const user = await createUser();
            const created = await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send(VALID_CREATE_PAYLOAD);
            const { slug } = (created.body as { data: { slug: string } }).data;

            const res = await supertest(app.getHttpServer())
                .get(`/api/businesses/public/${slug}/qr/business.png`)
                .responseType('blob')
                .expect(200);

            const { data, info } = await sharp(res.body as Buffer)
                .ensureAlpha()
                .raw()
                .toBuffer({ resolveWithObject: true });
            const decoded = jsQR(
                new Uint8ClampedArray(
                    data.buffer,
                    data.byteOffset,
                    data.byteLength
                ),
                info.width,
                info.height
            );
            expect(decoded).not.toBeNull();
            expect(decoded!.data).toBe(`https://pay.finly.com.ua/${slug}`);
            // Sanity: НЕ cabinet origin
            expect(decoded!.data).not.toBe(`https://finly.com.ua/${slug}`);
        });
    });

    describe('GET /businesses/public/:slug/qr/nbu.png', () => {
        it('?host=primary — PNG з payload на qr.bank.gov.ua', async () => {
            const user = await createUser();
            const created = await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send(VALID_CREATE_PAYLOAD);
            const { slug } = (created.body as { data: { slug: string } }).data;

            const res = await supertest(app.getHttpServer())
                .get(`/api/businesses/public/${slug}/qr/nbu.png?host=primary`)
                .expect(200);
            expect(res.headers['content-type']).toContain('image/png');
        });

        it('?host=legacy — PNG з payload на bank.gov.ua/qr', async () => {
            const user = await createUser();
            const created = await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send(VALID_CREATE_PAYLOAD);
            const { slug } = (created.body as { data: { slug: string } }).data;

            await supertest(app.getHttpServer())
                .get(`/api/businesses/public/${slug}/qr/nbu.png?host=legacy`)
                .expect(200);
        });

        it('?host=invalid — 400 VALIDATION_ERROR', async () => {
            const user = await createUser();
            const created = await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send(VALID_CREATE_PAYLOAD);
            const { slug } = (created.body as { data: { slug: string } }).data;

            await supertest(app.getHttpServer())
                .get(`/api/businesses/public/${slug}/qr/nbu.png?host=hacker`)
                .expect(400);
        });

        it('без host — 400', async () => {
            const user = await createUser();
            const created = await supertest(app.getHttpServer())
                .post('/api/businesses/me')
                .set('Authorization', bearerFor(user))
                .send(VALID_CREATE_PAYLOAD);
            const { slug } = (created.body as { data: { slug: string } }).data;

            await supertest(app.getHttpServer())
                .get(`/api/businesses/public/${slug}/qr/nbu.png`)
                .expect(400);
        });
    });
});
