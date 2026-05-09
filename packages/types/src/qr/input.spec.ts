import { PAYLOAD_FUNCTIONS_003, PayloadInputSchema } from './input';

// Checksum-valid IBAN та ІПН з Sprint 1 специфікацій валідаторів (iban.spec.ts, tax-id.spec.ts).
const VALID_IBAN = 'UA213223130000026007233566001';
const VALID_IPN = '1234567899';

const baseValidInput = {
    receiverName: 'ФОП Іваненко',
    iban: VALID_IBAN,
    receiverTaxId: VALID_IPN,
    amountKopecks: 35000,
    purpose: 'Оплата консультації',
};

describe('PayloadInputSchema — required fields', () => {
    it('приймає валідний мінімальний input', () => {
        expect(PayloadInputSchema.safeParse(baseValidInput).success).toBe(true);
    });

    it('відхиляє порожній receiverName', () => {
        const result = PayloadInputSchema.safeParse({
            ...baseValidInput,
            receiverName: '   ',
        });
        expect(result.success).toBe(false);
    });

    it('відхиляє невалідний IBAN (неправильна checksum)', () => {
        const result = PayloadInputSchema.safeParse({
            ...baseValidInput,
            iban: 'UA000000000000000000000000000',
        });
        expect(result.success).toBe(false);
    });

    it('відхиляє невалідний receiverTaxId (контрольна цифра)', () => {
        // 1234567890 — перші 9 цифр валідні, але контрольна = 0 замість очікуваного 9.
        const result = PayloadInputSchema.safeParse({
            ...baseValidInput,
            receiverTaxId: '1234567890',
        });
        expect(result.success).toBe(false);
    });

    // -------------------------------------------------------------------------
    // Sprint 7 §SP-10 — `payerTaxIdZod` (union RNOKPP-10 ∪ ЄДРПОУ-8). Норматив
    // НБУ §IV.10.5 явно дозволяє обидві довжини у полі "Код одержувача";
    // Sprint 7 закриває асиметрію валідатора (раніше — лише 10-digit RNOKPP).
    //
    // Ризик 1 з sprint-плану: верифікувати, що Sprint 2 builder не зашиває
    // 10-digit-only constraint у FIELD_LIMITS / payload-002/003. Ці тести
    // перевіряють SAFE-PARSE, builder-rount-trip окремо у `qr.service.integration.spec`.
    // -------------------------------------------------------------------------

    describe('Sprint 7 — receiverTaxId приймає РНОКПП АБО ЄДРПОУ', () => {
        it('приймає 10-digit РНОКПП (status quo, backward-compat)', () => {
            const result = PayloadInputSchema.safeParse({
                ...baseValidInput,
                receiverTaxId: '1234567899',
            });
            expect(result.success).toBe(true);
        });

        it('приймає 8-digit ЄДРПОУ (нова поверхня Sprint 7)', () => {
            const result = PayloadInputSchema.safeParse({
                ...baseValidInput,
                receiverTaxId: '12345678',
            });
            expect(result.success).toBe(true);
        });

        it.each(['1234567', '123456789', '12345678901'])(
            'відхиляє taxId довжини, відсутньої у нормативі (%s)',
            (taxId) => {
                const result = PayloadInputSchema.safeParse({
                    ...baseValidInput,
                    receiverTaxId: taxId,
                });
                expect(result.success).toBe(false);
            }
        );

        it('відхиляє 8-digit з не-цифрою (alpha)', () => {
            const result = PayloadInputSchema.safeParse({
                ...baseValidInput,
                receiverTaxId: '1234567a',
            });
            expect(result.success).toBe(false);
        });

        it('відхиляє порожній рядок', () => {
            const result = PayloadInputSchema.safeParse({
                ...baseValidInput,
                receiverTaxId: '',
            });
            expect(result.success).toBe(false);
        });
    });

    it('приймає amountKopecks = null (клієнт вводить суму)', () => {
        const result = PayloadInputSchema.safeParse({
            ...baseValidInput,
            amountKopecks: null,
        });
        expect(result.success).toBe(true);
    });

    it('приймає amountKopecks = 0 (явний нуль)', () => {
        const result = PayloadInputSchema.safeParse({
            ...baseValidInput,
            amountKopecks: 0,
        });
        expect(result.success).toBe(true);
    });

    it('відхиляє amountKopecks > нормативного максимуму', () => {
        const result = PayloadInputSchema.safeParse({
            ...baseValidInput,
            amountKopecks: 99_999_999_999 + 1,
        });
        expect(result.success).toBe(false);
    });

    it("відхиляє від'ємну amountKopecks", () => {
        const result = PayloadInputSchema.safeParse({
            ...baseValidInput,
            amountKopecks: -1,
        });
        expect(result.success).toBe(false);
    });

    it('відхиляє нецілу amountKopecks (потенційний floating-point pitfall)', () => {
        const result = PayloadInputSchema.safeParse({
            ...baseValidInput,
            amountKopecks: 35000.5,
        });
        expect(result.success).toBe(false);
    });

    it('відхиляє порожній purpose', () => {
        const result = PayloadInputSchema.safeParse({
            ...baseValidInput,
            purpose: '',
        });
        expect(result.success).toBe(false);
    });
});

describe('PayloadInputSchema — 003-only optional fields', () => {
    it('приймає всі 003-поля разом з required', () => {
        const result = PayloadInputSchema.safeParse({
            ...baseValidInput,
            function: 'ICT',
            categoryPurpose: 'OTHR/GDDS',
            reference: 'INV-12345',
            display: 'Дисплейний текст',
            fieldLockMask: 'FEFF',
            validUntil: '260901120000',
            issuedAt: '260501090000',
        });
        expect(result.success).toBe(true);
    });

    it('приймає всі допустимі значення function', () => {
        for (const fn of PAYLOAD_FUNCTIONS_003) {
            const result = PayloadInputSchema.safeParse({
                ...baseValidInput,
                function: fn,
            });
            expect(result.success).toBe(true);
        }
    });

    it('відхиляє невідому function', () => {
        const result = PayloadInputSchema.safeParse({
            ...baseValidInput,
            function: 'ZCT',
        });
        expect(result.success).toBe(false);
    });

    it('приймає valid categoryPurpose у форматі CCCC/PPPP', () => {
        const result = PayloadInputSchema.safeParse({
            ...baseValidInput,
            categoryPurpose: 'SUPP/SUPP',
        });
        expect(result.success).toBe(true);
    });

    it('відхиляє categoryPurpose з малими літерами', () => {
        const result = PayloadInputSchema.safeParse({
            ...baseValidInput,
            categoryPurpose: 'othr/gdds',
        });
        expect(result.success).toBe(false);
    });

    it('відхиляє categoryPurpose без slash', () => {
        const result = PayloadInputSchema.safeParse({
            ...baseValidInput,
            categoryPurpose: 'OTHRGDDS',
        });
        expect(result.success).toBe(false);
    });

    it('приймає fieldLockMask з усіма required-locked бітами (FEFF, FFFF, мін C83E)', () => {
        // FEFF — приклад з PDF (Додаток 4 §V.12 ст. 29): дозволено редагувати лише суму.
        // FFFF — приклад з PDF (§V.18 ст. 33): заборонено все.
        // C83E — мінімальна mask, де required-біти (поля 1-5, 11, 14-15)
        //        точно встановлені у 1, решта = 0.
        //   binary: 1100_1000_0011_1110
        //   bit-pos: 15=1 (поле 15), 14=1 (поле 14), 11=1 (поле 11),
        //            5-1=1 (поля 5-1), 0=0 (reserved, без поля)
        for (const mask of ['FEFF', 'FFFF', 'C83E']) {
            const result = PayloadInputSchema.safeParse({
                ...baseValidInput,
                fieldLockMask: mask,
            });
            expect(result.success).toBe(true);
        }
    });

    it('відхиляє fieldLockMask без required-locked бітів (норматив §II.4.14)', () => {
        // 0000 — нічого не locked → порушення нормативу (поля 1-5, 11, 14-15 мусять бути locked).
        // A1B2 — випадкова mask, що не покриває required bits.
        // 0002 — тільки поле 1 locked (bit-pos 1), бракує 2-5, 11, 14-15.
        // E41F — стара помилкова "мінімальна" з 0-indexed припущенням;
        //        насправді не покриває bit-pos 14-15 та 11 (має 10).
        for (const mask of ['0000', 'A1B2', '0002', 'E41F']) {
            const result = PayloadInputSchema.safeParse({
                ...baseValidInput,
                fieldLockMask: mask,
            });
            expect(result.success).toBe(false);
        }
    });

    it('відхиляє fieldLockMask неправильної довжини або з не-hex', () => {
        for (const mask of ['FFF', 'FFFFF', 'FFFG', '0xFFFF', 'ffff']) {
            const result = PayloadInputSchema.safeParse({
                ...baseValidInput,
                fieldLockMask: mask,
            });
            expect(result.success).toBe(false);
        }
    });

    it('приймає валідний YYMMDDHHmmss', () => {
        const result = PayloadInputSchema.safeParse({
            ...baseValidInput,
            validUntil: '261231235959',
        });
        expect(result.success).toBe(true);
    });

    it('приймає validUntil = null (необмежений термін дії)', () => {
        const result = PayloadInputSchema.safeParse({
            ...baseValidInput,
            validUntil: null,
        });
        expect(result.success).toBe(true);
    });

    it('відхиляє datetime неправильного формату', () => {
        const result = PayloadInputSchema.safeParse({
            ...baseValidInput,
            validUntil: '2026-09-01',
        });
        expect(result.success).toBe(false);
    });
});
