import {
    BRAND_DISPLAY_NAME_MAX_LENGTH,
    brandDisplayNameSchema,
    brandSlotSchema,
    businessBrandSchema,
    pendingBrandSlotSchema,
} from './brand';

const BEL = String.fromCharCode(0x07);
const DEL = String.fromCharCode(0x7f);
const LF = String.fromCharCode(0x0a);

describe('brandDisplayNameSchema', () => {
    it('приймає звичайну назву', () => {
        expect(
            brandDisplayNameSchema.safeParse('Кав’ярня «Зерно»').success
        ).toBe(true);
    });

    it('тримить пробіли по краях', () => {
        expect(brandDisplayNameSchema.parse('  Зерно  ')).toBe('Зерно');
    });

    it('відхиляє порожній рядок після trim', () => {
        expect(brandDisplayNameSchema.safeParse('   ').success).toBe(false);
    });

    it(`відхиляє довше за ${BRAND_DISPLAY_NAME_MAX_LENGTH} символів`, () => {
        const tooLong = 'я'.repeat(BRAND_DISPLAY_NAME_MAX_LENGTH + 1);
        expect(brandDisplayNameSchema.safeParse(tooLong).success).toBe(false);
    });

    it(`приймає рівно ${BRAND_DISPLAY_NAME_MAX_LENGTH} символів`, () => {
        const exact = 'я'.repeat(BRAND_DISPLAY_NAME_MAX_LENGTH);
        expect(brandDisplayNameSchema.safeParse(exact).success).toBe(true);
    });

    it('відхиляє перенос рядка (ламає однорядкову бренд-марку)', () => {
        expect(brandDisplayNameSchema.safeParse(`Зерно${LF}Кава`).success).toBe(
            false
        );
    });

    it('відхиляє контрол-символи (BEL / DEL)', () => {
        expect(
            brandDisplayNameSchema.safeParse(`Зерно${BEL}Кава`).success
        ).toBe(false);
        expect(brandDisplayNameSchema.safeParse(`Зерно${DEL}`).success).toBe(
            false
        );
    });
});

describe('brandSlotSchema', () => {
    const VALID_SLOT = {
        logoUrl: 'https://cdn.finly.test/brand-logos/x/a.webp',
        centerMarkUrl: 'https://cdn.finly.test/brand-logos/x/center.png',
        bandMarkUrl: 'https://cdn.finly.test/brand-logos/x/band.png',
        displayName: 'Зерно',
    };

    it('парсить повний слот', () => {
        expect(brandSlotSchema.safeParse(VALID_SLOT).success).toBe(true);
    });

    it('приймає лого-тільки (displayName === null)', () => {
        expect(
            brandSlotSchema.safeParse({ ...VALID_SLOT, displayName: null })
                .success
        ).toBe(true);
    });

    it('відхиляє не-URL у logoUrl', () => {
        expect(
            brandSlotSchema.safeParse({ ...VALID_SLOT, logoUrl: 'not-a-url' })
                .success
        ).toBe(false);
    });

    it('pendingBrandSlotSchema вимагає uploadedAt + demoted', () => {
        expect(pendingBrandSlotSchema.safeParse(VALID_SLOT).success).toBe(
            false
        );
        // uploadedAt без demoted — все ще невалідний.
        expect(
            pendingBrandSlotSchema.safeParse({
                ...VALID_SLOT,
                uploadedAt: new Date(),
            }).success
        ).toBe(false);
        expect(
            pendingBrandSlotSchema.safeParse({
                ...VALID_SLOT,
                uploadedAt: new Date(),
                demoted: false,
            }).success
        ).toBe(true);
    });
});

describe('businessBrandSchema', () => {
    it('парсить порожній бренд (обидва слоти null)', () => {
        expect(
            businessBrandSchema.safeParse({ active: null, pending: null })
                .success
        ).toBe(true);
    });
});
