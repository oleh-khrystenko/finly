import { effectiveLimit } from '../qr/limits';
import { BusinessSchema } from './business';

const NAME_LIMIT = effectiveLimit('receiverName');
const PURPOSE_LIMIT = effectiveLimit('purpose');

const VALID_TAX_ID = '1234567899';

const VALID_BUSINESS = {
    id: '507f1f77bcf86cd799439011',
    type: 'fop',
    ownerId: '507f1f77bcf86cd799439012',
    managers: [],
    slug: 'ivanenko-fop',
    slugLower: 'ivanenko-fop',
    name: 'Іваненко',
    taxId: VALID_TAX_ID,
    taxationSystem: 'simplified-3',
    isVatPayer: false,
    paymentPurposeTemplate: 'Оплата за послуги',
    acceptedBanks: ['privatbank', 'monobank'],
    seoIndexEnabled: false,
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
            type: 'sole-proprietor',
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

    it('rejects structurally invalid taxId at top-level (Sprint 9 §SP-1 — taxId flat, raniше requisites.taxId)', () => {
        // `payerTaxIdZod` (union RNOKPP ∪ ЄДРПОУ) reject-ить structurally
        // garbage (10-digit з wrong checksum, 7-digit, 9-digit, alpha) до того,
        // як parent-refine `TAX_ID_FORMAT_MISMATCH_TYPE` дістанеться. Type-binding
        // живе на parent-refine — покрито окремими тестами у "Sprint 7 — type-driven
        // refines" блоці нижче.
        const result = BusinessSchema.safeParse({
            ...VALID_BUSINESS,
            taxId: '1234567890', // 10-digit, wrong checksum
        });
        expect(result.success).toBe(false);
    });

    it('Sprint 9 §SP-1 — Business більше не містить requisites; iban перейшов на Account', () => {
        const { requisites: _requisites, ...without } = {
            ...VALID_BUSINESS,
            requisites: { iban: 'UA213223130000026007233566001' },
        };
        void _requisites;
        // Без requisites — parse OK.
        const result = BusinessSchema.safeParse(without);
        expect(result.success).toBe(true);
    });

    it.each([
        '-leading-dash',
        'trailing-dash-',
        'has space',
        'has--double-dash',
        'ab',
        'with_underscore',
        'with.dot',
    ])('rejects malformed slug %s', (slug) => {
        const result = BusinessSchema.safeParse({
            ...VALID_BUSINESS,
            slug,
            // slugLower має бути lowercase-формою — щоб `SLUG_LOWER_MISMATCH`
            // не маскував regex-помилку як основну причину reject-у.
            slugLower: slug.toLowerCase(),
        });
        expect(result.success).toBe(false);
    });

    it.each([
        ['IvanEnko', 'ivanenko'],
        ['IVAN-2024', 'ivan-2024'],
        ['CamelCase-Test', 'camelcase-test'],
    ])(
        'accepts case-preserved slug %s with matching slugLower %s (Sprint 3 E1)',
        (slug, slugLower) => {
            const result = BusinessSchema.safeParse({
                ...VALID_BUSINESS,
                slug,
                slugLower,
            });
            expect(result.success).toBe(true);
        }
    );

    it('rejects business with slugLower ≠ slug.toLowerCase() (drift guard)', () => {
        const result = BusinessSchema.safeParse({
            ...VALID_BUSINESS,
            slug: 'IvanEnko',
            slugLower: 'someone-else',
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(
                result.error.issues.some(
                    (i) => i.message === 'SLUG_LOWER_MISMATCH'
                )
            ).toBe(true);
        }
    });

    it('rejects slugLower with uppercase letters (must be lowercase-only)', () => {
        const result = BusinessSchema.safeParse({
            ...VALID_BUSINESS,
            slug: 'IvanEnko',
            slugLower: 'IvanEnko',
        });
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

    // -------------------------------------------------------------------------
    // Sprint 8 fix — NBU-charset refine (Win1251-mapping).
    // -------------------------------------------------------------------------

    describe('name / paymentPurposeTemplate — NBU charset refine', () => {
        it('rejects name з emoji → INVALID_NAME_CHARSET', () => {
            const result = BusinessSchema.safeParse({
                ...VALID_BUSINESS,
                name: '☕ Кав\'ярня',
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

        it('rejects paymentPurposeTemplate з emoji → INVALID_PURPOSE_CHARSET', () => {
            const result = BusinessSchema.safeParse({
                ...VALID_BUSINESS,
                paymentPurposeTemplate: 'Оплата 🍵',
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

        it('rejects name з LF (multi-line атака на field-separator)', () => {
            const result = BusinessSchema.safeParse({
                ...VALID_BUSINESS,
                name: 'Іваненко\nПетро',
            });
            expect(result.success).toBe(false);
        });

        it('accepts name з допустимою typography (апостроф U+2019, dash U+2014)', () => {
            const result = BusinessSchema.safeParse({
                ...VALID_BUSINESS,
                name: 'ТОВ «Кав’ярня — Майдан»',
            });
            expect(result.success).toBe(true);
        });
    });

    // -------------------------------------------------------------------------
    // Sprint 3 §3.1 — coupled-rule taxationSystem × isVatPayer (рішення C1).
    // ПДВ legitимний лише на спрощеній-3 / загальній.
    // -------------------------------------------------------------------------

    describe('taxationSystem × isVatPayer coupled rule (C1)', () => {
        it.each(['simplified-3', 'general'] as const)(
            'accepts isVatPayer=true with taxationSystem=%s',
            (taxationSystem) => {
                const result = BusinessSchema.safeParse({
                    ...VALID_BUSINESS,
                    taxationSystem,
                    isVatPayer: true,
                });
                expect(result.success).toBe(true);
            }
        );

        it.each([
            'simplified-1',
            'simplified-2',
            'simplified-3',
            'general',
        ] as const)(
            'accepts isVatPayer=false with будь-якою taxationSystem=%s',
            (taxationSystem) => {
                const result = BusinessSchema.safeParse({
                    ...VALID_BUSINESS,
                    taxationSystem,
                    isVatPayer: false,
                });
                expect(result.success).toBe(true);
            }
        );

        it.each(['simplified-1', 'simplified-2'] as const)(
            'rejects isVatPayer=true with taxationSystem=%s → INVALID_VAT_FOR_TAXATION_SYSTEM',
            (taxationSystem) => {
                const result = BusinessSchema.safeParse({
                    ...VALID_BUSINESS,
                    taxationSystem,
                    isVatPayer: true,
                });
                expect(result.success).toBe(false);
                if (!result.success) {
                    expect(
                        result.error.issues.some(
                            (i) =>
                                i.message === 'INVALID_VAT_FOR_TAXATION_SYSTEM'
                        )
                    ).toBe(true);
                }
            }
        );

        it('rejects unknown taxationSystem value', () => {
            const result = BusinessSchema.safeParse({
                ...VALID_BUSINESS,
                taxationSystem: 'simplified-99',
            });
            expect(result.success).toBe(false);
        });
    });

    describe('seoIndexEnabled (Sprint 3 E3)', () => {
        it('accepts seoIndexEnabled=true', () => {
            const result = BusinessSchema.safeParse({
                ...VALID_BUSINESS,
                seoIndexEnabled: true,
            });
            expect(result.success).toBe(true);
        });

        it('rejects missing seoIndexEnabled (required в entity-shape)', () => {
            const { seoIndexEnabled: _omit, ...without } = VALID_BUSINESS;
            void _omit;
            const result = BusinessSchema.safeParse(without);
            expect(result.success).toBe(false);
        });
    });

    // -------------------------------------------------------------------------
    // Sprint 7 §SP-3 + §SP-4 — type-driven refines: (taxation iff
    // requiresTaxation(type)) і (taxId-format matches type).
    //
    // Sprint 9 §SP-1 path-оновлення: `taxId` тепер top-level, не `requisites.taxId`.
    // -------------------------------------------------------------------------

    describe('Sprint 7 — type-driven refines (Sprint 9 path-flatten)', () => {
        const VALID_RNOKPP = '1234567899'; // 10 digits + valid checksum
        const VALID_EDRPOU = '12345678'; // 8 digits, no checksum

        const buildBusiness = (overrides: Record<string, unknown>) => ({
            ...VALID_BUSINESS,
            ...overrides,
        });

        describe('individual (no taxation, RNOKPP)', () => {
            const base = {
                type: 'individual' as const,
                taxationSystem: null,
                isVatPayer: null,
                taxId: VALID_RNOKPP,
            };

            it('accepts valid individual (taxation-fields null, RNOKPP 10-digit)', () => {
                const result = BusinessSchema.safeParse(buildBusiness(base));
                expect(result.success).toBe(true);
            });

            it('rejects garbage taxationSystem on individual → TAXATION_FIELDS_MISMATCH_TYPE', () => {
                const result = BusinessSchema.safeParse(
                    buildBusiness({ ...base, taxationSystem: 'general' })
                );
                expect(result.success).toBe(false);
                if (!result.success) {
                    expect(
                        result.error.issues.some(
                            (i) => i.message === 'TAXATION_FIELDS_MISMATCH_TYPE'
                        )
                    ).toBe(true);
                }
            });

            it('rejects garbage isVatPayer on individual → TAXATION_FIELDS_MISMATCH_TYPE', () => {
                const result = BusinessSchema.safeParse(
                    buildBusiness({ ...base, isVatPayer: false })
                );
                expect(result.success).toBe(false);
                if (!result.success) {
                    expect(
                        result.error.issues.some(
                            (i) => i.message === 'TAXATION_FIELDS_MISMATCH_TYPE'
                        )
                    ).toBe(true);
                }
            });

            it('rejects 8-digit ЄДРПОУ on individual → TAX_ID_FORMAT_MISMATCH_TYPE з path=[taxId]', () => {
                const result = BusinessSchema.safeParse(
                    buildBusiness({ ...base, taxId: VALID_EDRPOU })
                );
                expect(result.success).toBe(false);
                if (!result.success) {
                    const mismatchIssue = result.error.issues.find(
                        (i) => i.message === 'TAX_ID_FORMAT_MISMATCH_TYPE'
                    );
                    expect(mismatchIssue).toBeDefined();
                    expect(mismatchIssue?.path).toEqual(['taxId']);
                }
            });
        });

        describe('fop (taxation required, RNOKPP)', () => {
            const base = {
                type: 'fop' as const,
                taxationSystem: 'simplified-3' as const,
                isVatPayer: false,
                taxId: VALID_RNOKPP,
            };

            it('accepts valid fop', () => {
                const result = BusinessSchema.safeParse(buildBusiness(base));
                expect(result.success).toBe(true);
            });

            it('rejects null taxationSystem on fop → TAXATION_FIELDS_MISMATCH_TYPE', () => {
                const result = BusinessSchema.safeParse(
                    buildBusiness({ ...base, taxationSystem: null })
                );
                expect(result.success).toBe(false);
                if (!result.success) {
                    expect(
                        result.error.issues.some(
                            (i) => i.message === 'TAXATION_FIELDS_MISMATCH_TYPE'
                        )
                    ).toBe(true);
                }
            });

            it('rejects null isVatPayer on fop → TAXATION_FIELDS_MISMATCH_TYPE', () => {
                const result = BusinessSchema.safeParse(
                    buildBusiness({ ...base, isVatPayer: null })
                );
                expect(result.success).toBe(false);
                if (!result.success) {
                    expect(
                        result.error.issues.some(
                            (i) => i.message === 'TAXATION_FIELDS_MISMATCH_TYPE'
                        )
                    ).toBe(true);
                }
            });

            it('rejects 8-digit ЄДРПОУ on fop → TAX_ID_FORMAT_MISMATCH_TYPE', () => {
                const result = BusinessSchema.safeParse(
                    buildBusiness({ ...base, taxId: VALID_EDRPOU })
                );
                expect(result.success).toBe(false);
                if (!result.success) {
                    expect(
                        result.error.issues.some(
                            (i) => i.message === 'TAX_ID_FORMAT_MISMATCH_TYPE'
                        )
                    ).toBe(true);
                }
            });
        });

        describe('tov (taxation required, ЄДРПОУ)', () => {
            const base = {
                type: 'tov' as const,
                taxationSystem: 'general' as const,
                isVatPayer: true,
                taxId: VALID_EDRPOU,
            };

            it('accepts valid tov with VAT on general', () => {
                const result = BusinessSchema.safeParse(buildBusiness(base));
                expect(result.success).toBe(true);
            });

            it('rejects null taxationSystem on tov → TAXATION_FIELDS_MISMATCH_TYPE', () => {
                const result = BusinessSchema.safeParse(
                    buildBusiness({ ...base, taxationSystem: null })
                );
                expect(result.success).toBe(false);
                if (!result.success) {
                    expect(
                        result.error.issues.some(
                            (i) => i.message === 'TAXATION_FIELDS_MISMATCH_TYPE'
                        )
                    ).toBe(true);
                }
            });

            it('rejects 10-digit RNOKPP on tov → TAX_ID_FORMAT_MISMATCH_TYPE', () => {
                const result = BusinessSchema.safeParse(
                    buildBusiness({ ...base, taxId: VALID_RNOKPP })
                );
                expect(result.success).toBe(false);
                if (!result.success) {
                    expect(
                        result.error.issues.some(
                            (i) => i.message === 'TAX_ID_FORMAT_MISMATCH_TYPE'
                        )
                    ).toBe(true);
                }
            });

            it('still enforces VAT × taxation coupling on tov (Sprint 3 C1)', () => {
                const result = BusinessSchema.safeParse(
                    buildBusiness({
                        ...base,
                        taxationSystem: 'simplified-1',
                        isVatPayer: true,
                    })
                );
                expect(result.success).toBe(false);
                if (!result.success) {
                    expect(
                        result.error.issues.some(
                            (i) =>
                                i.message === 'INVALID_VAT_FOR_TAXATION_SYSTEM'
                        )
                    ).toBe(true);
                }
            });
        });

        describe('organization (no taxation, ЄДРПОУ)', () => {
            const base = {
                type: 'organization' as const,
                taxationSystem: null,
                isVatPayer: null,
                taxId: VALID_EDRPOU,
            };

            it('accepts valid organization', () => {
                const result = BusinessSchema.safeParse(buildBusiness(base));
                expect(result.success).toBe(true);
            });

            it('rejects garbage taxationSystem on organization → TAXATION_FIELDS_MISMATCH_TYPE', () => {
                const result = BusinessSchema.safeParse(
                    buildBusiness({ ...base, taxationSystem: 'simplified-3' })
                );
                expect(result.success).toBe(false);
                if (!result.success) {
                    expect(
                        result.error.issues.some(
                            (i) => i.message === 'TAXATION_FIELDS_MISMATCH_TYPE'
                        )
                    ).toBe(true);
                }
            });

            it('rejects 10-digit RNOKPP on organization → TAX_ID_FORMAT_MISMATCH_TYPE', () => {
                const result = BusinessSchema.safeParse(
                    buildBusiness({ ...base, taxId: VALID_RNOKPP })
                );
                expect(result.success).toBe(false);
                if (!result.success) {
                    expect(
                        result.error.issues.some(
                            (i) => i.message === 'TAX_ID_FORMAT_MISMATCH_TYPE'
                        )
                    ).toBe(true);
                }
            });
        });

        // Sub-schema sanity: `payerTaxIdZod` reject-ить structurally невалідне
        // (ні 10-digit + checksum, ні 8-digit pattern) на write- і read-paths
        // однаково — незалежно від `type`.
        it.each([
            '',
            '1234567', // 7 digits — ні те, ні те
            '123456789', // 9 digits
            '12345678901', // 11 digits
            'abcdefgh',
            '1234567a',
        ])(
            'rejects structurally invalid taxId %p regardless of type',
            (taxId) => {
                for (const type of [
                    'individual',
                    'fop',
                    'tov',
                    'organization',
                ] as const) {
                    const taxationOverrides =
                        type === 'fop' || type === 'tov'
                            ? {
                                  taxationSystem: 'simplified-3' as const,
                                  isVatPayer: false,
                              }
                            : {
                                  taxationSystem: null,
                                  isVatPayer: null,
                              };
                    const result = BusinessSchema.safeParse(
                        buildBusiness({
                            type,
                            ...taxationOverrides,
                            taxId,
                        })
                    );
                    expect(result.success).toBe(false);
                }
            }
        );
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
