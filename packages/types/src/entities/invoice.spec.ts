import { effectiveLimit } from '../qr/limits';
import { InvoicePayeeSnapshotSchema, InvoiceSchema } from './invoice';

const PURPOSE_LIMIT = effectiveLimit('purpose');

const VALID_INVOICE = {
    id: '507f1f77bcf86cd799439021',
    businessId: '507f1f77bcf86cd799439011',
    accountId: '507f1f77bcf86cd799439031',
    slug: 'zamovlennia-147-aB3xQ9k7',
    slugLower: 'zamovlennia-147-ab3xq9k7',
    amount: 150000, // 1500.00 грн у копійках
    amountLocked: true,
    paymentPurpose: 'Оплата за замовлення №147',
    validUntil: '2026-06-01T00:00:00.000Z',
    slugPreset: null,
    deletedAt: null,
    createdAt: '2026-05-01T10:00:00.000Z',
    updatedAt: '2026-05-01T10:00:00.000Z',
};

describe('InvoiceSchema', () => {
    it('parses a fully populated invoice', () => {
        const result = InvoiceSchema.safeParse(VALID_INVOICE);
        expect(result.success).toBe(true);
    });

    it('Sprint 9 §SP-6 — rejects invoice без accountId', () => {
        const { accountId: _omit, ...without } = VALID_INVOICE;
        void _omit;
        const result = InvoiceSchema.safeParse(without);
        expect(result.success).toBe(false);
    });

    it('Sprint 9 — rejects malformed accountId', () => {
        const result = InvoiceSchema.safeParse({
            ...VALID_INVOICE,
            accountId: 'not-an-objectid',
        });
        expect(result.success).toBe(false);
    });

    it('Sprint 9 — businessId і accountId обидва required (denormalized invariant)', () => {
        const { businessId: _omit, ...without } = VALID_INVOICE;
        void _omit;
        const result = InvoiceSchema.safeParse(without);
        expect(result.success).toBe(false);
    });

    it('parses a "client-types-amount" invoice (amount=null)', () => {
        const result = InvoiceSchema.safeParse({
            ...VALID_INVOICE,
            amount: null,
            amountLocked: false,
        });
        expect(result.success).toBe(true);
    });

    it('parses a no-expiration invoice (validUntil=null)', () => {
        const result = InvoiceSchema.safeParse({
            ...VALID_INVOICE,
            validUntil: null,
        });
        expect(result.success).toBe(true);
    });

    it('parses an invoice that inherits business purpose template (paymentPurpose=null)', () => {
        const result = InvoiceSchema.safeParse({
            ...VALID_INVOICE,
            paymentPurpose: null,
        });
        expect(result.success).toBe(true);
    });

    it.each(['simple', 'with-month', 'with-year', 'with-purpose'])(
        'accepts slugPreset=%s',
        (slugPreset) => {
            const result = InvoiceSchema.safeParse({
                ...VALID_INVOICE,
                slugPreset,
            });
            expect(result.success).toBe(true);
        }
    );

    it('rejects unknown slugPreset', () => {
        const result = InvoiceSchema.safeParse({
            ...VALID_INVOICE,
            slugPreset: 'with-quarter',
        });
        expect(result.success).toBe(false);
    });

    it('Sprint 4 §4.1 — applies default null для slugCounterScope/slugCounter (existing-doc compat)', () => {
        // Документ з БД, створений до Sprint 4, не має нових fields. Zod
        // entity з `.default(null)` парсить як null, а не падає.
        const result = InvoiceSchema.safeParse(VALID_INVOICE);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.slugCounterScope).toBeNull();
            expect(result.data.slugCounter).toBeNull();
        }
    });

    it('Sprint 4 §4.1 — accepts paired counter-fields (counter-preset case)', () => {
        const result = InvoiceSchema.safeParse({
            ...VALID_INVOICE,
            slugPreset: 'simple',
            slugCounterScope: 'simple',
            slugCounter: 1,
        });
        expect(result.success).toBe(true);
    });

    it('Sprint 4 §4.1 — rejects half-paired counter (only scope)', () => {
        const result = InvoiceSchema.safeParse({
            ...VALID_INVOICE,
            slugCounterScope: 'simple',
            slugCounter: null,
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(
                result.error.issues.some(
                    (i) => i.message === 'SLUG_COUNTER_SCOPE_PAIR_INVARIANT'
                )
            ).toBe(true);
        }
    });

    it('Sprint 4 §4.1 — rejects half-paired counter (only counter)', () => {
        const result = InvoiceSchema.safeParse({
            ...VALID_INVOICE,
            slugCounterScope: null,
            slugCounter: 5,
        });
        expect(result.success).toBe(false);
    });

    it('Sprint 4 §4.1 — rejects non-positive slugCounter (1, 2, 3, ...)', () => {
        const result = InvoiceSchema.safeParse({
            ...VALID_INVOICE,
            slugCounterScope: 'simple',
            slugCounter: 0,
        });
        expect(result.success).toBe(false);
    });

    it('rejects negative amount', () => {
        const result = InvoiceSchema.safeParse({
            ...VALID_INVOICE,
            amount: -1,
        });
        expect(result.success).toBe(false);
    });

    it('rejects fractional amount (must be kopiykas as int)', () => {
        const result = InvoiceSchema.safeParse({
            ...VALID_INVOICE,
            amount: 150.5,
        });
        expect(result.success).toBe(false);
    });

    // Sprint 15 — invoice slug став vanity-string 3-128 chars (дзеркало
    // businessSlugSchema): uppercase і довільна довжина tail тепер валідні.
    // Невалідні лише не-alphanumeric символи (крім дефіса-роздільника),
    // дефіс на краю і вихід за межі довжини.
    it.each([
        ['ab', 'too short (2 chars)'],
        ['', 'empty string'],
        ['a'.repeat(129), 'too long (129 chars)'],
        ['has space-aB3xQ9k7', 'space in human part'],
        ['order_aB3xQ9k7', 'underscore'],
        ['order.aB3xQ9k7', 'dot'],
        ['order-aB3xQ9к7', 'cyrillic char'],
        ['-order-aB3xQ9k7', 'leading dash'],
        ['order-aB3xQ9k7-', 'trailing dash'],
    ])('rejects malformed slug %s (%s)', (slug) => {
        const result = InvoiceSchema.safeParse({ ...VALID_INVOICE, slug });
        expect(result.success).toBe(false);
    });

    it('accepts tail-only slug (no human part)', () => {
        const result = InvoiceSchema.safeParse({
            ...VALID_INVOICE,
            slug: 'aB3xQ9k7',
        });
        expect(result.success).toBe(true);
    });

    it('coerces ISO date strings into Date objects', () => {
        const result = InvoiceSchema.safeParse(VALID_INVOICE);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.createdAt).toBeInstanceOf(Date);
            expect(result.data.validUntil).toBeInstanceOf(Date);
        }
    });

    it.each([
        ['abc', 'not 24 hex'],
        ['507f1f77bcf86cd79943902', '23 chars'],
        ['507f1f77bcf86cd79943902z', 'invalid hex char'],
        ['', 'empty'],
    ])('rejects malformed invoice id %s (%s)', (id) => {
        const result = InvoiceSchema.safeParse({ ...VALID_INVOICE, id });
        expect(result.success).toBe(false);
    });

    it('rejects malformed businessId', () => {
        const result = InvoiceSchema.safeParse({
            ...VALID_INVOICE,
            businessId: 'not-an-objectid',
        });
        expect(result.success).toBe(false);
    });

    it('rejects contradictory state amount=null + amountLocked=true', () => {
        const result = InvoiceSchema.safeParse({
            ...VALID_INVOICE,
            amount: null,
            amountLocked: true,
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0]?.message).toBe(
                'AMOUNT_LOCKED_REQUIRES_AMOUNT'
            );
            expect(result.error.issues[0]?.path).toEqual(['amountLocked']);
        }
    });

    it('accepts amount=null + amountLocked=false (signage-mode invoice)', () => {
        const result = InvoiceSchema.safeParse({
            ...VALID_INVOICE,
            amount: null,
            amountLocked: false,
        });
        expect(result.success).toBe(true);
    });

    // -------------------------------------------------------------------------
    // Sprint 2 §2.2 — derive-from-spec length-обмеження paymentPurpose.
    // -------------------------------------------------------------------------

    describe('paymentPurpose — char/byte limits derived from NBU spec', () => {
        it('snapshot нормативу: purpose MIN(002, 003) = 420C / 840B', () => {
            expect(PURPOSE_LIMIT).toEqual({ chars: 420, bytes: 840 });
        });

        it('accepts paymentPurpose точно на межі MIN chars (420 ASCII)', () => {
            const result = InvoiceSchema.safeParse({
                ...VALID_INVOICE,
                paymentPurpose: 'P'.repeat(420),
            });
            expect(result.success).toBe(true);
        });

        it('accepts paymentPurpose MIN-1 chars (419 ASCII)', () => {
            const result = InvoiceSchema.safeParse({
                ...VALID_INVOICE,
                paymentPurpose: 'P'.repeat(419),
            });
            expect(result.success).toBe(true);
        });

        it('rejects paymentPurpose MIN+1 chars → INVALID_PURPOSE_CHAR_LENGTH', () => {
            const result = InvoiceSchema.safeParse({
                ...VALID_INVOICE,
                paymentPurpose: 'P'.repeat(421),
            });
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error.issues[0]?.message).toBe(
                    'INVALID_PURPOSE_CHAR_LENGTH'
                );
            }
        });

        it('rejects paymentPurpose з MIN chars але > MIN bytes → INVALID_PURPOSE_BYTE_LENGTH', () => {
            const cyrillicHeavy = 'P'.repeat(100) + '’'.repeat(320);
            const result = InvoiceSchema.safeParse({
                ...VALID_INVOICE,
                paymentPurpose: cyrillicHeavy,
            });
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error.issues[0]?.message).toBe(
                    'INVALID_PURPOSE_BYTE_LENGTH'
                );
            }
        });

        it('accepts paymentPurpose=null незалежно від limit (інвойс наслідує template)', () => {
            const result = InvoiceSchema.safeParse({
                ...VALID_INVOICE,
                paymentPurpose: null,
            });
            expect(result.success).toBe(true);
        });
    });

    // -------------------------------------------------------------------------
    // Sprint 8 fix — NBU-charset refine. Симетрично з
    // `businessPaymentPurposeTemplateSchema`: до Sprint 8 invoice-render QR
    // падав з 500 на public-сторінці, якщо cabinet-форма пропускала emoji.
    // -------------------------------------------------------------------------

    describe('paymentPurpose — NBU charset refine', () => {
        it('rejects paymentPurpose з emoji → INVALID_PURPOSE_CHARSET', () => {
            const result = InvoiceSchema.safeParse({
                ...VALID_INVOICE,
                paymentPurpose: 'Оплата 🍵',
            });
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(
                    result.error.issues.some(
                        (i) => i.message === 'INVALID_PURPOSE_CHARSET'
                    )
                ).toBe(true);
            }
        });

        it('rejects paymentPurpose з LF (multi-line атака на field-separator)', () => {
            const result = InvoiceSchema.safeParse({
                ...VALID_INVOICE,
                paymentPurpose: 'Оплата\nдодатково',
            });
            expect(result.success).toBe(false);
        });
    });
});

// -----------------------------------------------------------------------------
// Sprint 8 fix — `InvoicePayeeSnapshotSchema.recipientName` reuse
// `businessNameSchema` напряму (раніше — inline `payeeNameSchema`-дублікат).
// Sprint 9 widening — `taxId: payerTaxIdZod` (union RNOKPP ∪ ЄДРПОУ),
// раніше тільки `individualTaxIdZod`. Drift-захист: snapshot kładеться у NBU
// payload через invoice flow, тому має ту саму валідацію, що live business
// (name + taxId).
// -----------------------------------------------------------------------------

describe('InvoicePayeeSnapshotSchema — drift-guard від Business shape', () => {
    const VALID_SNAPSHOT = {
        recipientName: 'Іваненко Олена Петрівна',
        iban: 'UA213223130000026007233566001',
        taxId: '1234567899',
        paymentPurpose: 'Оплата за послуги',
    };

    it('parses valid snapshot з 10-digit RNOKPP', () => {
        const result = InvoicePayeeSnapshotSchema.safeParse(VALID_SNAPSHOT);
        expect(result.success).toBe(true);
    });

    it('Sprint 9 widening — parses snapshot з 8-digit ЄДРПОУ (tov / organization invoice)', () => {
        const result = InvoicePayeeSnapshotSchema.safeParse({
            ...VALID_SNAPSHOT,
            recipientName: 'ТОВ Кав\'ярня',
            taxId: '12345678',
        });
        expect(result.success).toBe(true);
    });

    it('rejects emoji у recipientName → INVALID_NAME_CHARSET (reuse businessNameSchema)', () => {
        const result = InvoicePayeeSnapshotSchema.safeParse({
            ...VALID_SNAPSHOT,
            recipientName: '☕ Кав\'ярня',
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(
                result.error.issues.some(
                    (i) => i.message === 'INVALID_NAME_CHARSET'
                )
            ).toBe(true);
        }
    });

    it('rejects LF у recipientName (multi-line атака — reuse businessNameSchema)', () => {
        const result = InvoicePayeeSnapshotSchema.safeParse({
            ...VALID_SNAPSHOT,
            recipientName: 'Іваненко\nПетро',
        });
        expect(result.success).toBe(false);
    });

    it('rejects emoji у paymentPurpose → INVALID_PURPOSE_CHARSET', () => {
        const result = InvoicePayeeSnapshotSchema.safeParse({
            ...VALID_SNAPSHOT,
            paymentPurpose: 'Оплата 🍵',
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(
                result.error.issues.some(
                    (i) => i.message === 'INVALID_PURPOSE_CHARSET'
                )
            ).toBe(true);
        }
    });

    it('rejects structurally garbage taxId (ні RNOKPP, ні ЄДРПОУ)', () => {
        const result = InvoicePayeeSnapshotSchema.safeParse({
            ...VALID_SNAPSHOT,
            taxId: '1234567', // 7 digits — neither format
        });
        expect(result.success).toBe(false);
    });
});
