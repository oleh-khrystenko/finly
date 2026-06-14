import { taxIdFieldConfig } from './taxIdField';

describe('taxIdFieldConfig — Sprint 7 §SP-4 type-aware UI config', () => {
    it.each([
        [
            'individual',
            {
                label: 'РНОКПП',
                placeholder: '1234567890',
                description: '10 цифр, як у довідці ДПС',
                maxLength: 10,
            },
        ],
        [
            'fop',
            {
                label: 'РНОКПП',
                placeholder: '1234567890',
                description: '10 цифр, особистий код з довідки ДПС',
                maxLength: 10,
            },
        ],
        [
            'tov',
            {
                label: 'ЄДРПОУ',
                placeholder: '12345678',
                description: '8 цифр, як у виписці ЄДР',
                maxLength: 8,
            },
        ],
        [
            'organization',
            {
                label: 'ЄДРПОУ',
                placeholder: '12345678',
                description: '8 цифр, як у виписці ЄДР',
                maxLength: 8,
            },
        ],
    ] as const)(
        '%s → label/placeholder/description/maxLength відповідає нормативу',
        (type, expected) => {
            const config = taxIdFieldConfig(type);
            expect(config.label).toBe(expected.label);
            expect(config.placeholder).toBe(expected.placeholder);
            expect(config.description).toBe(expected.description);
            expect(config.maxLength).toBe(expected.maxLength);
        }
    );

    it.each(['individual', 'fop'] as const)(
        '%s validator: 10-digit valid RNOKPP проходить',
        (type) => {
            const config = taxIdFieldConfig(type);
            expect(config.validator.safeParse('1234567899').success).toBe(true);
        }
    );

    it.each(['tov', 'organization'] as const)(
        '%s validator: 8-digit ЄДРПОУ проходить',
        (type) => {
            const config = taxIdFieldConfig(type);
            expect(config.validator.safeParse('12345678').success).toBe(true);
        }
    );

    it.each(['individual', 'fop'] as const)(
        '%s validator: 8-digit ЄДРПОУ — reject (cross-type)',
        (type) => {
            const config = taxIdFieldConfig(type);
            expect(config.validator.safeParse('12345678').success).toBe(false);
        }
    );

    it.each(['tov', 'organization'] as const)(
        '%s validator: 10-digit RNOKPP — reject (cross-type)',
        (type) => {
            const config = taxIdFieldConfig(type);
            expect(config.validator.safeParse('1234567899').success).toBe(
                false
            );
        }
    );
});
