import { CreateBusinessSchema } from './businesses';
import {
    LandingDraftSchema,
    mapLandingDraftToCreateBusinessRequest,
} from './landing-draft';

const VALID_IBAN = 'UA213223130000026007233566001';
const VALID_RNOKPP = '1234567899';
const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

const VALID_DRAFT = {
    receiverName: 'Іваненко Олена Петрівна',
    iban: VALID_IBAN,
    taxId: VALID_RNOKPP,
    purpose: 'Поповнення рахунку',
};

describe('LandingDraftSchema', () => {
    it('parses valid 4-field draft', () => {
        const result = LandingDraftSchema.safeParse(VALID_DRAFT);
        expect(result.success).toBe(true);
    });

    it.each(['receiverName', 'iban', 'taxId', 'purpose'] as const)(
        'rejects draft з відсутнім полем %s',
        (field) => {
            const { [field]: _omit, ...without } = VALID_DRAFT;
            void _omit;
            const result = LandingDraftSchema.safeParse(without);
            expect(result.success).toBe(false);
        }
    );

    it('rejects 8-digit ЄДРПОУ (anon-форма зачинена на individual + РНОКПП)', () => {
        const result = LandingDraftSchema.safeParse({
            ...VALID_DRAFT,
            taxId: '12345678',
        });
        expect(result.success).toBe(false);
    });

    it('rejects invalid IBAN-checksum', () => {
        const result = LandingDraftSchema.safeParse({
            ...VALID_DRAFT,
            iban: 'UA000000000000000000000000000',
        });
        expect(result.success).toBe(false);
    });

    it('rejects non-NBU charset у receiverName (emoji)', () => {
        const result = LandingDraftSchema.safeParse({
            ...VALID_DRAFT,
            receiverName: "☕ Кав'ярня",
        });
        expect(result.success).toBe(false);
    });

    it('round-trip: parsed draft має той самий shape, що у store', () => {
        const result = LandingDraftSchema.parse(VALID_DRAFT);
        expect(result).toEqual({
            receiverName: 'Іваненко Олена Петрівна',
            iban: VALID_IBAN,
            taxId: VALID_RNOKPP,
            purpose: 'Поповнення рахунку',
        });
    });
});

describe('mapLandingDraftToCreateBusinessRequest', () => {
    it('мапить draft + key → individual-variant з 5 ключами', () => {
        const result = mapLandingDraftToCreateBusinessRequest(
            VALID_DRAFT,
            VALID_UUID
        );
        expect(result).toEqual({
            type: 'individual',
            name: 'Іваненко Олена Петрівна',
            taxId: VALID_RNOKPP,
            paymentPurposeTemplate: 'Поповнення рахунку',
            claimIdempotencyKey: VALID_UUID,
        });
    });

    it('result проходить CreateBusinessSchema (round-trip без drift-у)', () => {
        const mapped = mapLandingDraftToCreateBusinessRequest(
            VALID_DRAFT,
            VALID_UUID
        );
        const parsed = CreateBusinessSchema.safeParse(mapped);
        expect(parsed.success).toBe(true);
    });

    it('IBAN не leak-ається у CreateBusiness-shape (живе на Account)', () => {
        const result = mapLandingDraftToCreateBusinessRequest(
            VALID_DRAFT,
            VALID_UUID
        );
        expect(result).not.toHaveProperty('iban');
        expect(result).not.toHaveProperty('requisites');
    });

    it('CreateBusinessSchema reject-ить mapped result з невалідним UUID-key', () => {
        // Мапер сам по собі — pure function, не валідує key. Перевірка живе
        // на CreateBusinessSchema через claimIdempotencyKeyField.
        const mapped = mapLandingDraftToCreateBusinessRequest(
            VALID_DRAFT,
            'not-a-uuid'
        );
        const parsed = CreateBusinessSchema.safeParse(mapped);
        expect(parsed.success).toBe(false);
    });
});
