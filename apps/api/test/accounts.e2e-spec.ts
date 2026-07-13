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
import { CURRENT_TERMS_VERSION } from '@finly/types';

import { createReplSetMongo } from '../src/test-utils/mongo';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { REDIS_CLIENT } from '../src/common/modules/redis.module';
import { RedisCounterService } from '../src/common/services/redis-counter.service';
import { RedisLockService } from '../src/common/services/redis-lock.service';
// Import order matters: AuthModule ↔ UsersModule ↔ StorageModule —
// pre-existing JS-cycle (`CLAUDE.md` Known Complexities). AuthModule першим:
// повністю eval-ить циклічну трійку перед business/account-graph.
import { AuthModule } from '../src/modules/auth/auth.module';
import { EmailModule } from '../src/modules/email/email.module';
import { EmailService } from '../src/modules/email/email.service';
import { StorageModule } from '../src/modules/storage/storage.module';
import { UsersModule } from '../src/modules/users/users.module';
import { User, UserDocument } from '../src/modules/users/schemas/user.schema';
import { AccountsModule } from '../src/modules/accounts/accounts.module';
import { AccountsService } from '../src/modules/accounts/accounts.service';
import {
    Account,
    AccountDocument,
} from '../src/modules/accounts/schemas/account.schema';
import { BusinessesModule } from '../src/modules/businesses/businesses.module';
import { InvoicesModule } from '../src/modules/invoices/invoices.module';
import { QrModule } from '../src/modules/qr/qr.module';
import {
    Business,
    BusinessDocument,
} from '../src/modules/businesses/schemas/business.schema';
import {
    Invoice,
    InvoiceDocument,
} from '../src/modules/invoices/schemas/invoice.schema';

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

describe('Accounts E2E (Sprint 9 §SP-1..§SP-3)', () => {
    let app: INestApplication<App>;
    let mongo: Awaited<ReturnType<typeof createReplSetMongo>>;
    let userModel: Model<UserDocument>;
    let businessModel: Model<BusinessDocument>;
    let accountModel: Model<AccountDocument>;
    let invoiceModel: Model<InvoiceDocument>;
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

        userModel = moduleFixture.get(getModelToken(User.name));
        businessModel = moduleFixture.get(getModelToken(Business.name));
        accountModel = moduleFixture.get(getModelToken(Account.name));
        invoiceModel = moduleFixture.get(getModelToken(Invoice.name));
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

    async function createBusinessFor(user: UserDocument): Promise<string> {
        const res = await supertest(app.getHttpServer())
            .post('/api/businesses/me')
            .set('Authorization', bearerFor(user))
            .send(VALID_BUSINESS_PAYLOAD);
        return (res.body as { data: { slug: string } }).data.slug;
    }

    describe('POST /businesses/me/:slug/accounts', () => {
        it('§SP-1 — створює account без назви → name null (display деривується)', async () => {
            const user = await createUser();
            const businessSlug = await createBusinessFor(user);

            const res = await supertest(app.getHttpServer())
                .post(`/api/businesses/me/${businessSlug}/accounts`)
                .set('Authorization', bearerFor(user))
                .send({ iban: VALID_IBAN })
                .expect(201);

            const data = (
                res.body as {
                    data: {
                        iban: string;
                        bankCode: string | null;
                        name: string | null;
                        slug: string;
                    };
                }
            ).data;
            expect(data.iban).toBe(VALID_IBAN);
            // МФО 322313 — поза `BANK_MFO_MAP` → bankCode null. Назву не
            // передали → name null (не матеріалізуємо авто-рядок).
            expect(data.bankCode).toBeNull();
            expect(data.name).toBeNull();
            expect(data.slug).toMatch(/^[A-Za-z0-9]{8}$/);
        });

        it('§SP-1 — розпізнає МФО у bankCode, name лишається null без override (privatbank 305299)', async () => {
            const user = await createUser();
            const businessSlug = await createBusinessFor(user);
            const ibanWithPrivatMfo = 'UA273052992990004149497786452';

            const res = await supertest(app.getHttpServer())
                .post(`/api/businesses/me/${businessSlug}/accounts`)
                .set('Authorization', bearerFor(user))
                .send({ iban: ibanWithPrivatMfo })
                .expect(201);

            const data = (
                res.body as { data: { bankCode: string; name: string | null } }
            ).data;
            expect(data.bankCode).toBe('privatbank');
            expect(data.name).toBeNull();
        });

        it('§SP-1 — приймає кастомне name override', async () => {
            const user = await createUser();
            const businessSlug = await createBusinessFor(user);

            const res = await supertest(app.getHttpServer())
                .post(`/api/businesses/me/${businessSlug}/accounts`)
                .set('Authorization', bearerFor(user))
                .send({ iban: VALID_IBAN, name: 'Основний рахунок' })
                .expect(201);

            expect((res.body as { data: { name: string } }).data.name).toBe(
                'Основний рахунок'
            );
        });

        it('§SP-2 — duplicate IBAN під тим самим business → 409 ACCOUNT_IBAN_DUPLICATE', async () => {
            const user = await createUser();
            const businessSlug = await createBusinessFor(user);

            await supertest(app.getHttpServer())
                .post(`/api/businesses/me/${businessSlug}/accounts`)
                .set('Authorization', bearerFor(user))
                .send({ iban: VALID_IBAN })
                .expect(201);

            const res = await supertest(app.getHttpServer())
                .post(`/api/businesses/me/${businessSlug}/accounts`)
                .set('Authorization', bearerFor(user))
                .send({ iban: VALID_IBAN })
                .expect(409);
            expect((res.body as { error: { code: string } }).error.code).toBe(
                'ACCOUNT_IBAN_DUPLICATE'
            );
        });

        it('reject invalid IBAN — 400', async () => {
            const user = await createUser();
            const businessSlug = await createBusinessFor(user);

            await supertest(app.getHttpServer())
                .post(`/api/businesses/me/${businessSlug}/accounts`)
                .set('Authorization', bearerFor(user))
                .send({ iban: 'NOT_AN_IBAN' })
                .expect(400);
        });

        it('Sprint 9 §SP-1 — sequential delete-business → create account → 404 BUSINESS_NOT_FOUND (orphan-prevention)', async () => {
            // Той самий patтерн, що Sprint 4 review fix для Invoice→Business:
            // прямий service-call обходить BusinessAccessGuard, перевіряємо
            // service-layer touch-business orphan-block у транзакції.
            const user = await createUser();
            const businessSlug = await createBusinessFor(user);
            const business = await businessModel.findOne({
                slugLower: businessSlug.toLowerCase(),
            });
            expect(business).not.toBeNull();
            const businessId = business!._id;

            // Cascade-delete business (success path).
            await supertest(app.getHttpServer())
                .delete(`/api/businesses/me/${businessSlug}`)
                .set('Authorization', bearerFor(user))
                .expect(200);

            // Прямий service-call з закешованим BusinessDocument — імітує
            // concurrent state, у якому guard ще бачив business, а до touch-
            // фази тут його уже cascade-deleted.
            const accountsService = app.get(AccountsService);
            await expect(
                accountsService.create(business!, { iban: VALID_IBAN })
            ).rejects.toMatchObject({
                response: { code: 'BUSINESS_NOT_FOUND' },
            });

            // Жодного orphan-account на видалений businessId.
            const orphans = await accountModel.countDocuments({ businessId });
            expect(orphans).toBe(0);
        });

        it('access-deny: чужий business → 403 BUSINESS_ACCESS_DENIED', async () => {
            const owner = await createUser();
            const businessSlug = await createBusinessFor(owner);
            const intruder = await createUser();

            const res = await supertest(app.getHttpServer())
                .post(`/api/businesses/me/${businessSlug}/accounts`)
                .set('Authorization', bearerFor(intruder))
                .send({ iban: VALID_IBAN })
                .expect(403);
            expect((res.body as { error: { code: string } }).error.code).toBe(
                'BUSINESS_ACCESS_DENIED'
            );
        });
    });

    describe('GET /businesses/me/:slug/accounts', () => {
        it('list accounts under business — 200 з invoicesCount per item', async () => {
            const user = await createUser();
            const businessSlug = await createBusinessFor(user);
            await supertest(app.getHttpServer())
                .post(`/api/businesses/me/${businessSlug}/accounts`)
                .set('Authorization', bearerFor(user))
                .send({ iban: VALID_IBAN });

            const res = await supertest(app.getHttpServer())
                .get(`/api/businesses/me/${businessSlug}/accounts`)
                .set('Authorization', bearerFor(user))
                .expect(200);

            const data = (
                res.body as {
                    data: Array<{
                        slug: string;
                        iban: string;
                        invoicesCount: number;
                    }>;
                }
            ).data;
            expect(data).toHaveLength(1);
            expect(data[0].iban).toBe(VALID_IBAN);
            expect(data[0].invoicesCount).toBe(0);
        });
    });

    describe('PATCH /businesses/me/:slug/accounts/:accountSlug', () => {
        async function seedAccount(
            user: UserDocument
        ): Promise<{ businessSlug: string; accountSlug: string }> {
            const businessSlug = await createBusinessFor(user);
            const res = await supertest(app.getHttpServer())
                .post(`/api/businesses/me/${businessSlug}/accounts`)
                .set('Authorization', bearerFor(user))
                .send({ iban: VALID_IBAN });
            return {
                businessSlug,
                accountSlug: (res.body as { data: { slug: string } }).data.slug,
            };
        }

        it('§SP-2 — `iban` НЕ в whitelist update → 400 .strict()', async () => {
            const user = await createUser();
            const { businessSlug, accountSlug } = await seedAccount(user);
            await supertest(app.getHttpServer())
                .patch(
                    `/api/businesses/me/${businessSlug}/accounts/${accountSlug}`
                )
                .set('Authorization', bearerFor(user))
                .send({ iban: 'UA213223130000026007233566002' })
                .expect(400);
        });

        it('name editable — 200', async () => {
            const user = await createUser();
            const { businessSlug, accountSlug } = await seedAccount(user);
            const res = await supertest(app.getHttpServer())
                .patch(
                    `/api/businesses/me/${businessSlug}/accounts/${accountSlug}`
                )
                .set('Authorization', bearerFor(user))
                .send({ name: 'Резерв' })
                .expect(200);
            expect((res.body as { data: { name: string } }).data.name).toBe(
                'Резерв'
            );
        });

        it('invoiceSlugPresetDefault editable — 200', async () => {
            const user = await createUser();
            const { businessSlug, accountSlug } = await seedAccount(user);
            const res = await supertest(app.getHttpServer())
                .patch(
                    `/api/businesses/me/${businessSlug}/accounts/${accountSlug}`
                )
                .set('Authorization', bearerFor(user))
                .send({ invoiceSlugPresetDefault: 'with-month' })
                .expect(200);
            expect(
                (
                    res.body as {
                        data: { invoiceSlugPresetDefault: string };
                    }
                ).data.invoiceSlugPresetDefault
            ).toBe('with-month');
        });

        it('Sprint 15 — slug editable (vanity) + старе посилання редіректить через history', async () => {
            const user = await createUser();
            const { businessSlug, accountSlug } = await seedAccount(user);
            // Sprint 27 — гейт per-business: брендуємо батьківський бізнес.
            await businessModel.updateOne(
                { slugLower: businessSlug.toLowerCase() },
                { $set: { brandedAt: new Date() } }
            );

            const renamed = await supertest(app.getHttpServer())
                .patch(
                    `/api/businesses/me/${businessSlug}/accounts/${accountSlug}`
                )
                .set('Authorization', bearerFor(user))
                .send({ slug: 'mono-cafe' })
                .expect(200);
            expect((renamed.body as { data: { slug: string } }).data.slug).toBe(
                'mono-cafe'
            );

            // Cabinet (strict) — старий slug більше не резолвиться.
            await supertest(app.getHttpServer())
                .get(
                    `/api/businesses/me/${businessSlug}/accounts/${accountSlug}`
                )
                .set('Authorization', bearerFor(user))
                .expect(404);

            // Public — старий slug резолвиться через history у canonical (новий).
            const publicOld = await supertest(app.getHttpServer())
                .get(
                    `/api/businesses/public/${businessSlug}/account/${accountSlug}`
                )
                .expect(200);
            expect(
                (publicOld.body as { data: { slug: string } }).data.slug
            ).toBe('mono-cafe');
        });

        it('Sprint 19 — slug-rename без тарифу (Free) → 403 SLUG_EDIT_REQUIRES_PLAN', async () => {
            const user = await createUser(); // без білінгу → рівень none
            const { businessSlug, accountSlug } = await seedAccount(user);

            const res = await supertest(app.getHttpServer())
                .patch(
                    `/api/businesses/me/${businessSlug}/accounts/${accountSlug}`
                )
                .set('Authorization', bearerFor(user))
                .send({ slug: 'mono-cafe' })
                .expect(403);
            expect((res.body as { error: { code: string } }).error.code).toBe(
                'SLUG_EDIT_REQUIRES_PLAN'
            );

            // Slug не змінено: авто-адреса досі резолвиться у кабінеті.
            await supertest(app.getHttpServer())
                .get(
                    `/api/businesses/me/${businessSlug}/accounts/${accountSlug}`
                )
                .set('Authorization', bearerFor(user))
                .expect(200);
        });

        it('Sprint 19 — case-only зміна slug без тарифу → 403 (display-форма теж платна)', async () => {
            const user = await createUser();
            const { businessSlug, accountSlug } = await seedAccount(user);

            const res = await supertest(app.getHttpServer())
                .patch(
                    `/api/businesses/me/${businessSlug}/accounts/${accountSlug}`
                )
                .set('Authorization', bearerFor(user))
                .send({ slug: accountSlug.toUpperCase() })
                .expect(403);
            expect((res.body as { error: { code: string } }).error.code).toBe(
                'SLUG_EDIT_REQUIRES_PLAN'
            );
        });

        it('reset-slug без тарифу → 200, свіжий авто-slug (гігієна адреси, не платна фіча)', async () => {
            const user = await createUser();
            const { businessSlug, accountSlug } = await seedAccount(user);

            const res = await supertest(app.getHttpServer())
                .post(
                    `/api/businesses/me/${businessSlug}/accounts/${accountSlug}/reset-slug`
                )
                .set('Authorization', bearerFor(user))
                .expect(200);
            const newSlug = (res.body as { data: { slug: string } }).data.slug;
            expect(newSlug).not.toBe(accountSlug);
            // Нова адреса резолвиться у кабінеті.
            await supertest(app.getHttpServer())
                .get(`/api/businesses/me/${businessSlug}/accounts/${newSlug}`)
                .set('Authorization', bearerFor(user))
                .expect(200);
        });

        it('Sprint 15 — slug-rename колізія у межах бізнесу → 409 SLUG_TAKEN', async () => {
            const user = await createUser();
            const { businessSlug, accountSlug } = await seedAccount(user);
            // Sprint 27 — гейт per-business: брендуємо батьківський бізнес.
            await businessModel.updateOne(
                { slugLower: businessSlug.toLowerCase() },
                { $set: { brandedAt: new Date() } }
            );
            // Другий рахунок під тим самим бізнесом.
            const second = await supertest(app.getHttpServer())
                .post(`/api/businesses/me/${businessSlug}/accounts`)
                .set('Authorization', bearerFor(user))
                .send({ iban: 'UA273052992990004149497786452' })
                .expect(201);
            const secondSlug = (second.body as { data: { slug: string } }).data
                .slug;

            await supertest(app.getHttpServer())
                .patch(
                    `/api/businesses/me/${businessSlug}/accounts/${secondSlug}`
                )
                .set('Authorization', bearerFor(user))
                .send({ slug: accountSlug })
                .expect(409);
        });
    });

    describe('DELETE /businesses/me/:slug/accounts/:accountSlug (§SP-3)', () => {
        async function seedAccountAndInvoice(
            user: UserDocument
        ): Promise<{ businessSlug: string; accountSlug: string }> {
            const businessSlug = await createBusinessFor(user);
            const accRes = await supertest(app.getHttpServer())
                .post(`/api/businesses/me/${businessSlug}/accounts`)
                .set('Authorization', bearerFor(user))
                .send({ iban: VALID_IBAN });
            const accountSlug = (accRes.body as { data: { slug: string } }).data
                .slug;
            await supertest(app.getHttpServer())
                .post(
                    `/api/businesses/me/${businessSlug}/accounts/${accountSlug}/invoices`
                )
                .set('Authorization', bearerFor(user))
                .send({
                    amount: 100000,
                    amountLocked: false,
                    paymentPurpose: null,
                    validUntil: null,
                    slugInput: { kind: 'random' },
                });
            return { businessSlug, accountSlug };
        }

        it('account з 1 інвойсом → 200, cascade видаляє рахунок і його інвойси', async () => {
            const user = await createUser();
            const { businessSlug, accountSlug } =
                await seedAccountAndInvoice(user);
            const accountBefore = await accountModel.findOne({
                slug: accountSlug,
            });

            const res = await supertest(app.getHttpServer())
                .delete(
                    `/api/businesses/me/${businessSlug}/accounts/${accountSlug}`
                )
                .set('Authorization', bearerFor(user))
                .expect(200);
            expect(
                (res.body as { data: { affectedInvoices: number } }).data
                    .affectedInvoices
            ).toBe(1);

            // Account і його інвойси — повністю видалені (atomic-or-nothing).
            const accountStill = await accountModel.findOne({
                slug: accountSlug,
            });
            expect(accountStill).toBeNull();
            const invoicesStill = await invoiceModel.countDocuments({
                accountId: accountBefore!._id,
            });
            expect(invoicesStill).toBe(0);
        });

        it('account без інвойсів → 200, документ видалено', async () => {
            const user = await createUser();
            const businessSlug = await createBusinessFor(user);
            const accRes = await supertest(app.getHttpServer())
                .post(`/api/businesses/me/${businessSlug}/accounts`)
                .set('Authorization', bearerFor(user))
                .send({ iban: VALID_IBAN });
            const accountSlug = (accRes.body as { data: { slug: string } }).data
                .slug;

            await supertest(app.getHttpServer())
                .delete(
                    `/api/businesses/me/${businessSlug}/accounts/${accountSlug}`
                )
                .set('Authorization', bearerFor(user))
                .expect(200);

            const still = await accountModel.findOne({ slug: accountSlug });
            expect(still).toBeNull();
        });
    });

    describe('Public: GET /businesses/public/:slug/account/:accountSlug', () => {
        it('whitelist + ibanMask + nbuLinks (без iban/taxId leak у JSON)', async () => {
            const user = await createUser();
            const businessSlug = await createBusinessFor(user);
            const accRes = await supertest(app.getHttpServer())
                .post(`/api/businesses/me/${businessSlug}/accounts`)
                .set('Authorization', bearerFor(user))
                .send({ iban: VALID_IBAN });
            const accountSlug = (accRes.body as { data: { slug: string } }).data
                .slug;

            const res = await supertest(app.getHttpServer())
                .get(
                    `/api/businesses/public/${businessSlug}/account/${accountSlug}`
                )
                .expect(200);
            const data = (res.body as { data: Record<string, unknown> }).data;
            expect(Object.keys(data).sort()).toEqual([
                'bankCode',
                'business',
                'ibanMask',
                'name',
                'nbuLinks',
                'slug',
            ]);
            expect(data.ibanMask).toBe('•6001');
            expect(data).not.toHaveProperty('iban');
            expect(data).not.toHaveProperty('taxId');
        });
    });

    describe('Cascade-delete business — Sprint 9 §SP-5', () => {
        it('delete business → cascade видаляє Account + Invoice + counter; response {affectedAccounts, affectedInvoices}', async () => {
            const user = await createUser();
            const businessSlug = await createBusinessFor(user);
            // 2 account-и × 2 інвойси
            for (const iban of [VALID_IBAN, 'UA273052992990004149497786452']) {
                const accRes = await supertest(app.getHttpServer())
                    .post(`/api/businesses/me/${businessSlug}/accounts`)
                    .set('Authorization', bearerFor(user))
                    .send({ iban });
                const accountSlug = (
                    accRes.body as {
                        data: { slug: string };
                    }
                ).data.slug;
                for (let i = 0; i < 2; i++) {
                    await supertest(app.getHttpServer())
                        .post(
                            `/api/businesses/me/${businessSlug}/accounts/${accountSlug}/invoices`
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
            }

            const res = await supertest(app.getHttpServer())
                .delete(`/api/businesses/me/${businessSlug}`)
                .set('Authorization', bearerFor(user))
                .expect(200);
            expect(
                (
                    res.body as {
                        data: {
                            affectedAccounts: number;
                            affectedInvoices: number;
                        };
                    }
                ).data
            ).toEqual({ affectedAccounts: 2, affectedInvoices: 4 });

            // Жодного orphan-документа.
            expect(
                await accountModel.countDocuments({
                    businessId: { $exists: true },
                })
            ).toBe(0);
            expect(await invoiceModel.countDocuments({})).toBe(0);
        });
    });
});
