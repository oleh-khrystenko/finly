import { QrPreviewInputSchema, QrPreviewResponseSchema } from './qr-preview';

const VALID_IBAN = 'UA213223130000026007233566001';
const VALID_RNOKPP = '1234567899';

const VALID_INPUT = {
    receiverName: 'Іваненко Олена Петрівна',
    iban: VALID_IBAN,
    taxId: VALID_RNOKPP,
    purpose: 'Поповнення рахунку',
};

describe('QrPreviewInputSchema', () => {
    it('parses valid anon-payload', () => {
        const result = QrPreviewInputSchema.safeParse(VALID_INPUT);
        expect(result.success).toBe(true);
    });

    it.each(['receiverName', 'iban', 'taxId', 'purpose'] as const)(
        'rejects payload з відсутнім полем %s',
        (field) => {
            const { [field]: _omit, ...without } = VALID_INPUT;
            void _omit;
            const result = QrPreviewInputSchema.safeParse(without);
            expect(result.success).toBe(false);
        }
    );

    it('rejects невалідний IBAN (failed mod-97 checksum)', () => {
        const result = QrPreviewInputSchema.safeParse({
            ...VALID_INPUT,
            iban: 'UA000000000000000000000000000',
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(
                result.error.issues.some(
                    (i) => i.message === 'INVALID_IBAN_CHECKSUM'
                )
            ).toBe(true);
        }
    });

    it('rejects невалідний taxId (failed ДПС-checksum, 8-digit ЄДРПОУ)', () => {
        // ЄДРПОУ 8 цифр валідний для tov/organization, але anon-форма
        // зачинена на individual → 10-цифровий РНОКПП. Union тут не приймається.
        const result = QrPreviewInputSchema.safeParse({
            ...VALID_INPUT,
            taxId: '12345678',
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(
                result.error.issues.some((i) => i.message === 'INVALID_TAX_ID')
            ).toBe(true);
        }
    });

    it('rejects taxId з failing check-digit (typo 0 замість 9 у last)', () => {
        const result = QrPreviewInputSchema.safeParse({
            ...VALID_INPUT,
            taxId: '1234567890',
        });
        expect(result.success).toBe(false);
    });

    it('rejects empty receiverName (trim → empty)', () => {
        const result = QrPreviewInputSchema.safeParse({
            ...VALID_INPUT,
            receiverName: '   ',
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(
                result.error.issues.some(
                    (i) => i.message === 'INVALID_NAME_REQUIRED'
                )
            ).toBe(true);
        }
    });

    it('rejects empty purpose', () => {
        const result = QrPreviewInputSchema.safeParse({
            ...VALID_INPUT,
            purpose: '',
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(
                result.error.issues.some(
                    (i) => i.message === 'INVALID_PURPOSE_REQUIRED'
                )
            ).toBe(true);
        }
    });

    it('rejects receiverName, що перевищує char-limit (NAME effective = 140)', () => {
        const result = QrPreviewInputSchema.safeParse({
            ...VALID_INPUT,
            receiverName: 'a'.repeat(141),
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(
                result.error.issues.some(
                    (i) => i.message === 'INVALID_NAME_CHAR_LENGTH'
                )
            ).toBe(true);
        }
    });

    it('rejects purpose, що перевищує char-limit (PURPOSE effective = 420)', () => {
        const result = QrPreviewInputSchema.safeParse({
            ...VALID_INPUT,
            purpose: 'a'.repeat(421),
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(
                result.error.issues.some(
                    (i) => i.message === 'INVALID_PURPOSE_CHAR_LENGTH'
                )
            ).toBe(true);
        }
    });

    // Sprint 8 §8.0 plan вимагав цей кейс. NBU-charset assert живе на entity-
    // level (`businessNameSchema`/`businessPaymentPurposeTemplateSchema`); без
    // нього не-Win1251 символ (emoji) проходив DTO → render QR падав з 500
    // (`PayloadValidationError` → `INTERNAL_ERROR` у глобальному фільтрі).
    // Refine конвертує це у 400 `VALIDATION_ERROR` на API-boundary.
    it('rejects non-NBU char у receiverName (emoji ☕)', () => {
        const result = QrPreviewInputSchema.safeParse({
            ...VALID_INPUT,
            receiverName: "☕ Кав'ярня",
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

    it('rejects non-NBU char у purpose (emoji 🍵)', () => {
        const result = QrPreviewInputSchema.safeParse({
            ...VALID_INPUT,
            purpose: 'Оплата 🍵',
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

    it('rejects LF у receiverName (multi-line атака на field-separator)', () => {
        // LF/CR — роздільники полів payload; всередині значення вони ламають
        // кількість полів, що зчитує банк-парсер. Refine блокує спробу
        // відправити 2-рядковий receiverName.
        const result = QrPreviewInputSchema.safeParse({
            ...VALID_INPUT,
            receiverName: 'Іваненко\nПетро',
        });
        expect(result.success).toBe(false);
    });

    it('rejects невідомий ключ через .strict() (захист від payload-широких атак)', () => {
        // Спроба передати поля зі скоупу Sprint 9+ (amount, validUntil) або
        // cabinet-поля (type, taxationSystem) → 400 VALIDATION_ERROR.
        const result = QrPreviewInputSchema.safeParse({
            ...VALID_INPUT,
            amount: 1000,
        });
        expect(result.success).toBe(false);
    });

    it('rejects type-поле через .strict() (anon-форма локує individual)', () => {
        const result = QrPreviewInputSchema.safeParse({
            ...VALID_INPUT,
            type: 'fop',
        });
        expect(result.success).toBe(false);
    });
});

describe('QrPreviewResponseSchema', () => {
    it('parses valid response', () => {
        const result = QrPreviewResponseSchema.safeParse({
            link: 'https://qr.bank.gov.ua/abc123',
            qrPngBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
        });
        expect(result.success).toBe(true);
    });

    it('rejects link, що не є URL', () => {
        const result = QrPreviewResponseSchema.safeParse({
            link: 'not-a-url',
            qrPngBase64: 'iVBORw0KGgo',
        });
        expect(result.success).toBe(false);
    });

    it('rejects empty qrPngBase64', () => {
        const result = QrPreviewResponseSchema.safeParse({
            link: 'https://qr.bank.gov.ua/abc',
            qrPngBase64: '',
        });
        expect(result.success).toBe(false);
    });
});
