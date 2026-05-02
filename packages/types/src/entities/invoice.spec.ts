import { effectiveLimit } from '../qr/limits';
import { InvoiceSchema } from './invoice';

const PURPOSE_LIMIT = effectiveLimit('purpose');

const VALID_INVOICE = {
    id: '507f1f77bcf86cd799439021',
    businessId: '507f1f77bcf86cd799439011',
    slug: 'zamovlennia-147-aB3xQ9k7',
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

    it.each([
        ['short', 'tail-only too short (7 chars)'],
        ['has space-aB3xQ9k7', 'space in human part'],
        ['UPPER-aB3xQ9k7', 'uppercase human part'],
        ['order-aB3xQ9k', 'tail too short (7 chars)'],
        ['order-aB3xQ9k7q', 'tail too long (9 chars)'],
        ['', 'empty string'],
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
});
