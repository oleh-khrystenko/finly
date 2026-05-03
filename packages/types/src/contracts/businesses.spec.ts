import {
    CreateBusinessSchema,
    PublicBusinessSchema,
    UpdateBusinessSchema,
} from './businesses';

const VALID_IBAN = 'UA213223130000026007233566001';
const VALID_TAX_ID = '1234567899';

const VALID_CREATE = {
    type: 'fop',
    name: 'Іваненко',
    requisites: { iban: VALID_IBAN, taxId: VALID_TAX_ID },
    taxationSystem: 'simplified-3',
    isVatPayer: false,
    paymentPurposeTemplate: 'Оплата за послуги',
    acceptedBanks: ['privatbank', 'monobank'],
};

describe('CreateBusinessSchema', () => {
    it('parses valid full payload', () => {
        const result = CreateBusinessSchema.safeParse(VALID_CREATE);
        expect(result.success).toBe(true);
    });

    it.each([
        'name',
        'requisites',
        'taxationSystem',
        'isVatPayer',
        'paymentPurposeTemplate',
        'acceptedBanks',
        'type',
    ])('rejects payload з відсутнім полем %s', (field) => {
        const { [field]: _omit, ...without } = VALID_CREATE as Record<
            string,
            unknown
        >;
        void _omit;
        const result = CreateBusinessSchema.safeParse(without);
        expect(result.success).toBe(false);
    });

    it('rejects empty acceptedBanks (мінімум 1 — рішення B6)', () => {
        const result = CreateBusinessSchema.safeParse({
            ...VALID_CREATE,
            acceptedBanks: [],
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(
                result.error.issues.some(
                    (i) => i.message === 'ACCEPTED_BANKS_REQUIRED'
                )
            ).toBe(true);
        }
    });

    it.each(['simplified-1', 'simplified-2'] as const)(
        'rejects isVatPayer=true з taxationSystem=%s (coupled C1)',
        (taxationSystem) => {
            const result = CreateBusinessSchema.safeParse({
                ...VALID_CREATE,
                taxationSystem,
                isVatPayer: true,
            });
            expect(result.success).toBe(false);
            if (!result.success) {
                expect(
                    result.error.issues.some(
                        (i) => i.message === 'INVALID_VAT_FOR_TAXATION_SYSTEM'
                    )
                ).toBe(true);
            }
        }
    );

    it('accepts isVatPayer=true з simplified-3 (legitimate)', () => {
        const result = CreateBusinessSchema.safeParse({
            ...VALID_CREATE,
            taxationSystem: 'simplified-3',
            isVatPayer: true,
        });
        expect(result.success).toBe(true);
    });

    it('rejects невідомий ключ payload-а через .strict()', () => {
        const result = CreateBusinessSchema.safeParse({
            ...VALID_CREATE,
            slug: 'evil-vanity',
        });
        expect(result.success).toBe(false);
    });

    it('rejects ownerId / managers у payload (slug-mutation захист) через .strict()', () => {
        const result = CreateBusinessSchema.safeParse({
            ...VALID_CREATE,
            ownerId: '507f1f77bcf86cd799439011',
            managers: [],
        });
        expect(result.success).toBe(false);
    });
});

describe('UpdateBusinessSchema', () => {
    it('accepts empty object (no-op partial)', () => {
        const result = UpdateBusinessSchema.safeParse({});
        expect(result.success).toBe(true);
    });

    it('accepts single-field partial (name only)', () => {
        const result = UpdateBusinessSchema.safeParse({ name: 'Нове' });
        expect(result.success).toBe(true);
    });

    it('accepts seoIndexEnabled toggle (Sprint 3 E3)', () => {
        const result = UpdateBusinessSchema.safeParse({
            seoIndexEnabled: true,
        });
        expect(result.success).toBe(true);
    });

    it('accepts coupled-edit (taxationSystem + isVatPayer одразу)', () => {
        const result = UpdateBusinessSchema.safeParse({
            taxationSystem: 'simplified-3',
            isVatPayer: true,
        });
        expect(result.success).toBe(true);
    });

    it.each([
        'slug',
        'slugLower',
        'type',
        'ownerId',
        'managers',
        'id',
        'createdAt',
    ])('rejects невідомий ключ %s через .strict() (slug-mutation захист)', (key) => {
        const result = UpdateBusinessSchema.safeParse({ [key]: 'whatever' });
        expect(result.success).toBe(false);
    });

    it('rejects coupled невалідну пару (simplified-1 + isVatPayer=true)', () => {
        const result = UpdateBusinessSchema.safeParse({
            taxationSystem: 'simplified-1',
            isVatPayer: true,
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(
                result.error.issues.some(
                    (i) => i.message === 'INVALID_VAT_FOR_TAXATION_SYSTEM'
                )
            ).toBe(true);
        }
    });

    it('NOT triggers coupled refine якщо передано тільки isVatPayer (без taxationSystem)', () => {
        // Frontend inline-edit isVatPayer сам по собі — refine пропускає,
        // бо повну пару не видно. Server-side coupled-check для цього кейсу
        // живе у BusinessesService.update (читає поточний taxationSystem з БД).
        const result = UpdateBusinessSchema.safeParse({ isVatPayer: true });
        expect(result.success).toBe(true);
    });

    it('NOT triggers coupled refine якщо передано тільки taxationSystem (без isVatPayer)', () => {
        const result = UpdateBusinessSchema.safeParse({
            taxationSystem: 'simplified-1',
        });
        expect(result.success).toBe(true);
    });

    it('rejects empty acceptedBanks при partial-update (мінімум 1 — B6)', () => {
        const result = UpdateBusinessSchema.safeParse({ acceptedBanks: [] });
        expect(result.success).toBe(false);
    });
});

describe('PublicBusinessSchema', () => {
    const VALID_PUBLIC = {
        type: 'fop',
        name: 'Іваненко',
        slug: 'IvanEnko',
        acceptedBanks: ['privatbank'],
        seoIndexEnabled: true,
        nbuLinks: {
            primary: 'https://qr.bank.gov.ua/abc123',
            legacy: 'https://bank.gov.ua/qr/abc123',
        },
    };

    it('parses усі whitelist-поля включно з nbuLinks (рішення A2)', () => {
        const result = PublicBusinessSchema.safeParse(VALID_PUBLIC);
        expect(result.success).toBe(true);
    });

    it('виносить рівно 6 ключів у parsed-output (whitelist інваріант — рішення C4)', () => {
        // Гарантія, що у public JSON клієнт ніколи не побачить реквізити /
        // ownership / timestamps напряму. nbuLinks — це той самий leak-vector
        // як QR PNG (payload у Base64URL), тож додання allowed; інше — strip.
        const result = PublicBusinessSchema.safeParse({
            ...VALID_PUBLIC,
            // Симулюємо backend, що випадково додав leak-поля у view-shape:
            requisites: { iban: VALID_IBAN, taxId: VALID_TAX_ID },
            taxationSystem: 'general',
            isVatPayer: true,
            ownerId: '507f1f77bcf86cd799439011',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(Object.keys(result.data).sort()).toEqual([
                'acceptedBanks',
                'name',
                'nbuLinks',
                'seoIndexEnabled',
                'slug',
                'type',
            ]);
        }
    });

    it('accepts case-preserved slug у view (E1)', () => {
        const result = PublicBusinessSchema.safeParse({
            ...VALID_PUBLIC,
            slug: 'CamelCase-Test',
        });
        expect(result.success).toBe(true);
    });

    it('rejects malformed slug у view (запобігає поверненню зіпсованих БД-документів)', () => {
        const result = PublicBusinessSchema.safeParse({
            ...VALID_PUBLIC,
            slug: 'has space',
        });
        expect(result.success).toBe(false);
    });
});
