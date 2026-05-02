import { effectiveLimit } from '../qr/limits';
import { BusinessSchema } from './business';

const NAME_LIMIT = effectiveLimit('receiverName');
const PURPOSE_LIMIT = effectiveLimit('purpose');

const VALID_IBAN = 'UA213223130000026007233566001';
const VALID_TAX_ID = '1234567899';

const VALID_BUSINESS = {
    id: '507f1f77bcf86cd799439011',
    type: 'fop',
    ownerId: '507f1f77bcf86cd799439012',
    managers: [],
    slug: 'ivanenko-fop',
    name: 'Іваненко',
    requisites: { iban: VALID_IBAN, taxId: VALID_TAX_ID },
    paymentPurposeTemplate: 'Оплата за послуги',
    acceptedBanks: ['privatbank', 'monobank'],
    deletedAt: null,
    createdAt: '2026-05-01T10:00:00.000Z',
    updatedAt: '2026-05-01T10:00:00.000Z',
};

describe('BusinessSchema', () => {
    it('parses a valid owned business', () => {
        const result = BusinessSchema.safeParse(VALID_BUSINESS);
        expect(result.success).toBe(true);
    });

    it('parses a valid ownerless business with at least one manager', () => {
        const result = BusinessSchema.safeParse({
            ...VALID_BUSINESS,
            ownerId: null,
            managers: ['507f1f77bcf86cd799439099'],
        });
        expect(result.success).toBe(true);
    });

    it('rejects ownerless business with empty managers array', () => {
        const result = BusinessSchema.safeParse({
            ...VALID_BUSINESS,
            ownerId: null,
            managers: [],
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0]?.message).toBe(
                'OWNERLESS_BUSINESS_REQUIRES_MANAGER'
            );
        }
    });

    it('rejects unknown business type', () => {
        const result = BusinessSchema.safeParse({
            ...VALID_BUSINESS,
            type: 'tov',
        });
        expect(result.success).toBe(false);
    });

    it('rejects unknown bank code in acceptedBanks', () => {
        const result = BusinessSchema.safeParse({
            ...VALID_BUSINESS,
            acceptedBanks: ['privatbank', 'unknown_bank'],
        });
        expect(result.success).toBe(false);
    });

    it('rejects invalid IBAN inside requisites', () => {
        const result = BusinessSchema.safeParse({
            ...VALID_BUSINESS,
            requisites: { iban: 'UA00000000000000000000000000', taxId: VALID_TAX_ID },
        });
        expect(result.success).toBe(false);
    });

    it('rejects invalid IPN (tax-id) inside requisites', () => {
        const result = BusinessSchema.safeParse({
            ...VALID_BUSINESS,
            requisites: { iban: VALID_IBAN, taxId: '1234567890' },
        });
        expect(result.success).toBe(false);
    });

    it.each([
        '-leading-dash',
        'trailing-dash-',
        'UPPERCASE',
        'has space',
        'has--double-dash',
        'ab',
    ])('rejects malformed slug %s', (slug) => {
        const result = BusinessSchema.safeParse({ ...VALID_BUSINESS, slug });
        expect(result.success).toBe(false);
    });

    it('coerces ISO date strings into Date objects on createdAt', () => {
        const result = BusinessSchema.safeParse(VALID_BUSINESS);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.createdAt).toBeInstanceOf(Date);
        }
    });

    it.each([
        ['abc', 'not 24 hex'],
        ['507f1f77bcf86cd79943901', '23 chars'],
        ['507f1f77bcf86cd7994390111', '25 chars'],
        ['507f1f77bcf86cd79943901z', 'invalid hex char'],
        ['', 'empty'],
    ])('rejects malformed business id %s (%s)', (id) => {
        const result = BusinessSchema.safeParse({ ...VALID_BUSINESS, id });
        expect(result.success).toBe(false);
    });

    it('rejects malformed ownerId', () => {
        const result = BusinessSchema.safeParse({
            ...VALID_BUSINESS,
            ownerId: 'not-an-objectid',
        });
        expect(result.success).toBe(false);
    });

    it('rejects malformed manager ObjectId in managers array', () => {
        const result = BusinessSchema.safeParse({
            ...VALID_BUSINESS,
            ownerId: null,
            managers: ['507f1f77bcf86cd799439099', 'invalid-id'],
        });
        expect(result.success).toBe(false);
    });

    // -------------------------------------------------------------------------
    // Sprint 2 §2.2 — derive-from-spec length-обмеження для name та
    // paymentPurposeTemplate. MIN по PAYLOAD_VERSIONS гарантує, що збережений
    // Business завжди може згенерувати валідний QR для будь-якої з версій.
    // -------------------------------------------------------------------------

    describe('name — char/byte limits derived from NBU spec', () => {
        it('snapshot нормативу: receiverName MIN(002, 003) = 140C / 280B', () => {
            // Якщо PDF постанови оновиться — цей snapshot впаде, не дасть
            // мовчазно пропустити зміну в FIELD_LIMITS.
            expect(NAME_LIMIT).toEqual({ chars: 140, bytes: 280 });
        });

        it('accepts name точно на межі MIN chars (140 ASCII)', () => {
            const result = BusinessSchema.safeParse({
                ...VALID_BUSINESS,
                name: 'A'.repeat(140),
            });
            expect(result.success).toBe(true);
        });

        it('accepts name MIN-1 chars (139 ASCII)', () => {
            const result = BusinessSchema.safeParse({
                ...VALID_BUSINESS,
                name: 'A'.repeat(139),
            });
            expect(result.success).toBe(true);
        });

        it('rejects name MIN+1 chars (141 ASCII) → INVALID_NAME_CHAR_LENGTH', () => {
            const result = BusinessSchema.safeParse({
                ...VALID_BUSINESS,
                name: 'A'.repeat(141),
            });
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error.issues[0]?.message).toBe(
                    'INVALID_NAME_CHAR_LENGTH'
                );
            }
        });

        it('rejects name з MIN chars але > MIN bytes (cyrillic-heavy) → INVALID_NAME_BYTE_LENGTH', () => {
            // 50 ASCII (50 B) + 90 апострофів U+2019 (3 B/char × 90 = 270 B)
            // = 140 chars, 320 bytes. CHARS-OK, BYTES-overflow.
            const cyrillicHeavy = 'A'.repeat(50) + '’'.repeat(90);
            const result = BusinessSchema.safeParse({
                ...VALID_BUSINESS,
                name: cyrillicHeavy,
            });
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error.issues[0]?.message).toBe(
                    'INVALID_NAME_BYTE_LENGTH'
                );
            }
        });

        it('accepts cyrillic name MIN chars / MIN bytes (140C × 2B = 280B exact)', () => {
            // 140 cyrillic chars × 2 B = 280 B — точно на межі.
            const result = BusinessSchema.safeParse({
                ...VALID_BUSINESS,
                name: 'А'.repeat(140),
            });
            expect(result.success).toBe(true);
        });
    });

    describe('paymentPurposeTemplate — char/byte limits derived from NBU spec', () => {
        it('snapshot нормативу: purpose MIN(002, 003) = 420C / 840B', () => {
            expect(PURPOSE_LIMIT).toEqual({ chars: 420, bytes: 840 });
        });

        it('accepts purpose точно на межі MIN chars (420 ASCII)', () => {
            const result = BusinessSchema.safeParse({
                ...VALID_BUSINESS,
                paymentPurposeTemplate: 'P'.repeat(420),
            });
            expect(result.success).toBe(true);
        });

        it('rejects purpose MIN+1 chars (421 ASCII) → INVALID_PURPOSE_CHAR_LENGTH', () => {
            const result = BusinessSchema.safeParse({
                ...VALID_BUSINESS,
                paymentPurposeTemplate: 'P'.repeat(421),
            });
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error.issues[0]?.message).toBe(
                    'INVALID_PURPOSE_CHAR_LENGTH'
                );
            }
        });

        it('rejects purpose з MIN chars але > MIN bytes → INVALID_PURPOSE_BYTE_LENGTH', () => {
            // 100 ASCII (100 B) + 320 апострофів U+2019 (960 B) = 420 chars, 1060 bytes.
            const cyrillicHeavy = 'P'.repeat(100) + '’'.repeat(320);
            const result = BusinessSchema.safeParse({
                ...VALID_BUSINESS,
                paymentPurposeTemplate: cyrillicHeavy,
            });
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.error.issues[0]?.message).toBe(
                    'INVALID_PURPOSE_BYTE_LENGTH'
                );
            }
        });
    });
});
