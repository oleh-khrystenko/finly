import {
    CreateInvoiceSchema,
    PublicInvoiceSchema,
    SlugInputSchema,
    UpdateInvoiceSchema,
    humanSlugPartSchema,
} from './invoices';

const VALID_IBAN = 'UA213223130000026007233566001';
const VALID_TAX_ID = '1234567899';
void VALID_IBAN;
void VALID_TAX_ID;

describe('humanSlugPartSchema', () => {
    it.each(['invoice', 'inv-001', 'order-2026-may', 'a', '12345', 'a-b-c-d'])(
        'parses valid kebab-case "%s"',
        (slug) => {
            expect(humanSlugPartSchema.safeParse(slug).success).toBe(true);
        }
    );

    it.each([
        ['', 'INVALID_HUMAN_SLUG_PART_LENGTH'],
        ['a'.repeat(61), 'INVALID_HUMAN_SLUG_PART_LENGTH'],
    ])('rejects "%s" with length-error', (input, msg) => {
        const r = humanSlugPartSchema.safeParse(input);
        expect(r.success).toBe(false);
        if (!r.success) {
            expect(r.error.issues.some((i) => i.message === msg)).toBe(true);
        }
    });

    it.each([
        ['Invoice', 'uppercase'],
        ['inv 001', 'space'],
        ['-invoice', 'leading dash'],
        ['invoice-', 'trailing dash'],
        ['inv--oice', 'consecutive dashes'],
        ['ін-войс', 'cyrillic'],
        ['inv_001', 'underscore'],
    ])('rejects "%s" (%s) з format-error', (input) => {
        const r = humanSlugPartSchema.safeParse(input);
        expect(r.success).toBe(false);
        if (!r.success) {
            expect(
                r.error.issues.some(
                    (i) => i.message === 'INVALID_HUMAN_SLUG_PART_FORMAT'
                )
            ).toBe(true);
        }
    });
});

describe('SlugInputSchema (discriminated union)', () => {
    it('parses kind=explicit з валідним humanPart', () => {
        const r = SlugInputSchema.safeParse({
            kind: 'explicit',
            humanPart: 'inv-2026',
        });
        expect(r.success).toBe(true);
    });

    it('rejects kind=explicit з невалідним humanPart (uppercase)', () => {
        const r = SlugInputSchema.safeParse({
            kind: 'explicit',
            humanPart: 'INV-001',
        });
        expect(r.success).toBe(false);
    });

    it('parses kind=preset для всіх 4 пресетів', () => {
        for (const preset of [
            'simple',
            'with-month',
            'with-year',
            'with-purpose',
        ] as const) {
            const r = SlugInputSchema.safeParse({ kind: 'preset', preset });
            expect(r.success).toBe(true);
        }
    });

    it('rejects kind=preset з невідомим preset', () => {
        const r = SlugInputSchema.safeParse({
            kind: 'preset',
            preset: 'unknown',
        });
        expect(r.success).toBe(false);
    });

    it('parses kind=random без додаткових полів', () => {
        const r = SlugInputSchema.safeParse({ kind: 'random' });
        expect(r.success).toBe(true);
    });

    it('rejects unknown kind', () => {
        const r = SlugInputSchema.safeParse({ kind: 'vanity' });
        expect(r.success).toBe(false);
    });

    it('rejects extra fields у kind=random (strict)', () => {
        const r = SlugInputSchema.safeParse({
            kind: 'random',
            humanPart: 'leak',
        });
        expect(r.success).toBe(false);
    });

    it('rejects extra fields у kind=preset (strict)', () => {
        const r = SlugInputSchema.safeParse({
            kind: 'preset',
            preset: 'simple',
            humanPart: 'leak',
        });
        expect(r.success).toBe(false);
    });

    it('rejects mixed-state (explicit + preset key)', () => {
        // Discriminated union відсікає крос-стан "обидва kind-варіанти".
        const r = SlugInputSchema.safeParse({
            kind: 'explicit',
            humanPart: 'invoice',
            preset: 'simple',
        });
        expect(r.success).toBe(false);
    });
});

const VALID_CREATE = {
    amount: 150_000,
    amountLocked: true,
    paymentPurpose: 'Оплата за послуги',
    validUntil: '2026-12-31T23:59:59.000Z',
    slugInput: { kind: 'preset' as const, preset: 'simple' as const },
};

describe('CreateInvoiceSchema', () => {
    it('parses valid full payload', () => {
        const r = CreateInvoiceSchema.safeParse(VALID_CREATE);
        expect(r.success).toBe(true);
    });

    it('parses amount=null + amountLocked=false (signage mode)', () => {
        const r = CreateInvoiceSchema.safeParse({
            ...VALID_CREATE,
            amount: null,
            amountLocked: false,
        });
        expect(r.success).toBe(true);
    });

    it('rejects amount=null + amountLocked=true (coupled-rule)', () => {
        const r = CreateInvoiceSchema.safeParse({
            ...VALID_CREATE,
            amount: null,
            amountLocked: true,
        });
        expect(r.success).toBe(false);
        if (!r.success) {
            expect(
                r.error.issues.some(
                    (i) => i.message === 'AMOUNT_LOCKED_REQUIRES_AMOUNT'
                )
            ).toBe(true);
        }
    });

    it('parses paymentPurpose=null (inheritance signal)', () => {
        const r = CreateInvoiceSchema.safeParse({
            ...VALID_CREATE,
            paymentPurpose: null,
        });
        expect(r.success).toBe(true);
    });

    it('parses validUntil=null (без терміну)', () => {
        const r = CreateInvoiceSchema.safeParse({
            ...VALID_CREATE,
            validUntil: null,
        });
        expect(r.success).toBe(true);
    });

    it('coerce.date парсить ISO-string у Date', () => {
        const r = CreateInvoiceSchema.safeParse(VALID_CREATE);
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.validUntil).toBeInstanceOf(Date);
    });

    it('rejects extra fields (.strict)', () => {
        const r = CreateInvoiceSchema.safeParse({
            ...VALID_CREATE,
            slug: 'manual-injected', // спроба прокинути pre-built slug
        });
        expect(r.success).toBe(false);
    });

    it('rejects amount overflow', () => {
        const r = CreateInvoiceSchema.safeParse({
            ...VALID_CREATE,
            amount: 99_999_999_999 + 1,
        });
        expect(r.success).toBe(false);
    });

    it('rejects negative amount', () => {
        const r = CreateInvoiceSchema.safeParse({
            ...VALID_CREATE,
            amount: -100,
        });
        expect(r.success).toBe(false);
    });

    it('rejects non-integer amount (копійки — int)', () => {
        const r = CreateInvoiceSchema.safeParse({
            ...VALID_CREATE,
            amount: 1500.5,
        });
        expect(r.success).toBe(false);
    });

    it('parses всі 3 варіанти slugInput', () => {
        for (const slugInput of [
            { kind: 'explicit' as const, humanPart: 'order-2026' },
            { kind: 'preset' as const, preset: 'with-year' as const },
            { kind: 'random' as const },
        ]) {
            const r = CreateInvoiceSchema.safeParse({
                ...VALID_CREATE,
                slugInput,
            });
            expect(r.success).toBe(true);
        }
    });
});

describe('UpdateInvoiceSchema', () => {
    it('parses partial update з одним полем', () => {
        const r = UpdateInvoiceSchema.safeParse({ amount: 250_000 });
        expect(r.success).toBe(true);
    });

    it('parses пустий object (ніби no-op patch — Zod дозволяє)', () => {
        const r = UpdateInvoiceSchema.safeParse({});
        expect(r.success).toBe(true);
    });

    it.each(['slug', 'slugPreset', 'businessId', 'createdAt'])(
        'rejects extra field "%s" (.strict)',
        (field) => {
            const r = UpdateInvoiceSchema.safeParse({ [field]: 'x' });
            expect(r.success).toBe(false);
        }
    );

    it('coupled-refine активний коли передані ОБА (amount + amountLocked)', () => {
        const r = UpdateInvoiceSchema.safeParse({
            amount: null,
            amountLocked: true,
        });
        expect(r.success).toBe(false);
    });

    it('coupled-refine НЕ активний коли передано тільки amountLocked', () => {
        // Inline-edit: ФОП міняє лише amountLocked; service-layer перевірить
        // пару проти БД.
        const r = UpdateInvoiceSchema.safeParse({ amountLocked: true });
        expect(r.success).toBe(true);
    });

    it('coupled-refine НЕ активний коли передано тільки amount', () => {
        const r = UpdateInvoiceSchema.safeParse({ amount: null });
        expect(r.success).toBe(true);
    });
});

describe('PublicInvoiceSchema (whitelist invariant)', () => {
    const VALID_PUBLIC = {
        amount: 150_000,
        amountLocked: true,
        paymentPurpose: 'Оплата',
        validUntil: '2026-12-31T23:59:59.000Z',
        slug: 'inv-001-aB3xQ9k7',
        business: {
            type: 'fop' as const,
            name: 'Іваненко',
            slug: 'IvanEnko',
            acceptedBanks: ['privatbank', 'monobank'] as const,
        },
        nbuLinks: {
            primary: 'https://qr.bank.gov.ua/payload',
            legacy: 'https://bank.gov.ua/qr/payload',
        },
    };

    it('parses valid view', () => {
        const r = PublicInvoiceSchema.safeParse(VALID_PUBLIC);
        expect(r.success).toBe(true);
    });

    it('whitelist: strip extra leak-кандидатів через `.parse` (без `.strict()`)', () => {
        // Zod default (без .strict) робить strip, не reject — це і є whitelist
        // механіка: нові leak-поля у БД тихо випадають з response.
        const result = PublicInvoiceSchema.parse({
            ...VALID_PUBLIC,
            // Спроба leak-нути:
            requisites: { iban: VALID_IBAN, taxId: VALID_TAX_ID },
            taxationSystem: 'simplified-3',
            isVatPayer: false,
            ownerId: '507f1f77bcf86cd799439012',
            slugPreset: 'simple',
            createdAt: '2026-05-01T10:00:00.000Z',
        });
        expect(result).not.toHaveProperty('requisites');
        expect(result).not.toHaveProperty('taxationSystem');
        expect(result).not.toHaveProperty('isVatPayer');
        expect(result).not.toHaveProperty('ownerId');
        expect(result).not.toHaveProperty('slugPreset');
        expect(result).not.toHaveProperty('createdAt');
    });

    it('nested business — теж whitelist (без leak-полів)', () => {
        const result = PublicInvoiceSchema.parse({
            ...VALID_PUBLIC,
            business: {
                ...VALID_PUBLIC.business,
                requisites: { iban: VALID_IBAN, taxId: VALID_TAX_ID },
                ownerId: '507f1f77bcf86cd799439012',
                managers: [],
                slugLower: 'ivanenko',
                taxationSystem: 'simplified-3',
                isVatPayer: false,
                paymentPurposeTemplate: 'Оплата',
                seoIndexEnabled: false,
            },
        });
        expect(result.business).not.toHaveProperty('requisites');
        expect(result.business).not.toHaveProperty('ownerId');
        expect(result.business).not.toHaveProperty('managers');
        expect(result.business).not.toHaveProperty('slugLower');
        expect(result.business).not.toHaveProperty('taxationSystem');
        expect(result.business).not.toHaveProperty('isVatPayer');
        expect(result.business).not.toHaveProperty('paymentPurposeTemplate');
        expect(result.business).not.toHaveProperty('seoIndexEnabled');
    });

    it('rejects invalid nbuLinks URL', () => {
        const r = PublicInvoiceSchema.safeParse({
            ...VALID_PUBLIC,
            nbuLinks: { primary: 'not-a-url', legacy: 'also-bad' },
        });
        expect(r.success).toBe(false);
    });

    it('accepts nbuLinks=null (server-side expiry block)', () => {
        // Sprint 4 review fix: backend ставить `nbuLinks: null` коли
        // `validUntil < now` — payment-vector не віддається після терміну.
        const r = PublicInvoiceSchema.safeParse({
            ...VALID_PUBLIC,
            nbuLinks: null,
        });
        expect(r.success).toBe(true);
    });
});
