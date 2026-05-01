import { BusinessSchema } from './business';

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
});
