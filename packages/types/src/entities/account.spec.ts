import { AccountSchema, accountNameSchema, accountSlugSchema } from './account';

const VALID_ACCOUNT = {
    id: '507f1f77bcf86cd799439031',
    businessId: '507f1f77bcf86cd799439011',
    iban: 'UA213223130000026007233566001',
    name: 'ПриватБанк •6001',
    slug: 'aB3xQ9k7',
    slugLower: 'ab3xq9k7',
    bankCode: 'privatbank' as const,
    invoiceSlugPresetDefault: null,
    deletedAt: null,
    createdAt: '2026-05-01T10:00:00.000Z',
    updatedAt: '2026-05-01T10:00:00.000Z',
};

describe('AccountSchema', () => {
    it('parses a valid account', () => {
        const result = AccountSchema.safeParse(VALID_ACCOUNT);
        expect(result.success).toBe(true);
    });

    it('parses account з null bankCode (§SP-9 нерозпізнаний МФО)', () => {
        const result = AccountSchema.safeParse({
            ...VALID_ACCOUNT,
            bankCode: null,
            name: 'Банк •6001',
        });
        expect(result.success).toBe(true);
    });

    it.each([
        ['simple', null],
        ['with-month', 'simple' as const],
        ['with-year', 'with-year' as const],
        ['with-purpose', 'with-purpose' as const],
    ])('accepts invoiceSlugPresetDefault %s', (_label, value) => {
        const result = AccountSchema.safeParse({
            ...VALID_ACCOUNT,
            invoiceSlugPresetDefault: value,
        });
        expect(result.success).toBe(true);
    });

    it('applies default null для invoiceSlugPresetDefault (missing field на existing doc)', () => {
        // Документ із БД без поля (Sprint 9 deploy на чисту БД, але dev-environment
        // може мати legacy-документи) — Zod entity з `.default(null)` парсить як null.
        const { invoiceSlugPresetDefault: _omit, ...without } = VALID_ACCOUNT;
        void _omit;
        const result = AccountSchema.safeParse(without);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.invoiceSlugPresetDefault).toBeNull();
        }
    });

    it('rejects invalid IBAN (checksum fail)', () => {
        const result = AccountSchema.safeParse({
            ...VALID_ACCOUNT,
            iban: 'UA00000000000000000000000000',
        });
        expect(result.success).toBe(false);
    });

    it('rejects unknown bankCode value', () => {
        const result = AccountSchema.safeParse({
            ...VALID_ACCOUNT,
            bankCode: 'mythical_bank',
        });
        expect(result.success).toBe(false);
    });

    it('coerces ISO date strings into Date objects', () => {
        const result = AccountSchema.safeParse(VALID_ACCOUNT);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.createdAt).toBeInstanceOf(Date);
            expect(result.data.updatedAt).toBeInstanceOf(Date);
        }
    });

    it.each([
        ['abc', 'not 24 hex'],
        ['507f1f77bcf86cd79943903', '23 chars'],
        ['507f1f77bcf86cd79943903z', 'invalid hex char'],
        ['', 'empty'],
    ])('rejects malformed account id %s (%s)', (id) => {
        const result = AccountSchema.safeParse({ ...VALID_ACCOUNT, id });
        expect(result.success).toBe(false);
    });

    it('rejects malformed businessId', () => {
        const result = AccountSchema.safeParse({
            ...VALID_ACCOUNT,
            businessId: 'not-an-objectid',
        });
        expect(result.success).toBe(false);
    });
});

describe('accountNameSchema', () => {
    it('parses valid auto-default-style name', () => {
        const result = accountNameSchema.safeParse('ПриватБанк •2580');
        expect(result.success).toBe(true);
    });

    it('parses user-chosen name (Cyrillic)', () => {
        const result = accountNameSchema.safeParse('Основний рахунок');
        expect(result.success).toBe(true);
    });

    it('rejects empty name → INVALID_ACCOUNT_NAME_REQUIRED', () => {
        const result = accountNameSchema.safeParse('');
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(
                result.error.issues.some(
                    (i) => i.message === 'INVALID_ACCOUNT_NAME_REQUIRED'
                )
            ).toBe(true);
        }
    });

    it('rejects whitespace-only name (trim → empty)', () => {
        const result = accountNameSchema.safeParse('   ');
        expect(result.success).toBe(false);
    });

    it('accepts name точно на межі 60 chars', () => {
        const result = accountNameSchema.safeParse('A'.repeat(60));
        expect(result.success).toBe(true);
    });

    it('rejects name 61 chars → INVALID_ACCOUNT_NAME_CHAR_LENGTH', () => {
        const result = accountNameSchema.safeParse('A'.repeat(61));
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(
                result.error.issues.some(
                    (i) => i.message === 'INVALID_ACCOUNT_NAME_CHAR_LENGTH'
                )
            ).toBe(true);
        }
    });

    it('rejects name з emoji → INVALID_ACCOUNT_NAME_CHARSET (NBU charset)', () => {
        const result = accountNameSchema.safeParse('☕ Кав\'ярня');
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(
                result.error.issues.some(
                    (i) => i.message === 'INVALID_ACCOUNT_NAME_CHARSET'
                )
            ).toBe(true);
        }
    });

    it('rejects name з LF', () => {
        const result = accountNameSchema.safeParse('Account\nname');
        expect(result.success).toBe(false);
    });

    it('rejects cyrillic name 60 chars але > 120 bytes', () => {
        // 30 ASCII (30 B) + 30 апострофів U+2019 (3 B each = 90 B) = 60 chars, 120 B — exact.
        // Add one more cyrillic: 31 cyrillic (62 B) + 29 ASCII (29 B) = 60 chars, 91 B — OK.
        // Need overflow: 50 ASCII (50 B) + 10 U+2019 (30 B) = 60 chars, 80 B — OK.
        // To overflow 120 bytes у 60 chars: треба > 2 B/char average → use 3 B/char U+2019.
        // 60 chars × 3 B = 180 B → overflow.
        const result = accountNameSchema.safeParse('’'.repeat(60));
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(
                result.error.issues.some(
                    (i) => i.message === 'INVALID_ACCOUNT_NAME_BYTE_LENGTH'
                )
            ).toBe(true);
        }
    });
});

describe('accountSlugSchema', () => {
    // Sprint 15 — slug став редаговуваним vanity-string 3-63 chars (дзеркало
    // businessSlugSchema), а не immutable 8-char tail. Дефіс — валідний
    // роздільник між alphanumeric-сегментами.
    it.each([
        'aB3xQ9k7',
        'ABCDEFGH',
        '12345678',
        'a1b2c3d4',
        'mono-cafe',
        'aB3xQ-k7',
        'abc',
    ])('parses valid alphanum slug "%s"', (slug) => {
        expect(accountSlugSchema.safeParse(slug).success).toBe(true);
    });

    it.each([
        ['ab', 'too short (2 chars)', 'INVALID_SLUG_TOO_SHORT'],
        ['', 'empty', 'INVALID_SLUG_TOO_SHORT'],
        ['a'.repeat(64), 'too long (64 chars)', 'INVALID_SLUG_TOO_LONG'],
        ['aB3xQ_k7', 'underscore', 'INVALID_SLUG_FORMAT'],
        ['aB3xQ k7', 'space', 'INVALID_SLUG_FORMAT'],
        ['aB3xQ.k7', 'dot', 'INVALID_SLUG_FORMAT'],
        ['aB3xQ9к7', 'cyrillic char', 'INVALID_SLUG_FORMAT'],
        ['-abc', 'leading dash', 'INVALID_SLUG_FORMAT'],
        ['abc-', 'trailing dash', 'INVALID_SLUG_FORMAT'],
    ])('rejects "%s" (%s)', (slug, _desc, code) => {
        const r = accountSlugSchema.safeParse(slug);
        expect(r.success).toBe(false);
        if (!r.success) {
            expect(r.error.issues.some((i) => i.message === code)).toBe(true);
        }
    });

    it('respects case-sensitivity (§SP-10) — different-case slugs are different values', () => {
        // accountSlugSchema лише структурно валідує regex; uniqueness — Mongoose.
        // Тест демонструє, що обидва slug-и проходять окремо: різні строки → різні Zod outputs.
        const lower = accountSlugSchema.safeParse('abc12345');
        const upper = accountSlugSchema.safeParse('ABC12345');
        expect(lower.success).toBe(true);
        expect(upper.success).toBe(true);
        if (lower.success && upper.success) {
            expect(lower.data).not.toBe(upper.data);
        }
    });
});
