import {
    BUSINESS_TYPES,
    BUSINESS_TYPE_LABEL,
    TAXATION_REQUIRED_TYPES,
    requiresTaxation,
    taxIdLengthFor,
    type BusinessType,
} from './business-type';

describe('BUSINESS_TYPES enum', () => {
    it('contains exactly 4 values in canonical wizard order', () => {
        // Order is contractual: wizard radio-cards, marketing copy and
        // analytics все читає з цієї tuple.
        expect(BUSINESS_TYPES).toEqual([
            'individual',
            'fop',
            'tov',
            'organization',
        ]);
    });

    it('is readonly tuple at the type level', () => {
        // `as const` гарантує literal-types для downstream-`z.enum(...)` —
        // smoke-перевірка, що масив справді frozen на runtime ми не робимо
        // (Object.freeze не застосовується автоматично), але тип `readonly`
        // блокує мутацію у consumer-коді.
        const _typeCheck: readonly BusinessType[] = BUSINESS_TYPES;
        expect(_typeCheck.length).toBe(4);
    });
});

describe('BUSINESS_TYPE_LABEL', () => {
    it('maps every BusinessType to a non-empty UA label', () => {
        for (const type of BUSINESS_TYPES) {
            expect(BUSINESS_TYPE_LABEL[type]).toMatch(/.+/);
        }
    });

    it('exposes the agreed Sprint 7 §SP-1 labels', () => {
        expect(BUSINESS_TYPE_LABEL).toEqual({
            individual: 'Фізособа',
            fop: 'ФОП',
            tov: 'ТОВ',
            organization: 'Неприбуткова організація',
        });
    });
});

describe('TAXATION_REQUIRED_TYPES', () => {
    it('contains exactly fop and tov', () => {
        // Інваріант Sprint 7 §SP-3: тільки комерційні форми мають
        // `taxationSystem` / `isVatPayer`.
        expect(TAXATION_REQUIRED_TYPES).toEqual(['fop', 'tov']);
    });

    it('every entry is a valid BusinessType', () => {
        for (const type of TAXATION_REQUIRED_TYPES) {
            expect(BUSINESS_TYPES).toContain(type);
        }
    });
});

describe('requiresTaxation()', () => {
    it.each([
        ['individual', false],
        ['fop', true],
        ['tov', true],
        ['organization', false],
    ] as const)('returns %p for type %p', (type, expected) => {
        expect(requiresTaxation(type)).toBe(expected);
    });

    it('agrees with TAXATION_REQUIRED_TYPES for every BusinessType', () => {
        // Cross-check: helper не може дрейфувати від tuple-у. Якщо хтось у
        // майбутньому додасть тип у TAXATION_REQUIRED_TYPES, але забуде
        // оновити helper (або навпаки) — цей тест зловить.
        for (const type of BUSINESS_TYPES) {
            const fromTuple = (
                TAXATION_REQUIRED_TYPES as readonly BusinessType[]
            ).includes(type);
            expect(requiresTaxation(type)).toBe(fromTuple);
        }
    });
});

describe('taxIdLengthFor()', () => {
    it.each([
        ['individual', 10],
        ['fop', 10],
        ['tov', 8],
        ['organization', 8],
    ] as const)('returns %p for type %p', (type, expected) => {
        expect(taxIdLengthFor(type)).toBe(expected);
    });

    it('returns only 8 or 10 for every BusinessType', () => {
        // Норматив НБУ дозволяє рівно ці дві довжини; будь-яке інше значення
        // — bug у мапінгу, що порушив би contract з QR-payload-builder-ом.
        for (const type of BUSINESS_TYPES) {
            const length = taxIdLengthFor(type);
            expect([8, 10]).toContain(length);
        }
    });
});
