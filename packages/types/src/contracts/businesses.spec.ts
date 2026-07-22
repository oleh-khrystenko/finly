import {
    CreateBusinessSchema,
    PublicBusinessSchema,
    UpdateBusinessSchema,
} from './businesses';

const VALID_TAX_ID = '1234567899';

const VALID_CREATE = {
    type: 'fop',
    name: 'Іваненко',
    taxId: VALID_TAX_ID,
    taxationSystem: 'simplified-3',
    isVatPayer: false,
    paymentPurposeTemplate: 'Оплата за послуги',
};

describe('CreateBusinessSchema', () => {
    it('parses valid full payload (Sprint 9 — flat taxId, no requisites/iban)', () => {
        const result = CreateBusinessSchema.safeParse(VALID_CREATE);
        expect(result.success).toBe(true);
    });

    it.each([
        'name',
        'taxId',
        'taxationSystem',
        'isVatPayer',
        'paymentPurposeTemplate',
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

    it('Sprint 9 — rejects requisites-wrapper (видалено повністю)', () => {
        const result = CreateBusinessSchema.safeParse({
            ...VALID_CREATE,
            requisites: {
                iban: 'UA213223130000026007233566001',
                taxId: VALID_TAX_ID,
            },
        });
        expect(result.success).toBe(false);
    });

    it('Sprint 9 — rejects iban на top-level (IBAN живе на Account, не Business)', () => {
        const result = CreateBusinessSchema.safeParse({
            ...VALID_CREATE,
            iban: 'UA213223130000026007233566001',
        });
        expect(result.success).toBe(false);
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

    // -------------------------------------------------------------------------
    // Sprint 7 §SP-3 + §SP-4 + Sprint 9 — discriminatedUnion per `type` з
    // flat taxId per-variant. 4 positive (один на тип), kілька negative.
    // -------------------------------------------------------------------------

    describe('Sprint 7 §SP-3/SP-4 + Sprint 9 — discriminated union per type', () => {
        const VALID_RNOKPP = '1234567899';
        const VALID_EDRPOU = '12345678';

        const baseFields = {
            name: 'Іваненко',
            paymentPurposeTemplate: 'Збір',
        };

        it('accepts individual without taxation-fields, з 10-digit RNOKPP', () => {
            const result = CreateBusinessSchema.safeParse({
                ...baseFields,
                type: 'individual',
                taxId: VALID_RNOKPP,
            });
            expect(result.success).toBe(true);
        });

        it('accepts fop with taxation-fields і 10-digit RNOKPP', () => {
            const result = CreateBusinessSchema.safeParse({
                ...baseFields,
                type: 'fop',
                taxId: VALID_RNOKPP,
                taxationSystem: 'simplified-3',
                isVatPayer: false,
            });
            expect(result.success).toBe(true);
        });

        it('accepts tov with taxation-fields і 8-digit ЄДРПОУ', () => {
            const result = CreateBusinessSchema.safeParse({
                ...baseFields,
                type: 'tov',
                taxId: VALID_EDRPOU,
                taxationSystem: 'general',
                isVatPayer: true,
            });
            expect(result.success).toBe(true);
        });

        it('accepts organization without taxation-fields, з 8-digit ЄДРПОУ', () => {
            const result = CreateBusinessSchema.safeParse({
                ...baseFields,
                type: 'organization',
                taxId: VALID_EDRPOU,
            });
            expect(result.success).toBe(true);
        });

        it('rejects taxation-fields у individual variant (.strict() unknown key)', () => {
            const result = CreateBusinessSchema.safeParse({
                ...baseFields,
                type: 'individual',
                taxId: VALID_RNOKPP,
                taxationSystem: 'simplified-3',
                isVatPayer: false,
            });
            expect(result.success).toBe(false);
        });

        it('rejects taxation-fields у organization variant (.strict() unknown key)', () => {
            const result = CreateBusinessSchema.safeParse({
                ...baseFields,
                type: 'organization',
                taxId: VALID_EDRPOU,
                taxationSystem: 'simplified-3',
                isVatPayer: false,
            });
            expect(result.success).toBe(false);
        });

        it('rejects 8-digit ЄДРПОУ для type=fop (per-variant individualTaxIdZod)', () => {
            const result = CreateBusinessSchema.safeParse({
                ...baseFields,
                type: 'fop',
                taxId: VALID_EDRPOU,
                taxationSystem: 'simplified-3',
                isVatPayer: false,
            });
            expect(result.success).toBe(false);
        });

        it('rejects 10-digit RNOKPP для type=organization (per-variant legalEntityTaxIdZod)', () => {
            const result = CreateBusinessSchema.safeParse({
                ...baseFields,
                type: 'organization',
                taxId: VALID_RNOKPP,
            });
            expect(result.success).toBe(false);
        });

        it('rejects missing taxationSystem на fop variant', () => {
            const result = CreateBusinessSchema.safeParse({
                ...baseFields,
                type: 'fop',
                taxId: VALID_RNOKPP,
                isVatPayer: false,
            });
            expect(result.success).toBe(false);
        });

        it('rejects missing taxationSystem на tov variant', () => {
            const result = CreateBusinessSchema.safeParse({
                ...baseFields,
                type: 'tov',
                taxId: VALID_EDRPOU,
                isVatPayer: true,
            });
            expect(result.success).toBe(false);
        });

        it('rejects unknown discriminator value', () => {
            const result = CreateBusinessSchema.safeParse({
                ...baseFields,
                type: 'startup',
                taxId: VALID_RNOKPP,
            });
            expect(result.success).toBe(false);
        });

        // ПКУ розд. XIV гл. 1 — групи 1/2 єдиного податку доступні виключно
        // ФОП. ТОВ дозволяється лише `simplified-3` і `general`. Refine живе на
        // `createTovVariant`; `createFopVariant` приймає усі 4 системи.
        describe('taxation-system × type binding (ПКУ розд. XIV)', () => {
            it.each(['simplified-1', 'simplified-2'] as const)(
                'rejects tov + %s → TAXATION_SYSTEM_NOT_ALLOWED_FOR_TYPE',
                (taxationSystem) => {
                    const result = CreateBusinessSchema.safeParse({
                        ...baseFields,
                        type: 'tov',
                        taxId: VALID_EDRPOU,
                        taxationSystem,
                        isVatPayer: false,
                    });
                    expect(result.success).toBe(false);
                    if (!result.success) {
                        const issue = result.error.issues.find(
                            (i) =>
                                i.message ===
                                'TAXATION_SYSTEM_NOT_ALLOWED_FOR_TYPE'
                        );
                        expect(issue).toBeDefined();
                        expect(issue?.path).toEqual(['taxationSystem']);
                    }
                }
            );

            it.each(['simplified-3', 'general'] as const)(
                'accepts tov + %s (allowed-set)',
                (taxationSystem) => {
                    const result = CreateBusinessSchema.safeParse({
                        ...baseFields,
                        type: 'tov',
                        taxId: VALID_EDRPOU,
                        taxationSystem,
                        isVatPayer: false,
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
                'accepts fop + %s (усі 4 системи)',
                (taxationSystem) => {
                    const result = CreateBusinessSchema.safeParse({
                        ...baseFields,
                        type: 'fop',
                        taxId: VALID_RNOKPP,
                        taxationSystem,
                        isVatPayer: false,
                    });
                    expect(result.success).toBe(true);
                }
            );
        });
    });
});

describe('Sprint 10 — CreateBusinessSchema.claimIdempotencyKey', () => {
    const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

    it('accepts create без claimIdempotencyKey (cabinet wizard)', () => {
        const result = CreateBusinessSchema.safeParse(VALID_CREATE);
        expect(result.success).toBe(true);
    });

    it('accepts create з claimIdempotencyKey (anon-claim)', () => {
        const result = CreateBusinessSchema.safeParse({
            ...VALID_CREATE,
            claimIdempotencyKey: VALID_UUID,
        });
        expect(result.success).toBe(true);
    });

    it('rejects невалідний UUID format у claimIdempotencyKey', () => {
        const result = CreateBusinessSchema.safeParse({
            ...VALID_CREATE,
            claimIdempotencyKey: 'not-a-uuid',
        });
        expect(result.success).toBe(false);
    });

    it.each(['individual', 'fop', 'tov', 'organization'] as const)(
        'accepts claimIdempotencyKey у %s variant',
        (type) => {
            const VALID_RNOKPP = '1234567899';
            const VALID_EDRPOU = '12345678';
            const isLegal = type === 'tov' || type === 'organization';
            const isTaxation = type === 'fop' || type === 'tov';
            const result = CreateBusinessSchema.safeParse({
                type,
                name: 'Іваненко',
                taxId: isLegal ? VALID_EDRPOU : VALID_RNOKPP,
                paymentPurposeTemplate: 'Збір',
                claimIdempotencyKey: VALID_UUID,
                ...(isTaxation
                    ? {
                          taxationSystem: 'simplified-3' as const,
                          isVatPayer: false,
                      }
                    : {}),
            });
            expect(result.success).toBe(true);
        }
    );
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

    it('Sprint 9 — accepts top-level taxId update', () => {
        const result = UpdateBusinessSchema.safeParse({
            taxId: '1234567899',
        });
        expect(result.success).toBe(true);
    });

    it('Sprint 9 — accepts ЄДРПОУ taxId на PATCH (payerTaxIdZod union)', () => {
        const result = UpdateBusinessSchema.safeParse({ taxId: '12345678' });
        expect(result.success).toBe(true);
    });

    it('accepts slug edit (vanity-slug rename, da4ec99)', () => {
        const result = UpdateBusinessSchema.safeParse({ slug: 'novyj-slug' });
        expect(result.success).toBe(true);
    });

    it.each([
        'slugLower',
        'type',
        'ownerId',
        'managers',
        'id',
        'createdAt',
        'requisites',
        'invoiceSlugPresetDefault',
        'claimIdempotencyKey',
    ])(
        'rejects невідомий ключ %s через .strict() (Sprint 9 видалені ключі / Sprint 10 immutable claim-key)',
        (key) => {
            const result = UpdateBusinessSchema.safeParse({
                [key]: 'whatever',
            });
            expect(result.success).toBe(false);
        }
    );

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
});

describe('PublicBusinessSchema (Sprint 9 — list-view замість single-account-view)', () => {
    const VALID_PUBLIC = {
        type: 'fop',
        name: 'Іваненко',
        slug: 'IvanEnko',
        seoIndexEnabled: true,
        accounts: [
            {
                slug: 'aB3xQ9k7',
                name: 'ПриватБанк •6001',
                bankCode: 'privatbank' as const,
                ibanMask: '•6001',
            },
            {
                slug: 'cD4yR0l8',
                name: 'monobank •8104',
                bankCode: 'monobank' as const,
                ibanMask: '•8104',
            },
        ],
    };

    it('parses усі whitelist-поля включно з accounts array (Sprint 9 §SP-4)', () => {
        const result = PublicBusinessSchema.safeParse(VALID_PUBLIC);
        expect(result.success).toBe(true);
    });

    it('parses empty accounts array (0-account empty-state, §SP-4)', () => {
        const result = PublicBusinessSchema.safeParse({
            ...VALID_PUBLIC,
            accounts: [],
        });
        expect(result.success).toBe(true);
    });

    it('parses single-account array (1-account 307-redirect source-data, §SP-4)', () => {
        const result = PublicBusinessSchema.safeParse({
            ...VALID_PUBLIC,
            accounts: [VALID_PUBLIC.accounts[0]],
        });
        expect(result.success).toBe(true);
    });

    it('parses account з null bankCode (§SP-9 нерозпізнаний МФО)', () => {
        const result = PublicBusinessSchema.safeParse({
            ...VALID_PUBLIC,
            accounts: [
                {
                    slug: 'aB3xQ9k7',
                    name: 'Банк •6001',
                    bankCode: null,
                    ibanMask: '•6001',
                },
            ],
        });
        expect(result.success).toBe(true);
    });

    it('виносить рівно 5 ключів у parsed-output (whitelist інваріант)', () => {
        // Гарантія, що у public JSON клієнт ніколи не побачить реквізити /
        // ownership / timestamps напряму. accounts-array — це той самий
        // leak-vector, що окремий PublicAccountListItemSchema whitelist
        // (тестується там).
        const result = PublicBusinessSchema.safeParse({
            ...VALID_PUBLIC,
            // Симулюємо backend, що випадково додав leak-поля у view-shape:
            taxId: '1234567899',
            taxationSystem: 'general',
            isVatPayer: true,
            ownerId: '507f1f77bcf86cd799439011',
            paymentPurposeTemplate: 'Оплата за послуги',
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(Object.keys(result.data).sort()).toEqual([
                'accounts',
                'name',
                'seoIndexEnabled',
                'slug',
                'type',
            ]);
        }
    });

    it('Sprint 9 — більше не містить nbuLinks (переїхали на per-account-view)', () => {
        const result = PublicBusinessSchema.parse({
            ...VALID_PUBLIC,
            nbuLinks: {
                primary: 'https://qr.bank.gov.ua/abc123',
                legacy: 'https://bank.gov.ua/qr/abc123',
            },
        });
        expect(result).not.toHaveProperty('nbuLinks');
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
