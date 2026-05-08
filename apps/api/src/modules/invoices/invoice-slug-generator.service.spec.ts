import { InternalServerErrorException } from '@nestjs/common';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { getKyivYearMonth } from '@finly/types';
import { Model, Types } from 'mongoose';

import { createStandaloneMongo } from '../../test-utils/mongo';
import {
    InvoiceSlugGeneratorService,
    type GenerateInvoiceSlugInput,
} from './invoice-slug-generator.service';
import {
    InvoiceSlugCounter,
    InvoiceSlugCounterDocument,
    InvoiceSlugCounterSchema,
} from './schemas/invoice-slug-counter.schema';
import {
    Invoice,
    InvoiceDocument,
    InvoiceSchema,
} from './schemas/invoice.schema';

/**
 * Sprint 4 §4.1 — повний integration-spec для генератора. Використовує
 * `MongoMemoryServer` (standalone — transactions тут не потрібні), щоб
 * counter-aggregation і compound-unique працювали проти реальної Mongo
 * (mock-find не зловив би regex-edge-case-и і monotonic-invariant).
 */
describe('InvoiceSlugGeneratorService (Sprint 4 §4.1)', () => {
    let mongo: Awaited<ReturnType<typeof createStandaloneMongo>>;
    let moduleRef: TestingModule;
    let service: InvoiceSlugGeneratorService;
    let invoiceModel: Model<InvoiceDocument>;
    let counterModel: Model<InvoiceSlugCounterDocument>;
    let businessId: Types.ObjectId;

    beforeAll(async () => {
        mongo = await createStandaloneMongo();
        moduleRef = await Test.createTestingModule({
            imports: [
                MongooseModule.forRoot(mongo.uri),
                MongooseModule.forFeature([
                    { name: Invoice.name, schema: InvoiceSchema },
                    {
                        name: InvoiceSlugCounter.name,
                        schema: InvoiceSlugCounterSchema,
                    },
                ]),
            ],
            providers: [InvoiceSlugGeneratorService],
        }).compile();
        // `compile()` resolves DI graph і ініціалізує MongooseModule connection.
        // На відміну від `createNestApplication`-flow, цей шлях не піднімає
        // HTTP-listener — нам потрібен лише DI-context для тестування service-у.
        service = moduleRef.get(InvoiceSlugGeneratorService);
        invoiceModel = moduleRef.get(getModelToken(Invoice.name));
        counterModel = moduleRef.get(getModelToken(InvoiceSlugCounter.name));
        // Sprint 4 §4.1 — explicit index sync, щоб partial-unique compound
        // `(businessId, slugCounterScope, slugCounter)` точно існував до
        // race-test-у. Mongoose autoIndex може race з першим `create`-ом
        // на heavy-load test runner — `syncIndexes` await гарантує готовність.
        await invoiceModel.syncIndexes();
        await counterModel.syncIndexes();
    }, 30_000);

    afterAll(async () => {
        await moduleRef.close();
        await mongo.stop();
    });

    beforeEach(async () => {
        await invoiceModel.deleteMany({});
        await counterModel.deleteMany({});
        businessId = new Types.ObjectId();
    });

    /**
     * Test-only wrapper, що делегує до service з `null`-сесією. Production-
     * каллер (`InvoicesService.create`) завжди передає реальну `ClientSession`
     * для atomic counter-allocation у транзакції; тут unit-тестуємо генератор
     * у standalone Mongo (без replica-set / TX-support).
     */
    const gen = (
        input: GenerateInvoiceSlugInput,
    ): ReturnType<typeof service.generateInvoiceSlug> =>
        service.generateInvoiceSlug(input, null);

    /**
     * Helper: створює invoice-документ з мінімально-валідними полями.
     * Defaults — non-counter mode (`slugCounterScope=null`, `slugCounter=null`);
     * call-sites, що тестують counter-aggregation, повинні передати ці поля
     * явно (інакше generator не побачить попередній лічильник у `nextCounter-
     * ByScope` і всі N будуть = 1).
     */
    async function insertInvoice(
        overrides: Partial<Invoice> = {}
    ): Promise<void> {
        await invoiceModel.create({
            businessId,
            slug: 'placeholder',
            amount: null,
            amountLocked: false,
            paymentPurpose: null,
            validUntil: null,
            slugPreset: null,
            slugCounterScope: null,
            slugCounter: null,
            deletedAt: null,
            ...overrides,
        });
    }

    describe('kind=explicit', () => {
        it('повертає {humanPart}-{tail}, slugPreset=null, counter-fields=null', async () => {
            const result = await gen({
                businessId,
                slugInput: { kind: 'explicit', humanPart: 'inv-2026' },
                paymentPurpose: null,
                businessPaymentPurposeTemplate: 'Оплата',
            });
            expect(result.slug).toMatch(/^inv-2026-[A-Za-z0-9]{8}$/);
            expect(result.slugPreset).toBeNull();
            expect(result.slugCounterScope).toBeNull();
            expect(result.slugCounter).toBeNull();
        });
    });

    describe('kind=random', () => {
        it('повертає голий 8-char tail, slugPreset=null, counter-fields=null', async () => {
            const result = await gen({
                businessId,
                slugInput: { kind: 'random' },
                paymentPurpose: null,
                businessPaymentPurposeTemplate: 'Оплата',
            });
            expect(result.slug).toMatch(/^[A-Za-z0-9]{8}$/);
            expect(result.slugPreset).toBeNull();
            expect(result.slugCounterScope).toBeNull();
            expect(result.slugCounter).toBeNull();
        });
    });

    describe('kind=preset, simple', () => {
        it('перший інвойс — inv-001 + counter-fields seeded', async () => {
            const result = await gen({
                businessId,
                slugInput: { kind: 'preset', preset: 'simple' },
                paymentPurpose: null,
                businessPaymentPurposeTemplate: 'Оплата',
            });
            expect(result.slug).toMatch(/^inv-001-[A-Za-z0-9]{8}$/);
            expect(result.slugPreset).toBe('simple');
            expect(result.slugCounterScope).toBe('simple');
            expect(result.slugCounter).toBe(1);
        });

        it('monotonic counter: 10 послідовних інвойсів — inv-001..inv-010', async () => {
            for (let i = 1; i <= 10; i++) {
                const r = await gen({
                    businessId,
                    slugInput: { kind: 'preset', preset: 'simple' },
                    paymentPurpose: null,
                    businessPaymentPurposeTemplate: 'Оплата',
                });
                const expected = String(i).padStart(3, '0');
                expect(r.slug.startsWith(`inv-${expected}-`)).toBe(true);
                expect(r.slugCounterScope).toBe('simple');
                expect(r.slugCounter).toBe(i);
                // Емуляція persist (real service-метод буде це робити у §4.2
                // через `InvoicesService.create`). Передаємо counter-fields,
                // щоб наступний `nextCounterByScope` побачив попередні N.
                await insertInvoice({
                    slug: r.slug,
                    slugPreset: 'simple',
                    slugCounterScope: r.slugCounterScope,
                    slugCounter: r.slugCounter,
                });
            }
        });

        it('counter-isolation: explicit-slug `inv-999-...` не впливає на simple-counter', async () => {
            // SP-1 invariant: explicit-mode інвойс з humanPart "inv-999"
            // (regex-збіжний з simple-pattern) має `slugCounterScope=null` /
            // `slugCounter=null`. Generator `nextCounterByScope` фільтрує по
            // `slugCounterScope: 'simple'`, виключаючи цю document з
            // MAX(N)+1 aggregation.
            await insertInvoice({
                slug: 'inv-999-aB3xQ9k7',
                slugPreset: null, // explicit-mode
                // counter-fields навмисно null — explicit не використовує counter
            });

            const result = await gen({
                businessId,
                slugInput: { kind: 'preset', preset: 'simple' },
                paymentPurpose: null,
                businessPaymentPurposeTemplate: 'Оплата',
            });
            // НЕ inv-1000 (це був би regression — counter забрудненим explicit-doc).
            expect(result.slug).toMatch(/^inv-001-[A-Za-z0-9]{8}$/);
            expect(result.slugCounter).toBe(1);
        });

        it('counter-isolation per businessId: інший business не впливає', async () => {
            const otherBusinessId = new Types.ObjectId();
            await invoiceModel.create({
                businessId: otherBusinessId,
                slug: 'inv-555-aaaaaaaa',
                slugPreset: 'simple',
                slugCounterScope: 'simple',
                slugCounter: 555,
                amount: null,
                amountLocked: false,
                paymentPurpose: null,
                validUntil: null,
                deletedAt: null,
            });

            const result = await gen({
                businessId,
                slugInput: { kind: 'preset', preset: 'simple' },
                paymentPurpose: null,
                businessPaymentPurposeTemplate: 'Оплата',
            });
            expect(result.slug).toMatch(/^inv-001-[A-Za-z0-9]{8}$/);
            expect(result.slugCounter).toBe(1);
        });

        it('partial-unique compound (businessId, slugCounterScope, slugCounter) блокує race-collision на write-path', async () => {
            // Sprint 4 §4.1 — критичний invariant для retry-on-11000
            // mitigation (SP-1 risk #2). Доводить, що compound-unique у
            // Mongoose schema справді блокує два paralleл write-и з тим
            // самим counter-namespace + counter-номером. Без цього index-у
            // race на `MAX(N)+1` між двома generate-then-insert операціями
            // створив би два інвойси з тим самим візуальним номером
            // (різні tails → `(businessId, slug)` compound-unique їх не
            // блокує) — порушуючи monotonic invariant.
            await insertInvoice({
                slug: 'inv-001-aaaaaaaa',
                slugPreset: 'simple',
                slugCounterScope: 'simple',
                slugCounter: 1,
            });

            // Спроба прямого insert ще одного інвойсу з тим самим counter-scope
            // (різний tail) → 11000.
            await expect(
                invoiceModel.create({
                    businessId,
                    slug: 'inv-001-bbbbbbbb',
                    slugPreset: 'simple',
                    slugCounterScope: 'simple',
                    slugCounter: 1,
                    amount: null,
                    amountLocked: false,
                    paymentPurpose: null,
                    validUntil: null,
                    deletedAt: null,
                })
            ).rejects.toMatchObject({ code: 11000 });
        });

        it('counter monotonic across deletes: видалення invoice не reset-ить counter (Sprint 4 review fix)', async () => {
            // КРИТИЧНИЙ INVARIANT (Sprint 4 review fix): counter-doc живе
            // незалежно від invoice-документів. Раніше `MAX(slugCounter)+1`
            // over invoice-документами reset-ився після delete (видалили
            // inv-003 → MAX=2 → counter знову 3 → візуально дублікат
            // `inv-003-{newTail}`). Тепер counter живе у своїй колекції;
            // hard-delete invoice не торкається counter-doc-у.
            //
            // Симулюємо post-deploy steady-state:
            //   counter-doc.last = 3 (3 prior allocations)
            //   invoices: counter=1, counter=2 (counter=3 invoice deleted)
            await counterModel.create({
                businessId,
                scope: 'simple',
                last: 3,
            });
            await insertInvoice({
                slug: 'inv-001-aaaaaaaa',
                slugPreset: 'simple',
                slugCounterScope: 'simple',
                slugCounter: 1,
            });
            await insertInvoice({
                slug: 'inv-002-bbbbbbbb',
                slugPreset: 'simple',
                slugCounterScope: 'simple',
                slugCounter: 2,
            });
            // No invoice with counter=3 (deleted by user). Старий
            // MAX(N)+1-aggregation поверне 3 (counter reuse — баг). Новий
            // counter-doc.$inc поверне 4 (monotonic invariant).

            const r = await gen({
                businessId,
                slugInput: { kind: 'preset', preset: 'simple' },
                paymentPurpose: null,
                businessPaymentPurposeTemplate: 'Оплата',
            });
            expect(r.slug).toMatch(/^inv-004-[A-Za-z0-9]{8}$/);
            expect(r.slugCounter).toBe(4);

            const counterDoc = await counterModel
                .findOne({ businessId, scope: 'simple' })
                .lean();
            expect(counterDoc?.last).toBe(4);
        });

        it('lazy bootstrap: counter-doc відсутній, але legacy invoices мають counter-значення → counter стартує за legacy MAX', async () => {
            // Post-deploy перший allocate per (business, scope) на legacy data:
            // counter-doc ще не існує, але існують invoices з counter-значеннями.
            // Без bootstrap-у counter стартував би з 1 → collision проти
            // existing invoice з counter=1 → retry-on-11000 у InvoicesService
            // → exhaust MAX_RETRIES при ≥4 legacy invoices у scope-i. Lazy
            // bootstrap pre-skip-ає за legacy MAX, гарантуючи clean-allocate
            // на першому пост-деплой інвойсі.
            await insertInvoice({
                slug: 'inv-001-aaaaaaaa',
                slugPreset: 'simple',
                slugCounterScope: 'simple',
                slugCounter: 1,
            });
            await insertInvoice({
                slug: 'inv-002-bbbbbbbb',
                slugPreset: 'simple',
                slugCounterScope: 'simple',
                slugCounter: 2,
            });
            await insertInvoice({
                slug: 'inv-005-cccccccc',
                slugPreset: 'simple',
                slugCounterScope: 'simple',
                slugCounter: 5,
            });
            // No counter-doc. Allocate має знайти legacyMax=5, створити
            // counter-doc з last=6, повернути 6.

            const r = await gen({
                businessId,
                slugInput: { kind: 'preset', preset: 'simple' },
                paymentPurpose: null,
                businessPaymentPurposeTemplate: 'Оплата',
            });
            expect(r.slug).toMatch(/^inv-006-[A-Za-z0-9]{8}$/);
            expect(r.slugCounter).toBe(6);

            const counterDoc = await counterModel
                .findOne({ businessId, scope: 'simple' })
                .lean();
            expect(counterDoc?.last).toBe(6);
        });

        it('partial-unique НЕ блокує non-counter режими (slugCounter=null)', async () => {
            // explicit/random/with-purpose всі мають counter-fields=null.
            // partial-filter `slugCounter: { $type: 'int' }` виключає null
            // з index-у, тож два random-документи з різними tails не
            // конфліктують.
            await insertInvoice({
                slug: 'aaaaaaaa',
                slugPreset: null,
                slugCounterScope: null,
                slugCounter: null,
            });
            await expect(
                invoiceModel.create({
                    businessId,
                    slug: 'bbbbbbbb',
                    slugPreset: null,
                    slugCounterScope: null,
                    slugCounter: null,
                    amount: null,
                    amountLocked: false,
                    paymentPurpose: null,
                    validUntil: null,
                    deletedAt: null,
                })
            ).resolves.toBeDefined();
        });
    });

    describe('kind=preset, with-month', () => {
        it('містить YYYY-MM prefix у Kyiv-tz і слідує counter', async () => {
            const r = await gen({
                businessId,
                slugInput: { kind: 'preset', preset: 'with-month' },
                paymentPurpose: null,
                businessPaymentPurposeTemplate: 'Оплата',
            });
            const { year, month } = getKyivYearMonth(new Date());
            const yyyy = year;
            const mm = String(month).padStart(2, '0');
            expect(r.slug).toMatch(
                new RegExp(`^${yyyy}-${mm}-001-[A-Za-z0-9]{8}$`)
            );
            expect(r.slugPreset).toBe('with-month');
        });

        it('counter ігнорує інший місяць (наступний місяць → counter starts again at 1)', async () => {
            // Sprint 4 §4.1 — counter per (business, year, month) reset-иться
            // на новий місяць. Sprint 4 review fix: seed-имо РЕАЛЬНИЙ counter-
            // doc для попереднього місяця (не invoice з null-counter-fields,
            // що нічого не доводив про counter-isolation).
            const { year, month } = getKyivYearMonth(new Date());
            const prevMonthScope =
                month === 1
                    ? `${year - 1}-12`
                    : `${year}-${String(month - 1).padStart(2, '0')}`;
            await counterModel.create({
                businessId,
                scope: prevMonthScope,
                last: 5,
            });

            const r = await gen({
                businessId,
                slugInput: { kind: 'preset', preset: 'with-month' },
                paymentPurpose: null,
                businessPaymentPurposeTemplate: 'Оплата',
            });
            // Все одно 001 — попередній місяць має окремий counter-namespace.
            const yyyy = year;
            const mm = String(month).padStart(2, '0');
            expect(r.slug).toMatch(
                new RegExp(`^${yyyy}-${mm}-001-[A-Za-z0-9]{8}$`)
            );
            expect(r.slugCounter).toBe(1);
            // Counter-doc для попереднього місяця має лишитись недоторканим.
            const prev = await counterModel
                .findOne({ businessId, scope: prevMonthScope })
                .lean();
            expect(prev?.last).toBe(5);
        });

        it('boundary midnight: інвойс o 1.06.2026 00:30 Київ (= UTC 31.05 21:30Z) → prefix 2026-06-, не 2026-05-', async () => {
            // КРИТИЧНИЙ КЕЙС (Sprint 4 §4.1 boundary regression): slug
            // immutable, тож якщо UTC-логіка дала би `2026-05-...` для
            // "червневого" інвойсу — звітність ФОП на місяці буде поплутана
            // назавжди. Цей тест замикає regression проти попередньої
            // UTC-реалізації (`getUTCMonth`).
            //
            // Fake timer: `new Date()` всередині service-у поверне саме цей
            // instant. `setSystemTime` діє і на Date constructor, і на
            // Date.now()/performance.now().
            // Мокуємо `service.now()` (protected seam) точково — без
            // `jest.useFakeTimers`, що заморозив би Mongoose-heartbeat до
            // deadlock-у, і без `Date.now()`-моку, який V8 `new Date()` без
            // аргументів ігнорує.
            const nowSpy = jest
                .spyOn(service as unknown as { now: () => Date }, 'now')
                .mockReturnValue(new Date('2026-05-31T21:30:00.000Z'));
            try {
                const r = await gen({
                    businessId,
                    slugInput: { kind: 'preset', preset: 'with-month' },
                    paymentPurpose: null,
                    businessPaymentPurposeTemplate: 'Оплата',
                });
                expect(r.slug).toMatch(/^2026-06-001-[A-Za-z0-9]{8}$/);
            } finally {
                nowSpy.mockRestore();
            }
        });
    });

    describe('kind=preset, with-year', () => {
        it('містить YYYY prefix у Kyiv-tz і counter', async () => {
            const r = await gen({
                businessId,
                slugInput: { kind: 'preset', preset: 'with-year' },
                paymentPurpose: null,
                businessPaymentPurposeTemplate: 'Оплата',
            });
            const { year } = getKyivYearMonth(new Date());
            expect(r.slug).toMatch(new RegExp(`^${year}-001-[A-Za-z0-9]{8}$`));
            expect(r.slugPreset).toBe('with-year');
        });

        it('boundary year-end: інвойс 1.01.2027 00:30 Київ (= UTC 31.12.2026 22:30Z) → prefix 2027-, не 2026-', async () => {
            // Той самий boundary-invariant для річного counter-у (Sprint 4
            // §4.1 boundary regression). Зимовий tz UTC+2: 22:30Z 31 грудня
            // = Kyiv 00:30 1 січня наступного року.
            // Той самий `service.now()`-spy патерн (див. boundary-тест у
            // `with-month`-блоку).
            const nowSpy = jest
                .spyOn(service as unknown as { now: () => Date }, 'now')
                .mockReturnValue(new Date('2026-12-31T22:30:00.000Z'));
            try {
                const r = await gen({
                    businessId,
                    slugInput: { kind: 'preset', preset: 'with-year' },
                    paymentPurpose: null,
                    businessPaymentPurposeTemplate: 'Оплата',
                });
                expect(r.slug).toMatch(/^2027-001-[A-Za-z0-9]{8}$/);
            } finally {
                nowSpy.mockRestore();
            }
        });
    });

    describe('kind=preset, with-purpose', () => {
        it('explicit paymentPurpose — slug містить slugified explicit-purpose', async () => {
            const r = await gen({
                businessId,
                slugInput: { kind: 'preset', preset: 'with-purpose' },
                paymentPurpose: 'Оплата за консультацію',
                businessPaymentPurposeTemplate: 'Default biz',
            });
            expect(r.slug).toMatch(/^oplata-za-konsultatsiiu-[A-Za-z0-9]{8}$/);
            expect(r.slugPreset).toBe('with-purpose');
        });

        it('paymentPurpose=null — inheritance з business template', async () => {
            const r = await gen({
                businessId,
                slugInput: { kind: 'preset', preset: 'with-purpose' },
                paymentPurpose: null,
                businessPaymentPurposeTemplate: 'Послуги веб-розробки',
            });
            expect(r.slug).toMatch(/^posluhy-veb-rozrobky-[A-Za-z0-9]{8}$/);
            expect(r.slugPreset).toBe('with-purpose');
        });

        it('empty-after-slugify (emoji-only) → fallback на рівень 3', async () => {
            const r = await gen({
                businessId,
                slugInput: { kind: 'preset', preset: 'with-purpose' },
                paymentPurpose: '🎉🎁',
                businessPaymentPurposeTemplate: 'Default',
            });
            expect(r.slug).toMatch(/^[A-Za-z0-9]{8}$/);
            expect(r.slugPreset).toBeNull(); // НЕ 'with-purpose'!
        });

        it("apostrophe-cyrillic edge — m'iaso → miaso", async () => {
            const r = await gen({
                businessId,
                slugInput: { kind: 'preset', preset: 'with-purpose' },
                paymentPurpose: 'М’ясо',
                businessPaymentPurposeTemplate: 'Default',
            });
            expect(r.slug).toMatch(/^miaso-[A-Za-z0-9]{8}$/);
        });

        it('numeric purpose preserved у slug', async () => {
            const r = await gen({
                businessId,
                slugInput: { kind: 'preset', preset: 'with-purpose' },
                paymentPurpose: 'Замовлення 147',
                businessPaymentPurposeTemplate: 'Default',
            });
            expect(r.slug).toMatch(/^zamovlennia-147-[A-Za-z0-9]{8}$/);
        });
    });

    describe('collision retry', () => {
        it('11-та невдала спроба → INVOICE_SLUG_GENERATION_FAILED', async () => {
            // Симуляція: всі attempt-и колізують на existing-slug-і. У реалі
            // tail дає 218T комбінацій × per-business namespace, тож трапиться
            // раз на life of the universe — але defensively тестуємо fail-шлях.
            const existsSpy = jest
                .spyOn(invoiceModel, 'exists')
                .mockResolvedValue({ _id: new Types.ObjectId() });

            await expect(
                gen({
                    businessId,
                    slugInput: { kind: 'random' },
                    paymentPurpose: null,
                    businessPaymentPurposeTemplate: 'Default',
                })
            ).rejects.toThrow(InternalServerErrorException);

            existsSpy.mockRestore();
        });

        it('3-а спроба passes (mocked exists повертає taken 2× → free)', async () => {
            let calls = 0;
            const existsSpy = jest
                .spyOn(invoiceModel, 'exists')
                .mockImplementation(() => {
                    calls++;
                    return Promise.resolve(
                        calls < 3 ? { _id: new Types.ObjectId() } : null
                    ) as ReturnType<typeof invoiceModel.exists>;
                });

            const r = await gen({
                businessId,
                slugInput: { kind: 'random' },
                paymentPurpose: null,
                businessPaymentPurposeTemplate: 'Default',
            });
            expect(r.slug).toMatch(/^[A-Za-z0-9]{8}$/);
            expect(calls).toBe(3);
            existsSpy.mockRestore();
        });
    });
});
