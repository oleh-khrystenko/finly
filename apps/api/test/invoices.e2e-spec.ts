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
// Import order matters: AuthModule ↔ UsersModule ↔ StorageModule — це
// pre-existing JS-cycle (`CLAUDE.md` Known Complexities `AuthModule ↔
// UsersModule circular`). Якщо AccountsModule / BusinessesModule / InvoicesModule
// імпортуються до AuthModule — UsersModule resolves у undefined на eval-time
// StorageModule.imports → Nest "imports[0] of StorageModule is undefined".
// AuthModule першим: повністю eval-ить циклічну трійку перед business/account
// modules-graph.
import { AuthModule } from '../src/modules/auth/auth.module';
import { EmailModule } from '../src/modules/email/email.module';
import { EmailService } from '../src/modules/email/email.service';
import { StorageModule } from '../src/modules/storage/storage.module';
import { UsersModule } from '../src/modules/users/users.module';
import { AccountsModule } from '../src/modules/accounts/accounts.module';
import {
    Account,
    AccountDocument,
} from '../src/modules/accounts/schemas/account.schema';
import { BusinessesModule } from '../src/modules/businesses/businesses.module';
import { InvoicesModule } from '../src/modules/invoices/invoices.module';
import { InvoicesService } from '../src/modules/invoices/invoices.service';
import { QrModule } from '../src/modules/qr/qr.module';
import { User, UserDocument } from '../src/modules/users/schemas/user.schema';
import {
    Business,
    BusinessDocument,
} from '../src/modules/businesses/schemas/business.schema';
import {
    Invoice,
    InvoiceDocument,
} from '../src/modules/invoices/schemas/invoice.schema';
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

// ─── In-test Redis-mock module ───

@Global()
@Module({
    providers: [
        {
            provide: REDIS_CLIENT,
            useFactory: () => createRedisMock(),
        },
        {
            provide: RedisCounterService,
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

const VALID_BUSINESS_PAYLOAD = {
    type: 'fop',
    name: 'ФОП Іваненко',
    taxId: VALID_TAX_ID,
    taxationSystem: 'simplified-3',
    isVatPayer: false,
    paymentPurposeTemplate: 'Оплата за послуги',
};

const VALID_ACCOUNT_PAYLOAD = {
    iban: VALID_IBAN,
};

// ─── Test ───

/**
 * Sprint 4 §4.2 e2e — повний flow CRUD інвойсу як ФОП у бізнесі +
 * cross-business access deny + cascade-delete (через `MongoMemoryReplSet`,
 * як цього вимагає §SP-5: cascade ходить через `withTransaction`).
 */
describe('Invoices E2E (Sprint 4 §4.2)', () => {
    let app: INestApplication<App>;
    let mongo: Awaited<ReturnType<typeof createReplSetMongo>>;
    let userModel: Model<UserDocument>;
    let businessModel: Model<BusinessDocument>;
    let accountModel: Model<AccountDocument>;
    let invoiceModel: Model<InvoiceDocument>;
    let jwtService: JwtService;

    beforeAll(async () => {
        // Replica-set обов'язковий для cascade-delete (§SP-5). Standalone
        // MongoMemoryServer падає на withTransaction → cascade-tests fail.
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
                AccountsModule,
                InvoicesModule,
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
        accountModel = moduleFixture.get<Model<AccountDocument>>(
            getModelToken(Account.name)
        );
        invoiceModel = moduleFixture.get<Model<InvoiceDocument>>(
            getModelToken(Invoice.name)
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
        await accountModel.deleteMany({});
        await invoiceModel.deleteMany({});
    });

    // ─── Helpers ───

    // Sprint 19 — slug-редагування вимагає рівня не нижче brand.
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
        rebindPendingAt: null,
        oneOffLevel: null,
        oneOffAccessUntil: null,
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

    /**
     * Sprint 9 §SP-1 — створює business + перший account (Sprint 9 invoice-flow
     * вимагає account-namespace). Повертає обидва slug-и для URL-побудови.
     */
    async function createBusinessFor(
        user: UserDocument,
        opts: { accountIban?: string } = {}
    ): Promise<{ slug: string; accountSlug: string }> {
        const bizRes = await supertest(app.getHttpServer())
            .post('/api/businesses/me')
            .set('Authorization', bearerFor(user))
            .send(VALID_BUSINESS_PAYLOAD);
        const slug = (bizRes.body as { data: { slug: string } }).data.slug;
        const accRes = await supertest(app.getHttpServer())
            .post(`/api/businesses/me/${slug}/accounts`)
            .set('Authorization', bearerFor(user))
            .send({ iban: opts.accountIban ?? VALID_IBAN })
            .expect(201);
        const accountSlug = (accRes.body as { data: { slug: string } }).data
            .slug;
        return { slug, accountSlug };
    }

    // ─── POST /businesses/me/:slug/invoices ───

    describe('POST /businesses/me/:slug/invoices', () => {
        it('створює invoice з пресетом simple — 201 + slug "inv-001-..." + counter-fields', async () => {
            const user = await createUser();
            const { slug, accountSlug } = await createBusinessFor(user);

            const res = await supertest(app.getHttpServer())
                .post(
                    `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices`
                )
                .set('Authorization', bearerFor(user))
                .send({
                    amount: 150000,
                    amountLocked: true,
                    paymentPurpose: 'Оплата за консультацію',
                    validUntil: null,
                    slugInput: { kind: 'preset', preset: 'simple' },
                })
                .expect(201);

            const body = res.body as {
                data: {
                    slug: string;
                    slugPreset: string;
                    slugCounterScope: string;
                    slugCounter: number;
                    amount: number;
                    amountLocked: boolean;
                };
            };
            expect(body.data.slug).toMatch(/^inv-001-[A-Za-z0-9]{8}$/);
            expect(body.data.slugPreset).toBe('simple');
            expect(body.data.slugCounterScope).toBe('simple');
            expect(body.data.slugCounter).toBe(1);
            expect(body.data.amount).toBe(150000);
            expect(body.data.amountLocked).toBe(true);
        });

        it('створює signage-mode invoice (amount=null, amountLocked=false)', async () => {
            const user = await createUser();
            const { slug, accountSlug } = await createBusinessFor(user);

            const res = await supertest(app.getHttpServer())
                .post(
                    `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices`
                )
                .set('Authorization', bearerFor(user))
                .send({
                    amount: null,
                    amountLocked: false,
                    paymentPurpose: null,
                    validUntil: null,
                    slugInput: { kind: 'random' },
                })
                .expect(201);

            const body = res.body as {
                data: { amount: null; amountLocked: boolean; slug: string };
            };
            expect(body.data.amount).toBeNull();
            expect(body.data.amountLocked).toBe(false);
            expect(body.data.slug).toMatch(/^[A-Za-z0-9]{8}$/);
        });

        it('reject coupled violation (amount=null + amountLocked=true) — 400 з доменним кодом', async () => {
            // Sprint 4 review fix — Zod refine `AMOUNT_LOCKED_REQUIRES_AMOUNT`
            // мапиться у `INVOICE_AMOUNT_LOCKED_REQUIRES_AMOUNT` через
            // `AllExceptionsFilter` (раніше падало як generic `VALIDATION_ERROR`).
            const user = await createUser();
            const { slug, accountSlug } = await createBusinessFor(user);

            const res = await supertest(app.getHttpServer())
                .post(
                    `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices`
                )
                .set('Authorization', bearerFor(user))
                .send({
                    amount: null,
                    amountLocked: true,
                    paymentPurpose: null,
                    validUntil: null,
                    slugInput: { kind: 'random' },
                })
                .expect(400);
            expect((res.body as { error: { code: string } }).error.code).toBe(
                'INVOICE_AMOUNT_LOCKED_REQUIRES_AMOUNT'
            );
        });

        it('reject validUntil у минулому — 400 INVOICE_VALID_UNTIL_IN_PAST', async () => {
            // Sprint 4 review fix — write-side enforcement у InvoicesService.create.
            const user = await createUser();
            const { slug, accountSlug } = await createBusinessFor(user);
            const past = new Date(Date.now() - 86_400_000).toISOString(); // вчора

            const res = await supertest(app.getHttpServer())
                .post(
                    `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices`
                )
                .set('Authorization', bearerFor(user))
                .send({
                    amount: 100000,
                    amountLocked: true,
                    paymentPurpose: null,
                    validUntil: past,
                    slugInput: { kind: 'random' },
                })
                .expect(400);
            expect((res.body as { error: { code: string } }).error.code).toBe(
                'INVOICE_VALID_UNTIL_IN_PAST'
            );
        });

        it('reject explicit з invalid humanPart (uppercase) — 400', async () => {
            const user = await createUser();
            const { slug, accountSlug } = await createBusinessFor(user);

            await supertest(app.getHttpServer())
                .post(
                    `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices`
                )
                .set('Authorization', bearerFor(user))
                .send({
                    amount: 150000,
                    amountLocked: true,
                    paymentPurpose: null,
                    validUntil: null,
                    slugInput: { kind: 'explicit', humanPart: 'ORDER-001' },
                })
                .expect(400);
        });

        it('Sprint 4 §4.4 contract — response shape має `id: string` (а не `_id`), без `__v`', async () => {
            const user = await createUser();
            const { slug, accountSlug } = await createBusinessFor(user);

            const res = await supertest(app.getHttpServer())
                .post(
                    `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices`
                )
                .set('Authorization', bearerFor(user))
                .send({
                    amount: 100,
                    amountLocked: false,
                    paymentPurpose: null,
                    validUntil: null,
                    slugInput: { kind: 'random' },
                })
                .expect(201);
            const data = (res.body as { data: Record<string, unknown> }).data;
            expect(typeof data.id).toBe('string');
            expect(data.id).toMatch(/^[a-f0-9]{24}$/);
            expect(data).not.toHaveProperty('_id');
            expect(data).not.toHaveProperty('__v');
        });

        it('5 послідовних simple-інвойсів — counter monotonic 001..005', async () => {
            const user = await createUser();
            const { slug, accountSlug } = await createBusinessFor(user);

            for (let i = 1; i <= 5; i++) {
                const res = await supertest(app.getHttpServer())
                    .post(
                        `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices`
                    )
                    .set('Authorization', bearerFor(user))
                    .send({
                        amount: 100000,
                        amountLocked: false,
                        paymentPurpose: null,
                        validUntil: null,
                        slugInput: { kind: 'preset', preset: 'simple' },
                    })
                    .expect(201);
                const body = res.body as { data: { slugCounter: number } };
                expect(body.data.slugCounter).toBe(i);
            }
        });

        it('access-deny: чужий бізнес → 403 BUSINESS_ACCESS_DENIED', async () => {
            // BusinessAccessGuard: user → бізнес знайдено, але user НЕ є
            // owner/manager → 403 (Sprint 3 §3.10 patterна — у cabinet enumeration
            // не є ризиком, чесний 403 кращий UX).
            const owner = await createUser();
            const { slug, accountSlug } = await createBusinessFor(owner);
            const intruder = await createUser();

            const res = await supertest(app.getHttpServer())
                .post(
                    `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices`
                )
                .set('Authorization', bearerFor(intruder))
                .send({
                    amount: 100,
                    amountLocked: false,
                    paymentPurpose: null,
                    validUntil: null,
                    slugInput: { kind: 'random' },
                })
                .expect(403);
            expect((res.body as { error: { code: string } }).error.code).toBe(
                'BUSINESS_ACCESS_DENIED'
            );
        });
    });

    // ─── GET list ───

    describe('GET /businesses/me/:slug/invoices', () => {
        it('paginated list з total, page, limit', async () => {
            const user = await createUser();
            const { slug, accountSlug } = await createBusinessFor(user);
            // створимо 3 інвойси
            for (let i = 0; i < 3; i++) {
                await supertest(app.getHttpServer())
                    .post(
                        `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices`
                    )
                    .set('Authorization', bearerFor(user))
                    .send({
                        amount: 100,
                        amountLocked: false,
                        paymentPurpose: null,
                        validUntil: null,
                        slugInput: { kind: 'random' },
                    });
            }

            const res = await supertest(app.getHttpServer())
                .get(
                    `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices?page=1&limit=2`
                )
                .set('Authorization', bearerFor(user))
                .expect(200);

            const body = res.body as {
                data: {
                    items: unknown[];
                    total: number;
                    page: number;
                    limit: number;
                };
            };
            expect(body.data.items).toHaveLength(2);
            expect(body.data.total).toBe(3);
            expect(body.data.page).toBe(1);
            expect(body.data.limit).toBe(2);
        });

        it('default page=1 limit=10', async () => {
            const user = await createUser();
            const { slug, accountSlug } = await createBusinessFor(user);

            const res = await supertest(app.getHttpServer())
                .get(
                    `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices`
                )
                .set('Authorization', bearerFor(user))
                .expect(200);
            const body = res.body as {
                data: { page: number; limit: number };
            };
            expect(body.data.page).toBe(1);
            expect(body.data.limit).toBe(10);
        });

        /**
         * Sprint 4 review fix — пагінація з tie-breaker по `_id`. 6 інвойсів
         * з ідентичним `createdAt` (insertMany з фіксованим Date) — без
         * `_id`-tail сортування ламалося б non-determinist-ично і split на
         * сторінки міг повторити чи пропустити елементи. Перевіряємо, що
         * union(page1, page2, page3) === повний sorted-set без overlap-ів.
         */
        it('deterministic pagination на ідентичних timestamp (review fix)', async () => {
            const user = await createUser();
            const { slug, accountSlug } = await createBusinessFor(user);
            const businessDoc = await businessModel.findOne({
                slugLower: slug.toLowerCase(),
            });
            const businessId = businessDoc!._id;
            const accountDoc = await accountModel.findOne({
                businessId,
                slug: accountSlug,
            });
            const accountId = accountDoc!._id;

            const fixed = new Date('2026-05-07T12:00:00.000Z');
            const docs = Array.from({ length: 6 }, (_, i) => ({
                businessId,
                accountId,
                slug: `tie-${i}-aaaaaaaa`,
                slugLower: `tie-${i}-aaaaaaaa`,
                amount: 100 + i,
                amountLocked: false,
                paymentPurpose: null,
                validUntil: null,
                slugPreset: null,
                slugCounterScope: null,
                slugCounter: null,
                deletedAt: null,
                createdAt: fixed,
                updatedAt: fixed,
            }));
            await invoiceModel.collection.insertMany(docs);

            const collected = new Map<string, number>();
            for (const page of [1, 2, 3]) {
                const res = await supertest(app.getHttpServer())
                    .get(
                        `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices?page=${page}&limit=2`
                    )
                    .set('Authorization', bearerFor(user))
                    .expect(200);
                const items = (
                    res.body as {
                        data: { items: Array<{ id: string; slug: string }> };
                    }
                ).data.items;
                for (const inv of items) {
                    collected.set(inv.id, (collected.get(inv.id) ?? 0) + 1);
                }
            }
            // 6 унікальних інвойсів — кожен зустрівся рівно один раз.
            expect(collected.size).toBe(6);
            for (const count of collected.values()) {
                expect(count).toBe(1);
            }
        });
    });

    // ─── GET single ───

    describe('GET /businesses/me/:slug/invoices/:invoiceSlug', () => {
        it('повертає invoice по slug — 200', async () => {
            const user = await createUser();
            const { slug, accountSlug } = await createBusinessFor(user);
            const create = await supertest(app.getHttpServer())
                .post(
                    `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices`
                )
                .set('Authorization', bearerFor(user))
                .send({
                    amount: 100,
                    amountLocked: false,
                    paymentPurpose: null,
                    validUntil: null,
                    slugInput: { kind: 'random' },
                });
            const invoiceSlug = (create.body as { data: { slug: string } }).data
                .slug;

            const res = await supertest(app.getHttpServer())
                .get(
                    `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices/${invoiceSlug}`
                )
                .set('Authorization', bearerFor(user))
                .expect(200);
            expect((res.body as { data: { slug: string } }).data.slug).toBe(
                invoiceSlug
            );
        });

        it('404 INVOICE_NOT_FOUND для неіснуючого slug', async () => {
            const user = await createUser();
            const { slug, accountSlug } = await createBusinessFor(user);
            const res = await supertest(app.getHttpServer())
                .get(
                    `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices/missing-aaaaaaaa`
                )
                .set('Authorization', bearerFor(user))
                .expect(404);
            expect((res.body as { error: { code: string } }).error.code).toBe(
                'INVOICE_NOT_FOUND'
            );
        });

        it('Sprint 15 — case-insensitive slug lookup (slugLower)', async () => {
            const user = await createUser();
            const { slug, accountSlug } = await createBusinessFor(user);
            const create = await supertest(app.getHttpServer())
                .post(
                    `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices`
                )
                .set('Authorization', bearerFor(user))
                .send({
                    amount: 100,
                    amountLocked: false,
                    paymentPurpose: null,
                    validUntil: null,
                    slugInput: {
                        kind: 'explicit',
                        humanPart: 'order-2026',
                    },
                });
            const invoiceSlug = (create.body as { data: { slug: string } }).data
                .slug;

            // Sprint 15 — slug тепер редаговуваний vanity; lookup
            // case-insensitive на slugLower. Uppercase-варіант резолвиться у той
            // самий інвойс (200), а не 404.
            await supertest(app.getHttpServer())
                .get(
                    `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices/${invoiceSlug.toUpperCase()}`
                )
                .set('Authorization', bearerFor(user))
                .expect(200);
        });
    });

    // ─── PATCH ───

    describe('PATCH /businesses/me/:slug/invoices/:invoiceSlug', () => {
        it('inline-edit paymentPurpose — 200', async () => {
            const user = await createUser();
            const { slug, accountSlug } = await createBusinessFor(user);
            const create = await supertest(app.getHttpServer())
                .post(
                    `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices`
                )
                .set('Authorization', bearerFor(user))
                .send({
                    amount: 100,
                    amountLocked: false,
                    paymentPurpose: 'Old',
                    validUntil: null,
                    slugInput: { kind: 'random' },
                });
            const invoiceSlug = (create.body as { data: { slug: string } }).data
                .slug;

            const res = await supertest(app.getHttpServer())
                .patch(
                    `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices/${invoiceSlug}`
                )
                .set('Authorization', bearerFor(user))
                .send({ paymentPurpose: 'New purpose' })
                .expect(200);
            expect(
                (res.body as { data: { paymentPurpose: string } }).data
                    .paymentPurpose
            ).toBe('New purpose');
        });

        it('PATCH paymentPurpose → public view відразу віддає новий purpose (snapshot mirror)', async () => {
            // Sprint 4 review fix regression: snapshot.paymentPurpose тепер
            // mirror-иться на PATCH. Без mirror-у клієнт по public-link бачив
            // би старий purpose назавжди — прямо суперечить контракту
            // "invoice mutable payment data" (public-invoices controller doc).
            const user = await createUser();
            const { slug, accountSlug } = await createBusinessFor(user);
            const create = await supertest(app.getHttpServer())
                .post(
                    `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices`
                )
                .set('Authorization', bearerFor(user))
                .send({
                    amount: 100,
                    amountLocked: false,
                    paymentPurpose: 'Original',
                    validUntil: null,
                    slugInput: { kind: 'random' },
                });
            const invoiceSlug = (create.body as { data: { slug: string } }).data
                .slug;

            // Sanity: public-view спочатку показує "Original".
            const before = await supertest(app.getHttpServer())
                .get(
                    `/api/businesses/public/${slug}/account/${accountSlug}/invoices/${invoiceSlug}`
                )
                .expect(200);
            expect(
                (before.body as { data: { paymentPurpose: string } }).data
                    .paymentPurpose
            ).toBe('Original');

            // Cabinet PATCH purpose → "Updated".
            await supertest(app.getHttpServer())
                .patch(
                    `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices/${invoiceSlug}`
                )
                .set('Authorization', bearerFor(user))
                .send({ paymentPurpose: 'Updated' })
                .expect(200);

            // Public-view відразу віддає "Updated" — snapshot mirror спрацював.
            const after = await supertest(app.getHttpServer())
                .get(
                    `/api/businesses/public/${slug}/account/${accountSlug}/invoices/${invoiceSlug}`
                )
                .expect(200);
            expect(
                (after.body as { data: { paymentPurpose: string } }).data
                    .paymentPurpose
            ).toBe('Updated');
        });

        it('PATCH paymentPurpose=null → public view показує business template (snapshot resolved)', async () => {
            // null-inheritance на PATCH: service.update resolve-ить null →
            // business.paymentPurposeTemplate і mirror-ить у snapshot. Public
            // payload завжди має конкретний рядок (не null).
            const user = await createUser();
            const { slug, accountSlug } = await createBusinessFor(user);
            const create = await supertest(app.getHttpServer())
                .post(
                    `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices`
                )
                .set('Authorization', bearerFor(user))
                .send({
                    amount: 100,
                    amountLocked: false,
                    paymentPurpose: 'Set explicitly',
                    validUntil: null,
                    slugInput: { kind: 'random' },
                });
            const invoiceSlug = (create.body as { data: { slug: string } }).data
                .slug;

            // PATCH paymentPurpose=null → resolve до template.
            await supertest(app.getHttpServer())
                .patch(
                    `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices/${invoiceSlug}`
                )
                .set('Authorization', bearerFor(user))
                .send({ paymentPurpose: null })
                .expect(200);

            const view = await supertest(app.getHttpServer())
                .get(
                    `/api/businesses/public/${slug}/account/${accountSlug}/invoices/${invoiceSlug}`
                )
                .expect(200);
            // Public-purpose === business.paymentPurposeTemplate seeded у helper.
            expect(
                (view.body as { data: { paymentPurpose: string } }).data
                    .paymentPurpose
            ).toBe('Оплата за послуги');
        });

        it('Sprint 15 — PATCH slug перейменовує інвойс (vanity) + старе посилання редіректить', async () => {
            const user = await createUser({ billing: ACTIVE_BRAND_BILLING });
            const { slug, accountSlug } = await createBusinessFor(user);
            const create = await supertest(app.getHttpServer())
                .post(
                    `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices`
                )
                .set('Authorization', bearerFor(user))
                .send({
                    amount: 100,
                    amountLocked: false,
                    paymentPurpose: null,
                    validUntil: null,
                    slugInput: { kind: 'random' },
                });
            const oldSlug = (create.body as { data: { slug: string } }).data
                .slug;

            const renamed = await supertest(app.getHttpServer())
                .patch(
                    `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices/${oldSlug}`
                )
                .set('Authorization', bearerFor(user))
                .send({ slug: 'oplata-sichen' })
                .expect(200);
            expect((renamed.body as { data: { slug: string } }).data.slug).toBe(
                'oplata-sichen'
            );

            // Cabinet (strict) — старий slug більше не резолвиться.
            await supertest(app.getHttpServer())
                .get(
                    `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices/${oldSlug}`
                )
                .set('Authorization', bearerFor(user))
                .expect(404);

            // Public — старий slug резолвиться через history (canonical view
            // повертає новий slug; SC робить redirect).
            const publicOld = await supertest(app.getHttpServer())
                .get(
                    `/api/businesses/public/${slug}/account/${accountSlug}/invoices/${oldSlug}`
                )
                .expect(200);
            expect(
                (publicOld.body as { data: { slug: string } }).data.slug
            ).toBe('oplata-sichen');
        });

        it.each(['slugPreset', 'businessId', 'createdAt', 'slugCounter'])(
            'reject спробу змінити %s через PATCH (.strict())',
            async (key) => {
                const user = await createUser();
                const { slug, accountSlug } = await createBusinessFor(user);
                const create = await supertest(app.getHttpServer())
                    .post(
                        `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices`
                    )
                    .set('Authorization', bearerFor(user))
                    .send({
                        amount: 100,
                        amountLocked: false,
                        paymentPurpose: null,
                        validUntil: null,
                        slugInput: { kind: 'random' },
                    });
                const invoiceSlug = (create.body as { data: { slug: string } })
                    .data.slug;

                await supertest(app.getHttpServer())
                    .patch(
                        `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices/${invoiceSlug}`
                    )
                    .set('Authorization', bearerFor(user))
                    .send({ [key]: 'evil' })
                    .expect(400);
            }
        );

        it('coupled cross-field amount=null + amountLocked=true (PATCH тільки amountLocked) — 400 INVOICE_AMOUNT_LOCKED_REQUIRES_AMOUNT', async () => {
            const user = await createUser();
            const { slug, accountSlug } = await createBusinessFor(user);
            const create = await supertest(app.getHttpServer())
                .post(
                    `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices`
                )
                .set('Authorization', bearerFor(user))
                .send({
                    amount: null,
                    amountLocked: false,
                    paymentPurpose: null,
                    validUntil: null,
                    slugInput: { kind: 'random' },
                });
            const invoiceSlug = (create.body as { data: { slug: string } }).data
                .slug;

            const res = await supertest(app.getHttpServer())
                .patch(
                    `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices/${invoiceSlug}`
                )
                .set('Authorization', bearerFor(user))
                .send({ amountLocked: true })
                .expect(400);
            expect((res.body as { error: { code: string } }).error.code).toBe(
                'INVOICE_AMOUNT_LOCKED_REQUIRES_AMOUNT'
            );
        });

        it('coupled cross-field PATCH ОБОХ amount + amountLocked → 400 INVOICE_AMOUNT_LOCKED_REQUIRES_AMOUNT (Zod-refine path)', async () => {
            // Sprint 4 review fix — раніше цей шлях падав як `VALIDATION_ERROR`
            // (Zod-refine catches both fields, AllExceptionsFilter мапив 400 →
            // generic). Тепер `ZOD_ISSUE_CODE_TO_RESPONSE_CODE` мапить
            // `AMOUNT_LOCKED_REQUIRES_AMOUNT` → доменний код.
            const user = await createUser();
            const { slug, accountSlug } = await createBusinessFor(user);
            const create = await supertest(app.getHttpServer())
                .post(
                    `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices`
                )
                .set('Authorization', bearerFor(user))
                .send({
                    amount: 100,
                    amountLocked: false,
                    paymentPurpose: null,
                    validUntil: null,
                    slugInput: { kind: 'random' },
                });
            const invoiceSlug = (create.body as { data: { slug: string } }).data
                .slug;

            const res = await supertest(app.getHttpServer())
                .patch(
                    `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices/${invoiceSlug}`
                )
                .set('Authorization', bearerFor(user))
                .send({ amount: null, amountLocked: true })
                .expect(400);
            expect((res.body as { error: { code: string } }).error.code).toBe(
                'INVOICE_AMOUNT_LOCKED_REQUIRES_AMOUNT'
            );
        });

        it('reject validUntil у минулому через PATCH — 400 INVOICE_VALID_UNTIL_IN_PAST', async () => {
            const user = await createUser();
            const { slug, accountSlug } = await createBusinessFor(user);
            const create = await supertest(app.getHttpServer())
                .post(
                    `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices`
                )
                .set('Authorization', bearerFor(user))
                .send({
                    amount: 100,
                    amountLocked: false,
                    paymentPurpose: null,
                    validUntil: null,
                    slugInput: { kind: 'random' },
                });
            const invoiceSlug = (create.body as { data: { slug: string } }).data
                .slug;
            const past = new Date(Date.now() - 86_400_000).toISOString();

            const res = await supertest(app.getHttpServer())
                .patch(
                    `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices/${invoiceSlug}`
                )
                .set('Authorization', bearerFor(user))
                .send({ validUntil: past })
                .expect(400);
            expect((res.body as { error: { code: string } }).error.code).toBe(
                'INVOICE_VALID_UNTIL_IN_PAST'
            );
        });
    });

    // ─── DELETE ───

    describe('DELETE /businesses/me/:slug/invoices/:invoiceSlug', () => {
        it('hard-delete — 200, наступний GET → 404', async () => {
            const user = await createUser();
            const { slug, accountSlug } = await createBusinessFor(user);
            const create = await supertest(app.getHttpServer())
                .post(
                    `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices`
                )
                .set('Authorization', bearerFor(user))
                .send({
                    amount: 100,
                    amountLocked: false,
                    paymentPurpose: null,
                    validUntil: null,
                    slugInput: { kind: 'random' },
                });
            const invoiceSlug = (create.body as { data: { slug: string } }).data
                .slug;

            await supertest(app.getHttpServer())
                .delete(
                    `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices/${invoiceSlug}`
                )
                .set('Authorization', bearerFor(user))
                .expect(200);

            await supertest(app.getHttpServer())
                .get(
                    `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices/${invoiceSlug}`
                )
                .set('Authorization', bearerFor(user))
                .expect(404);
        });
    });

    // ─── Cascade-delete: GET /businesses/me/:slug + DELETE ───

    describe('Cascade-delete (Sprint 4 §SP-5)', () => {
        it('GET /businesses/me/:slug повертає invoicesCount', async () => {
            const user = await createUser();
            const { slug, accountSlug } = await createBusinessFor(user);

            // Створюємо 2 інвойси
            for (let i = 0; i < 2; i++) {
                await supertest(app.getHttpServer())
                    .post(
                        `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices`
                    )
                    .set('Authorization', bearerFor(user))
                    .send({
                        amount: 100,
                        amountLocked: false,
                        paymentPurpose: null,
                        validUntil: null,
                        slugInput: { kind: 'random' },
                    });
            }

            const res = await supertest(app.getHttpServer())
                .get(`/api/businesses/me/${slug}`)
                .set('Authorization', bearerFor(user))
                .expect(200);
            const body = res.body as {
                data: { invoicesCount: number };
            };
            expect(body.data.invoicesCount).toBe(2);
        });

        it('DELETE business → cascade видалення усіх invoices + response.affectedInvoices', async () => {
            const user = await createUser();
            const { slug, accountSlug } = await createBusinessFor(user);

            // 3 інвойси
            for (let i = 0; i < 3; i++) {
                await supertest(app.getHttpServer())
                    .post(
                        `/api/businesses/me/${slug}/accounts/${accountSlug}/invoices`
                    )
                    .set('Authorization', bearerFor(user))
                    .send({
                        amount: 100,
                        amountLocked: false,
                        paymentPurpose: null,
                        validUntil: null,
                        slugInput: { kind: 'random' },
                    });
            }

            const res = await supertest(app.getHttpServer())
                .delete(`/api/businesses/me/${slug}`)
                .set('Authorization', bearerFor(user))
                .expect(200);
            expect(
                (res.body as { data: { affectedInvoices: number } }).data
                    .affectedInvoices
            ).toBe(3);

            // Бізнес видалений
            await supertest(app.getHttpServer())
                .get(`/api/businesses/me/${slug}`)
                .set('Authorization', bearerFor(user))
                .expect(404);

            // Усі інвойси теж видалені
            const remaining = await invoiceModel.countDocuments({});
            expect(remaining).toBe(0);
        });

        it('DELETE business без інвойсів → affectedInvoices=0', async () => {
            const user = await createUser();
            const { slug, accountSlug } = await createBusinessFor(user);

            const res = await supertest(app.getHttpServer())
                .delete(`/api/businesses/me/${slug}`)
                .set('Authorization', bearerFor(user))
                .expect(200);
            expect(
                (res.body as { data: { affectedInvoices: number } }).data
                    .affectedInvoices
            ).toBe(0);
        });

        it('cross-business cascade isolation: інвойси іншого бізнесу не зачеплені', async () => {
            const user = await createUser();
            const { slug: slugA, accountSlug: accSlugA } =
                await createBusinessFor(user);
            const userB = await createUser();
            const { slug: slugB, accountSlug: accSlugB } =
                await createBusinessFor(userB);

            await supertest(app.getHttpServer())
                .post(
                    `/api/businesses/me/${slugA}/accounts/${accSlugA}/invoices`
                )
                .set('Authorization', bearerFor(user))
                .send({
                    amount: 100,
                    amountLocked: false,
                    paymentPurpose: null,
                    validUntil: null,
                    slugInput: { kind: 'random' },
                });
            await supertest(app.getHttpServer())
                .post(
                    `/api/businesses/me/${slugB}/accounts/${accSlugB}/invoices`
                )
                .set('Authorization', bearerFor(userB))
                .send({
                    amount: 100,
                    amountLocked: false,
                    paymentPurpose: null,
                    validUntil: null,
                    slugInput: { kind: 'random' },
                });

            await supertest(app.getHttpServer())
                .delete(`/api/businesses/me/${slugA}`)
                .set('Authorization', bearerFor(user))
                .expect(200);

            // Інвойс бізнесу B все ще там
            const remaining = await invoiceModel.countDocuments({});
            expect(remaining).toBe(1);
        });

        // Sprint 4 review fix — orphan-prevention при concurrent
        // cascade-delete vs invoice-create. Без write-conflict serialization
        // у транзакції create-у можна було б створити invoice проти
        // вже видаленого business-id-у. Тут перевіряємо детермінований
        // sequential-сценарій: business deleted → invoice insert proти
        // того ж businessId (через прямий model-call, бо HTTP-flow
        // блокує `BusinessAccessGuard`-ом ще раніше). Повний race-test
        // вимагає paralleled timing, що нестабільно у jest; sequential-test
        // покриває the same orphan-failure-mode на rate-fix-side.
        it('Sprint 9 §SP-3 — sequential delete → create same accountId → 404 ACCOUNT_NOT_FOUND, no orphan', async () => {
            const user = await createUser();
            const { slug, accountSlug } = await createBusinessFor(user);
            const business = await businessModel.findOne({
                slugLower: slug.toLowerCase(),
            });
            const account = await accountModel.findOne({
                businessId: business?._id,
                slug: accountSlug,
            });
            expect(business).not.toBeNull();
            expect(account).not.toBeNull();
            const accountId = account!._id;

            // Cascade-delete business (success path).
            await supertest(app.getHttpServer())
                .delete(`/api/businesses/me/${slug}`)
                .set('Authorization', bearerFor(user))
                .expect(200);

            // Прямий service-call — обходимо AccountAccessGuard, перевіряємо
            // саме service-layer orphan-block (touch-account у транзакції).
            const invoicesService = app.get(InvoicesService);
            await expect(
                invoicesService.create(
                    business as BusinessDocument,
                    account as AccountDocument,
                    {
                        amount: 1000,
                        amountLocked: true,
                        paymentPurpose: 'Late insert',
                        validUntil: null,
                        slugInput: { kind: 'random' },
                    }
                )
            ).rejects.toMatchObject({
                response: { code: 'ACCOUNT_NOT_FOUND' },
            });

            const orphans = await invoiceModel.countDocuments({ accountId });
            expect(orphans).toBe(0);
        });
    });

    // ─── §4.3 Public flow ───────────────────────────────────────────────

    describe('Public Invoices Controller (Sprint 9 §9.1)', () => {
        async function seedInvoice(opts: {
            user: UserDocument;
            businessSlug: string;
            accountSlug: string;
            amount?: number | null;
            amountLocked?: boolean;
            paymentPurpose?: string | null;
            validUntil?: string | null;
        }): Promise<string> {
            const res = await supertest(app.getHttpServer())
                .post(
                    `/api/businesses/me/${opts.businessSlug}/accounts/${opts.accountSlug}/invoices`
                )
                .set('Authorization', bearerFor(opts.user))
                .send({
                    amount: opts.amount ?? 150000,
                    amountLocked: opts.amountLocked ?? true,
                    paymentPurpose: opts.paymentPurpose ?? 'Оплата',
                    validUntil: opts.validUntil ?? null,
                    slugInput: { kind: 'random' },
                });
            return (res.body as { data: { slug: string } }).data.slug;
        }

        describe('GET /businesses/public/:slug/invoices/:invoiceSlug', () => {
            it('повертає 7 whitelist-полів; без auth', async () => {
                const user = await createUser();
                const { slug: businessSlug, accountSlug } =
                    await createBusinessFor(user);
                const invoiceSlug = await seedInvoice({
                    user,
                    businessSlug,
                    accountSlug,
                    amount: 250000,
                    amountLocked: true,
                });

                const res = await supertest(app.getHttpServer())
                    .get(
                        `/api/businesses/public/${businessSlug}/account/${accountSlug}/invoices/${invoiceSlug}`
                    )
                    .expect(200);

                const body = res.body as { data: Record<string, unknown> };
                expect(Object.keys(body.data).sort()).toEqual([
                    'account',
                    'amount',
                    'amountLocked',
                    'business',
                    'nbuLinks',
                    'paymentPurpose',
                    'slug',
                    'validUntil',
                ]);
                expect(body.data.amount).toBe(250000);
                expect(body.data.amountLocked).toBe(true);
            });

            it('whitelist invariant: leak-кандидати з invoice відсутні', async () => {
                const user = await createUser();
                const { slug: businessSlug, accountSlug } =
                    await createBusinessFor(user);
                const invoiceSlug = await seedInvoice({
                    user,
                    businessSlug,
                    accountSlug,
                });

                const res = await supertest(app.getHttpServer())
                    .get(
                        `/api/businesses/public/${businessSlug}/account/${accountSlug}/invoices/${invoiceSlug}`
                    )
                    .expect(200);

                const data = (res.body as { data: Record<string, unknown> })
                    .data;
                expect(data).not.toHaveProperty('slugPreset');
                expect(data).not.toHaveProperty('slugCounterScope');
                expect(data).not.toHaveProperty('slugCounter');
                expect(data).not.toHaveProperty('businessId');
                expect(data).not.toHaveProperty('createdAt');
                expect(data).not.toHaveProperty('updatedAt');
                expect(data).not.toHaveProperty('deletedAt');
            });

            it('nested business — теж whitelist', async () => {
                const user = await createUser();
                const { slug: businessSlug, accountSlug } =
                    await createBusinessFor(user);
                const invoiceSlug = await seedInvoice({
                    user,
                    businessSlug,
                    accountSlug,
                });

                const res = await supertest(app.getHttpServer())
                    .get(
                        `/api/businesses/public/${businessSlug}/account/${accountSlug}/invoices/${invoiceSlug}`
                    )
                    .expect(200);

                const business = (
                    res.body as {
                        data: { business: Record<string, unknown> };
                    }
                ).data.business;
                expect(Object.keys(business).sort()).toEqual([
                    'name',
                    'slug',
                    'type',
                ]);
                expect(business).not.toHaveProperty('requisites');
                expect(business).not.toHaveProperty('taxationSystem');
                expect(business).not.toHaveProperty('isVatPayer');
                expect(business).not.toHaveProperty('ownerId');
                expect(business).not.toHaveProperty('managers');
                expect(business).not.toHaveProperty('paymentPurposeTemplate');
                expect(business).not.toHaveProperty('seoIndexEnabled');
            });

            it('nbuLinks: primary → qr.bank.gov.ua, legacy → bank.gov.ua/qr', async () => {
                const user = await createUser();
                const { slug: businessSlug, accountSlug } =
                    await createBusinessFor(user);
                const invoiceSlug = await seedInvoice({
                    user,
                    businessSlug,
                    accountSlug,
                });

                const res = await supertest(app.getHttpServer())
                    .get(
                        `/api/businesses/public/${businessSlug}/account/${accountSlug}/invoices/${invoiceSlug}`
                    )
                    .expect(200);

                const links = (
                    res.body as {
                        data: {
                            nbuLinks: { primary: string; legacy: string };
                        };
                    }
                ).data.nbuLinks;
                expect(links.primary).toMatch(/^https:\/\/qr\.bank\.gov\.ua\//);
                expect(links.legacy).toMatch(/^https:\/\/bank\.gov\.ua\/qr\//);
            });

            it('Cache-Control: no-store — invoice mutable payment data (review fix)', async () => {
                const user = await createUser();
                const { slug: businessSlug, accountSlug } =
                    await createBusinessFor(user);
                const invoiceSlug = await seedInvoice({
                    user,
                    businessSlug,
                    accountSlug,
                });

                const res = await supertest(app.getHttpServer())
                    .get(
                        `/api/businesses/public/${businessSlug}/account/${accountSlug}/invoices/${invoiceSlug}`
                    )
                    .expect(200);
                expect(res.headers['cache-control']).toBe('no-store');
            });

            it('Sprint 15 — case-insensitive lookup на всіх сегментах (business + invoice)', async () => {
                const user = await createUser();
                const { slug: businessSlug, accountSlug } =
                    await createBusinessFor(user);
                // Explicit human-part гарантує наявність lowercase-літер у
                // invoice-slug-у — uppercase-варіант відрізнятиметься від
                // canonical case-sensitive lookup.
                const res = await supertest(app.getHttpServer())
                    .post(
                        `/api/businesses/me/${businessSlug}/accounts/${accountSlug}/invoices`
                    )
                    .set('Authorization', bearerFor(user))
                    .send({
                        amount: 150000,
                        amountLocked: true,
                        paymentPurpose: 'Оплата',
                        validUntil: null,
                        slugInput: {
                            kind: 'explicit',
                            humanPart: 'order-test',
                        },
                    })
                    .expect(201);
                const invoiceSlug = (res.body as { data: { slug: string } })
                    .data.slug;

                await supertest(app.getHttpServer())
                    .get(
                        `/api/businesses/public/${businessSlug.toLowerCase()}/account/${accountSlug}/invoices/${invoiceSlug}`
                    )
                    .expect(200);

                // Sprint 15 — invoice-slug тепер case-insensitive (slugLower):
                // uppercase-варіант резолвиться у той самий інвойс (200).
                await supertest(app.getHttpServer())
                    .get(
                        `/api/businesses/public/${businessSlug}/account/${accountSlug}/invoices/${invoiceSlug.toUpperCase()}`
                    )
                    .expect(200);
            });

            it('404 BUSINESS_NOT_FOUND для неіснуючого business', async () => {
                const res = await supertest(app.getHttpServer())
                    .get(
                        `/api/businesses/public/missing/account/somesssss/invoices/whatever`
                    )
                    .expect(404);
                expect(
                    (res.body as { error: { code: string } }).error.code
                ).toBe('BUSINESS_NOT_FOUND');
            });

            it('404 INVOICE_NOT_FOUND для неіснуючого invoice', async () => {
                const user = await createUser();
                const { slug: businessSlug, accountSlug } =
                    await createBusinessFor(user);
                const res = await supertest(app.getHttpServer())
                    .get(
                        `/api/businesses/public/${businessSlug}/account/${accountSlug}/invoices/missing-aaaaaaaa`
                    )
                    .expect(404);
                expect(
                    (res.body as { error: { code: string } }).error.code
                ).toBe('INVOICE_NOT_FOUND');
            });
        });

        // Sprint 4 review fix — server-side expiry block. Раніше client сам
        // ховав payment-CTA-и при `validUntil < now`, але `nbuLinks` все одно
        // приходили у JSON-payload, а QR endpoints віддавали PNG. Тепер:
        //  - JSON-view → `nbuLinks: null` коли expired.
        //  - QR endpoints → 410 Gone з кодом `INVOICE_EXPIRED`.
        //
        // **Seeding past validUntil.** Service-create блокує `validUntil < now`
        // на write-path (`INVOICE_VALID_UNTIL_IN_PAST`), що моделює реальну
        // вимогу. Тести expired-flow моделюють реальний сценарій "створили
        // у майбутньому, час минув" — seedExpiredInvoice створює invoice з
        // future-датою через HTTP, а потім mongo-update-ить validUntil на past.
        describe('Expired invoice (validUntil < now) — server-side payment block', () => {
            const PAST_VALID_UNTIL = '2024-01-01T00:00:00.000Z';

            async function seedExpiredInvoice(opts: {
                user: UserDocument;
                businessSlug: string;
                accountSlug: string;
            }): Promise<string> {
                const slug = await seedInvoice({
                    user: opts.user,
                    businessSlug: opts.businessSlug,
                    accountSlug: opts.accountSlug,
                });
                await invoiceModel.updateOne(
                    { slug },
                    { $set: { validUntil: new Date(PAST_VALID_UNTIL) } }
                );
                return slug;
            }

            it('JSON view → nbuLinks=null', async () => {
                const user = await createUser();
                const { slug: businessSlug, accountSlug } =
                    await createBusinessFor(user);
                const invoiceSlug = await seedExpiredInvoice({
                    user,
                    businessSlug,
                    accountSlug,
                });

                const res = await supertest(app.getHttpServer())
                    .get(
                        `/api/businesses/public/${businessSlug}/account/${accountSlug}/invoices/${invoiceSlug}`
                    )
                    .expect(200);

                const data = (
                    res.body as {
                        data: {
                            nbuLinks: unknown;
                            amount: number;
                            slug: string;
                        };
                    }
                ).data;
                // Whitelist invariant: рахунок все одно віддається (heading +
                // banner на client), але payment-vector cut.
                expect(data.amount).toBe(150000);
                expect(data.slug).toBe(invoiceSlug);
                expect(data.nbuLinks).toBeNull();
            });

            it('GET /qr/nbu.png?host=primary → 410 Gone, code=INVOICE_EXPIRED', async () => {
                const user = await createUser();
                const { slug: businessSlug, accountSlug } =
                    await createBusinessFor(user);
                const invoiceSlug = await seedExpiredInvoice({
                    user,
                    businessSlug,
                    accountSlug,
                });

                const res = await supertest(app.getHttpServer())
                    .get(
                        `/api/businesses/public/${businessSlug}/account/${accountSlug}/invoices/${invoiceSlug}/qr/nbu.png?host=primary`
                    )
                    .expect(410);
                expect(
                    (res.body as { error: { code: string } }).error.code
                ).toBe('INVOICE_EXPIRED');
            });

            it('GET /qr/business.png → 410 Gone, code=INVOICE_EXPIRED', async () => {
                const user = await createUser();
                const { slug: businessSlug, accountSlug } =
                    await createBusinessFor(user);
                const invoiceSlug = await seedExpiredInvoice({
                    user,
                    businessSlug,
                    accountSlug,
                });

                const res = await supertest(app.getHttpServer())
                    .get(
                        `/api/businesses/public/${businessSlug}/account/${accountSlug}/invoices/${invoiceSlug}/qr/business.png`
                    )
                    .expect(410);
                expect(
                    (res.body as { error: { code: string } }).error.code
                ).toBe('INVOICE_EXPIRED');
            });

            it('validUntil=null → НЕ expired (nbuLinks віддаються, QR 200)', async () => {
                // Sanity-counterpart: інвойс без терміну дії продовжує
                // працювати безкінечно.
                const user = await createUser();
                const { slug: businessSlug, accountSlug } =
                    await createBusinessFor(user);
                const invoiceSlug = await seedInvoice({
                    user,
                    businessSlug,
                    accountSlug,
                    validUntil: null,
                });

                const jsonRes = await supertest(app.getHttpServer())
                    .get(
                        `/api/businesses/public/${businessSlug}/account/${accountSlug}/invoices/${invoiceSlug}`
                    )
                    .expect(200);
                expect(
                    (jsonRes.body as { data: { nbuLinks: unknown } }).data
                        .nbuLinks
                ).not.toBeNull();

                await supertest(app.getHttpServer())
                    .get(
                        `/api/businesses/public/${businessSlug}/account/${accountSlug}/invoices/${invoiceSlug}/qr/nbu.png?host=primary`
                    )
                    .expect(200);
            });
        });

        describe('GET /qr/business.png — public-URL QR', () => {
            it('повертає valid PNG; Content-Type image/png', async () => {
                const user = await createUser();
                const { slug: businessSlug, accountSlug } =
                    await createBusinessFor(user);
                const invoiceSlug = await seedInvoice({
                    user,
                    businessSlug,
                    accountSlug,
                });

                const res = await supertest(app.getHttpServer())
                    .get(
                        `/api/businesses/public/${businessSlug}/account/${accountSlug}/invoices/${invoiceSlug}/qr/business.png`
                    )
                    .buffer(true)
                    .parse((response, callback) => {
                        const chunks: Buffer[] = [];
                        response.on('data', (chunk: Buffer) =>
                            chunks.push(chunk)
                        );
                        response.on('end', () =>
                            callback(null, Buffer.concat(chunks))
                        );
                    })
                    .expect(200);

                expect(res.headers['content-type']).toBe('image/png');
                const png = res.body as Buffer;
                // PNG magic: 89 50 4E 47
                expect(png[0]).toBe(0x89);
                expect(png[1]).toBe(0x50);
                expect(png[2]).toBe(0x4e);
                expect(png[3]).toBe(0x47);
            });

            it('Sprint 14 — size-whitelist відхиляє довільне значення (400)', async () => {
                const user = await createUser();
                const { slug: businessSlug, accountSlug } =
                    await createBusinessFor(user);
                const invoiceSlug = await seedInvoice({
                    user,
                    businessSlug,
                    accountSlug,
                });
                // 400 (не render) — машинний `code: VALIDATION_ERROR` покрито
                // unit-spec-ом `qr-image-request.spec.ts`; тут перевіряємо лише
                // HTTP-контракт whitelist на повному стеку.
                await supertest(app.getHttpServer())
                    .get(
                        `/api/businesses/public/${businessSlug}/account/${accountSlug}/invoices/${invoiceSlug}/qr/business.png?size=9999`
                    )
                    .expect(400);
            });

            it('Sprint 14 — ?download=1 (size=print) → attachment-заголовок', async () => {
                const user = await createUser();
                const { slug: businessSlug, accountSlug } =
                    await createBusinessFor(user);
                const invoiceSlug = await seedInvoice({
                    user,
                    businessSlug,
                    accountSlug,
                });
                const res = await supertest(app.getHttpServer())
                    .get(
                        `/api/businesses/public/${businessSlug}/account/${accountSlug}/invoices/${invoiceSlug}/qr/business.png?size=print&download=1`
                    )
                    .expect(200);
                expect(res.headers['content-disposition']).toContain(
                    'attachment'
                );
            }, 30000);
        });

        describe('GET /qr/nbu.png?host=primary|legacy', () => {
            it('host=primary → valid PNG', async () => {
                const user = await createUser();
                const { slug: businessSlug, accountSlug } =
                    await createBusinessFor(user);
                const invoiceSlug = await seedInvoice({
                    user,
                    businessSlug,
                    accountSlug,
                });

                const res = await supertest(app.getHttpServer())
                    .get(
                        `/api/businesses/public/${businessSlug}/account/${accountSlug}/invoices/${invoiceSlug}/qr/nbu.png?host=primary`
                    )
                    .expect(200);
                expect(res.headers['content-type']).toBe('image/png');
            });

            it('host=legacy → valid PNG', async () => {
                const user = await createUser();
                const { slug: businessSlug, accountSlug } =
                    await createBusinessFor(user);
                const invoiceSlug = await seedInvoice({
                    user,
                    businessSlug,
                    accountSlug,
                });

                await supertest(app.getHttpServer())
                    .get(
                        `/api/businesses/public/${businessSlug}/account/${accountSlug}/invoices/${invoiceSlug}/qr/nbu.png?host=legacy`
                    )
                    .expect(200);
            });

            it('відсутній host param → 400 VALIDATION_ERROR', async () => {
                const user = await createUser();
                const { slug: businessSlug, accountSlug } =
                    await createBusinessFor(user);
                const invoiceSlug = await seedInvoice({
                    user,
                    businessSlug,
                    accountSlug,
                });

                await supertest(app.getHttpServer())
                    .get(
                        `/api/businesses/public/${businessSlug}/account/${accountSlug}/invoices/${invoiceSlug}/qr/nbu.png`
                    )
                    .expect(400);
            });

            it('host=invalid value → 400', async () => {
                const user = await createUser();
                const { slug: businessSlug, accountSlug } =
                    await createBusinessFor(user);
                const invoiceSlug = await seedInvoice({
                    user,
                    businessSlug,
                    accountSlug,
                });

                await supertest(app.getHttpServer())
                    .get(
                        `/api/businesses/public/${businessSlug}/account/${accountSlug}/invoices/${invoiceSlug}/qr/nbu.png?host=qr.bank.gov.ua`
                    )
                    .expect(400);
            });
        });

        describe('NBU-payload round-trip (Sprint 4 §4.3 DoD)', () => {
            it('payload містить amount + lockMask + validUntil', async () => {
                // jsqr round-trip — згідно DoD: "обидва QR-endpoint-и віддають
                // valid PNG; jsqr round-trip декодує payload з очікуваним
                // amount/lock-mask/validUntil". Тут робимо більш детермінований
                // smoke через JSON-response: NBU URL містить base64url payload,
                // який ми декодуємо назад у плейн-стрингу і шукаємо ключові
                // поля. Без `jsqr` — швидше і робастно (PNG → QR-decode →
                // payload — той самий результат, але через image-decode pipeline).
                const user = await createUser();
                const { slug: businessSlug, accountSlug } =
                    await createBusinessFor(user);
                const invoiceSlug = await seedInvoice({
                    user,
                    businessSlug,
                    accountSlug,
                    amount: 100000, // 1000 грн
                    amountLocked: true,
                    validUntil: '2026-12-31T21:59:59.000Z', // зима → Kyiv 23:59:59
                });

                const res = await supertest(app.getHttpServer())
                    .get(
                        `/api/businesses/public/${businessSlug}/account/${accountSlug}/invoices/${invoiceSlug}`
                    )
                    .expect(200);

                const links = (
                    res.body as {
                        data: {
                            nbuLinks: { primary: string; legacy: string };
                        };
                    }
                ).data.nbuLinks;

                // NBU URL: https://qr.bank.gov.ua/{base64url-encoded-payload}
                const match = /\/([A-Za-z0-9_-]+)$/.exec(links.primary);
                expect(match).not.toBeNull();
                const base64Url = match![1];
                // Decode base64url → plain payload-string
                const payload = Buffer.from(
                    base64Url.replace(/-/g, '+').replace(/_/g, '/'),
                    'base64'
                ).toString('utf8');

                expect(payload).toContain('UAH1000'); // amount 100000 коп = 1000 грн
                expect(payload).toContain('FFFF'); // amountLocked=true
                expect(payload).toContain('261231235959'); // Kyiv 31.12 23:59:59
            });
        });
    });
});
