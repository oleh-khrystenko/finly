import {
    AccountWithCountsSchema,
    CreateAccountSchema,
    PublicAccountListItemSchema,
    PublicAccountViewSchema,
    UpdateAccountSchema,
} from './accounts';

const VALID_IBAN = 'UA213223130000026007233566001';

describe('CreateAccountSchema', () => {
    it('parses minimal payload (iban only)', () => {
        const r = CreateAccountSchema.safeParse({ iban: VALID_IBAN });
        expect(r.success).toBe(true);
    });

    it('parses payload з optional name', () => {
        const r = CreateAccountSchema.safeParse({
            iban: VALID_IBAN,
            name: 'Основний рахунок',
        });
        expect(r.success).toBe(true);
    });

    it('rejects invalid IBAN', () => {
        const r = CreateAccountSchema.safeParse({
            iban: 'UA00000000000000000000000000',
        });
        expect(r.success).toBe(false);
    });

    it.each([
        'slug',
        'bankCode',
        'businessId',
        'invoiceSlugPresetDefault',
        'createdAt',
        'id',
    ])('rejects невідомий ключ %s через .strict()', (key) => {
        const r = CreateAccountSchema.safeParse({
            iban: VALID_IBAN,
            [key]: 'leak',
        });
        expect(r.success).toBe(false);
    });

    it('rejects empty name (passes through accountNameSchema)', () => {
        const r = CreateAccountSchema.safeParse({
            iban: VALID_IBAN,
            name: '',
        });
        expect(r.success).toBe(false);
    });

    it('rejects emoji у name (NBU charset)', () => {
        const r = CreateAccountSchema.safeParse({
            iban: VALID_IBAN,
            name: '☕ Кав\'ярня',
        });
        expect(r.success).toBe(false);
    });
});

describe('UpdateAccountSchema', () => {
    it('accepts empty object (no-op partial)', () => {
        const r = UpdateAccountSchema.safeParse({});
        expect(r.success).toBe(true);
    });

    it('accepts name-only update', () => {
        const r = UpdateAccountSchema.safeParse({ name: 'Новий' });
        expect(r.success).toBe(true);
    });

    it('accepts slug update (Sprint 15 editable vanity)', () => {
        const r = UpdateAccountSchema.safeParse({ slug: 'mono-cafe' });
        expect(r.success).toBe(true);
    });

    it.each(['simple', 'with-month', 'with-year', 'with-purpose'])(
        'accepts invoiceSlugPresetDefault=%s update',
        (preset) => {
            const r = UpdateAccountSchema.safeParse({
                invoiceSlugPresetDefault: preset,
            });
            expect(r.success).toBe(true);
        }
    );

    it('accepts invoiceSlugPresetDefault=null (clear preference)', () => {
        const r = UpdateAccountSchema.safeParse({
            invoiceSlugPresetDefault: null,
        });
        expect(r.success).toBe(true);
    });

    // Sprint 15 — `slug` став editable vanity-string, тож більше не у
    // immutable-списку (перевіряється у тесті accepts slug-update нижче).
    it.each(['iban', 'businessId', 'bankCode', 'id', 'createdAt'])(
        'rejects immutable field %s через .strict()',
        (field) => {
            const r = UpdateAccountSchema.safeParse({ [field]: 'whatever' });
            expect(r.success).toBe(false);
        }
    );

    it('rejects невалідний preset value', () => {
        const r = UpdateAccountSchema.safeParse({
            invoiceSlugPresetDefault: 'unknown-preset',
        });
        expect(r.success).toBe(false);
    });
});

describe('PublicAccountListItemSchema', () => {
    const VALID_ITEM = {
        slug: 'aB3xQ9k7',
        name: 'ПриватБанк •6001',
        bankCode: 'privatbank' as const,
        ibanMask: '•6001',
    };

    it('parses valid item', () => {
        expect(PublicAccountListItemSchema.safeParse(VALID_ITEM).success).toBe(
            true
        );
    });

    it('parses null bankCode (§SP-9 нерозпізнаний МФО)', () => {
        const r = PublicAccountListItemSchema.safeParse({
            ...VALID_ITEM,
            bankCode: null,
            name: 'Банк •6001',
        });
        expect(r.success).toBe(true);
    });

    it('whitelist: strip extra leak-кандидатів', () => {
        const result = PublicAccountListItemSchema.parse({
            ...VALID_ITEM,
            iban: VALID_IBAN, // leak attempt
            businessId: '507f1f77bcf86cd799439011',
            createdAt: '2026-05-01T10:00:00.000Z',
        });
        expect(result).not.toHaveProperty('iban');
        expect(result).not.toHaveProperty('businessId');
        expect(result).not.toHaveProperty('createdAt');
    });

    it.each([
        ['6001', 'missing bullet'],
        ['•60019', '5 digits'],
        ['•abc1', 'non-digit chars'],
        ['', 'empty'],
        ['◦6001', 'wrong bullet char'],
    ])('rejects malformed ibanMask "%s" (%s)', (ibanMask) => {
        const r = PublicAccountListItemSchema.safeParse({
            ...VALID_ITEM,
            ibanMask,
        });
        expect(r.success).toBe(false);
    });
});

describe('PublicAccountViewSchema', () => {
    const VALID_VIEW = {
        slug: 'aB3xQ9k7',
        name: 'ПриватБанк •6001',
        bankCode: 'privatbank' as const,
        ibanMask: '•6001',
        business: {
            type: 'fop' as const,
            name: 'Іваненко',
            slug: 'IvanEnko',
            seoIndexEnabled: true,
        },
        nbuLinks: {
            primary: 'https://qr.bank.gov.ua/payload',
            legacy: 'https://bank.gov.ua/qr/payload',
        },
    };

    it('parses valid view', () => {
        const r = PublicAccountViewSchema.safeParse(VALID_VIEW);
        expect(r.success).toBe(true);
    });

    it('parses null bankCode у view', () => {
        const r = PublicAccountViewSchema.safeParse({
            ...VALID_VIEW,
            bankCode: null,
            name: 'Банк •6001',
        });
        expect(r.success).toBe(true);
    });

    it('whitelist: strip leak-кандидатів у top-level', () => {
        const result = PublicAccountViewSchema.parse({
            ...VALID_VIEW,
            iban: VALID_IBAN,
            businessId: '507f1f77bcf86cd799439011',
            createdAt: '2026-05-01T10:00:00.000Z',
            invoiceSlugPresetDefault: 'simple',
        });
        expect(result).not.toHaveProperty('iban');
        expect(result).not.toHaveProperty('businessId');
        expect(result).not.toHaveProperty('createdAt');
        expect(result).not.toHaveProperty('invoiceSlugPresetDefault');
    });

    it('whitelist: strip leak-кандидатів у nested business', () => {
        const result = PublicAccountViewSchema.parse({
            ...VALID_VIEW,
            business: {
                ...VALID_VIEW.business,
                taxId: '1234567899',
                ownerId: '507f1f77bcf86cd799439012',
                managers: [],
                slugLower: 'ivanenko',
                taxationSystem: 'simplified-3',
                isVatPayer: false,
                paymentPurposeTemplate: 'Оплата',
            },
        });
        expect(result.business).not.toHaveProperty('taxId');
        expect(result.business).not.toHaveProperty('ownerId');
        expect(result.business).not.toHaveProperty('managers');
        expect(result.business).not.toHaveProperty('slugLower');
        expect(result.business).not.toHaveProperty('taxationSystem');
        expect(result.business).not.toHaveProperty('isVatPayer');
        expect(result.business).not.toHaveProperty('paymentPurposeTemplate');
    });

    it('rejects invalid nbuLinks URL', () => {
        const r = PublicAccountViewSchema.safeParse({
            ...VALID_VIEW,
            nbuLinks: { primary: 'not-a-url', legacy: 'also-bad' },
        });
        expect(r.success).toBe(false);
    });
});

describe('AccountWithCountsSchema', () => {
    const VALID_WITH_COUNTS = {
        id: '507f1f77bcf86cd799439031',
        businessId: '507f1f77bcf86cd799439011',
        iban: VALID_IBAN,
        name: 'ПриватБанк •6001',
        slug: 'aB3xQ9k7',
        slugLower: 'ab3xq9k7',
        bankCode: 'privatbank' as const,
        invoiceSlugPresetDefault: null,
        deletedAt: null,
        createdAt: '2026-05-01T10:00:00.000Z',
        updatedAt: '2026-05-01T10:00:00.000Z',
        invoicesCount: 5,
    };

    it('parses valid AccountWithCounts', () => {
        expect(
            AccountWithCountsSchema.safeParse(VALID_WITH_COUNTS).success
        ).toBe(true);
    });

    it('accepts invoicesCount=0', () => {
        const r = AccountWithCountsSchema.safeParse({
            ...VALID_WITH_COUNTS,
            invoicesCount: 0,
        });
        expect(r.success).toBe(true);
    });

    it('rejects negative invoicesCount', () => {
        const r = AccountWithCountsSchema.safeParse({
            ...VALID_WITH_COUNTS,
            invoicesCount: -1,
        });
        expect(r.success).toBe(false);
    });

    it('rejects fractional invoicesCount', () => {
        const r = AccountWithCountsSchema.safeParse({
            ...VALID_WITH_COUNTS,
            invoicesCount: 1.5,
        });
        expect(r.success).toBe(false);
    });
});
