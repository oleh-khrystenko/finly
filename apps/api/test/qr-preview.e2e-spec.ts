import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ZodValidationPipe } from 'nestjs-zod';
import * as supertest from 'supertest';
import { App } from 'supertest/types';

import {
    NBU_HOST_PRIMARY,
    QrPreviewResponseSchema,
    RESPONSE_CODE,
} from '@finly/types';

import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { THROTTLERS } from '../src/common/http/throttle-policy';
import { QrModule } from '../src/modules/qr/qr.module';

// ─── Mock ENV — fail-fast strict у `config/env.ts` крашить при відсутності
//     обовʼязкових ключів, навіть якщо QrModule їх не використовує
//     (модуль-граф ConfigModule все одно тригерить eager-load). ───

jest.mock('../src/config/env', () => ({
    ENV: {
        NODE_ENV: 'test',
        API_PORT: '4000',
        WEB_URL: 'https://finly.com.ua',
        PAY_PUBLIC_URL: 'https://pay.finly.com.ua',
        MONGODB_URI: 'mongodb://unused-by-this-suite',
        REDIS_URL: 'redis://unused',
        JWT_ACCESS_SECRET: 'qr-preview-e2e-access-secret-must-be-long-enough',
        JWT_REFRESH_SECRET: 'qr-preview-e2e-refresh-secret-must-be-long-enough',
        GOOGLE_CLIENT_ID: 'test-id.apps.googleusercontent.com',
        GOOGLE_CLIENT_SECRET: 'GOCSPX-test',
        RESEND_API_KEY: 're_test',
        RESEND_FROM_EMAIL: 'Finly <test@test.com>',
        STRIPE_SECRET_KEY: 'sk_test',
        STRIPE_WEBHOOK_SECRET: 'whsec_test',
    },
}));

// ─── Fixtures ───

const VALID_INPUT = {
    receiverName: 'Іваненко Олена Петрівна',
    iban: 'UA213223130000026007233566001',
    taxId: '1234567899',
    purpose: 'Поповнення рахунку',
};

/**
 * Single test-module factory. Мінімальний граф: QrModule + ThrottlerModule.
 * QrController не залежить від БД, Redis, Auth, Email — його pipeline чисто
 * ізольований (Zod input → QrService.renderForNbuPayload → PNG buffer +
 * Base64URL link). Жодних provider-overrides не треба.
 *
 * **Throttler-конфіг точно як в `app.module.ts`** — усі 3 named buckets,
 * інакше `@Throttle({ 'qr-preview': ... })` падає з "throttler not found".
 *
 * **Окремий app per describe-block** — ThrottlerStorage у v6 живе в-памʼяті
 * на рівні модуля. Один shared app дав би залежність throttle-тестів від
 * кількості викликів у попередніх кейсах (validation-тести лічаться у
 * лічильнику навіть на 400-response). Fresh app ізолює лічильник на блок.
 */
async function createTestApp(): Promise<INestApplication<App>> {
    const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [
            ConfigModule.forRoot({ isGlobal: true }),
            // Бакети — з того самого реєстру, що й прод (`THROTTLERS`), а не
            // копією-літералом: раніше тут жили три бакети з власними числами, і
            // зміна ліміту `qr-preview` у реєстрі (Sprint 29: 10 → 30) розійшлася
            // з тестом. Декоратор контролера читає реєстр, тож тест мусить теж.
            ThrottlerModule.forRoot({
                throttlers: THROTTLERS.map((t) => ({ ...t })),
            }),
            QrModule,
        ],
        providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();

    const app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ZodValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    return app;
}

// ─── Happy path + Validation ───

describe('QR Preview E2E (POST /api/qr/preview)', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
        app = await createTestApp();
    }, 60_000);

    afterAll(async () => {
        await app.close();
    });

    describe('Happy path', () => {
        it('повертає 200 + response shape, що матчить QrPreviewResponseSchema', async () => {
            const res = await supertest(app.getHttpServer())
                .post('/api/qr/preview')
                .send(VALID_INPUT)
                .expect(200);

            const body = res.body as { data: unknown };
            const parsed = QrPreviewResponseSchema.safeParse(body.data);
            expect(parsed.success).toBe(true);
            if (parsed.success) {
                expect(parsed.data.link).toMatch(
                    new RegExp(
                        `^https://${NBU_HOST_PRIMARY.replace('.', '\\.')}/`
                    )
                );
                expect(parsed.data.qrPngBase64.length).toBeGreaterThan(0);
            }
        });

        it('PNG round-trip через jsqr — декодоване значення = той самий link', async () => {
            // Гарантує, що PNG і link кодують identичний payload (no drift).
            // Той самий round-trip-pattern, що `businesses.e2e-spec.ts`
            // §1199 для public business QR — sharp.raw → jsqr.
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const jsQR = require('jsqr') as typeof import('jsqr').default;
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const sharp = require('sharp') as typeof import('sharp');

            const res = await supertest(app.getHttpServer())
                .post('/api/qr/preview')
                .send(VALID_INPUT)
                .expect(200);

            const body = res.body as {
                data: { link: string; qrPngBase64: string };
            };
            const png = Buffer.from(body.data.qrPngBase64, 'base64');

            const { data, info } = await sharp(png)
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
            expect(decoded!.data).toBe(body.data.link);
        });
    });

    describe('Validation', () => {
        it('400 на невалідному IBAN', async () => {
            await supertest(app.getHttpServer())
                .post('/api/qr/preview')
                .send({ ...VALID_INPUT, iban: 'UA000000000000000000000000000' })
                .expect(400);
        });

        it('400 на невалідному taxId (failing checksum)', async () => {
            await supertest(app.getHttpServer())
                .post('/api/qr/preview')
                .send({ ...VALID_INPUT, taxId: '1234567890' })
                .expect(400);
        });

        it('400 на empty purpose', async () => {
            await supertest(app.getHttpServer())
                .post('/api/qr/preview')
                .send({ ...VALID_INPUT, purpose: '' })
                .expect(400);
        });

        it('400 на unknown field через .strict()', async () => {
            await supertest(app.getHttpServer())
                .post('/api/qr/preview')
                .send({ ...VALID_INPUT, type: 'fop' })
                .expect(400);
        });

        // Sprint 8 regression-guard: до NBU-charset refine на entity-рівні цей
        // input проходив DTO → builder кидав PayloadValidationError → глобальний
        // фільтр мапив у 500 INTERNAL_ERROR. Public anon endpoint віддавав 500
        // на користувацький input з emoji. Refine конвертує на 400.
        it('400 на NBU-non-mappable char у receiverName (emoji)', async () => {
            await supertest(app.getHttpServer())
                .post('/api/qr/preview')
                .send({ ...VALID_INPUT, receiverName: "☕ Кав'ярня" })
                .expect(400);
        });

        it('400 на NBU-non-mappable char у purpose (emoji)', async () => {
            await supertest(app.getHttpServer())
                .post('/api/qr/preview')
                .send({ ...VALID_INPUT, purpose: 'Оплата 🍵' })
                .expect(400);
        });

        it('400 на LF у receiverName (multi-line атака на field-separator)', async () => {
            await supertest(app.getHttpServer())
                .post('/api/qr/preview')
                .send({ ...VALID_INPUT, receiverName: 'Іваненко\nПетро' })
                .expect(400);
        });

        // Sprint 8 fix — overall-payload-size overflow (emergent property
        // комбінації полів, не окремого поля). До fix-у `purpose='А'.repeat(420)`
        // (валідні 420 cyrillic chars per-field, але payload 840 B) проходив
        // DTO → builder кидав `PayloadValidationError('PAYLOAD_OVERALL_SIZE_EXCEEDED')`
        // → AllExceptionsFilter мапив як 500 INTERNAL_ERROR. Розширення
        // фільтра катає це у 400 + `PAYLOAD_TOO_LARGE` з actionable copy.
        it('400 + PAYLOAD_TOO_LARGE на overall-payload overflow (purpose 420 cyrillic = 840 B)', async () => {
            const res = await supertest(app.getHttpServer())
                .post('/api/qr/preview')
                .send({ ...VALID_INPUT, purpose: 'А'.repeat(420) })
                .expect(400);

            expect(res.body).toEqual({
                error: {
                    code: RESPONSE_CODE.PAYLOAD_TOO_LARGE,
                    message: expect.stringContaining(
                        'PAYLOAD_OVERALL_SIZE_EXCEEDED'
                    ),
                },
            });
        });
    });
});

// ─── Throttle (окремий app з чистим storage) ───

/**
 * Поріг беремо з реєстру, а не числом у назві тесту: інакше кожна зміна ліміту
 * лишає тест із застарілим очікуванням (саме так він і зламався у Sprint 29,
 * коли `qr-preview` виріс з 10 до 30).
 */
const QR_PREVIEW_LIMIT = THROTTLERS.find((t) => t.name === 'qr-preview')!.limit;

describe('QR Preview E2E — throttle bucket "qr-preview"', () => {
    let app: INestApplication<App>;

    beforeAll(async () => {
        app = await createTestApp();
    }, 60_000);

    afterAll(async () => {
        await app.close();
    });

    it('запит понад ліміт бакета за 60s повертає 429 (у межах ліміту проходить)', async () => {
        // Послідовно (не Promise.all): ThrottlerStorage incr-ить лічильник
        // синхронно на запит; race на parallel-fire може дати флакі-stately
        // (всі запити спрацюють одночасно з різним post-incr-state).
        //
        // Решта бакетів skip-нута через `skipThrottlersExcept('qr-preview')` на
        // controller-рівні, тож реальний поріг — рівно ліміт цього бакета.
        await supertest(app.getHttpServer())
            .post('/api/qr/preview')
            .send(VALID_INPUT)
            .expect(200);

        // Залишок бюджету витрачаємо навмисно невалідними запитами: guard стоїть
        // ДО валідаційного pipe, тож лічильник інкрементує і на 400. Так кейс не
        // платить лімітом sharp-рендерів — на 30/min він був найважчим у наборі і
        // під паралельним прогоном з'їдав CPU у сусідніх тестів того ж файлу.
        for (let i = 1; i < QR_PREVIEW_LIMIT; i++) {
            await supertest(app.getHttpServer())
                .post('/api/qr/preview')
                .send({})
                .expect(400);
        }

        await supertest(app.getHttpServer())
            .post('/api/qr/preview')
            .send(VALID_INPUT)
            .expect(429);
    }, 60_000);
});
