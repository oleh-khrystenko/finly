import { BusinessSchema } from './business';
import {
    buildPersonalizedPurpose,
    containsPurposeMarker,
    findKnownPurposeMarkers,
    findUnknownPurposeMarkers,
    purposeMarkerToken,
    substitutePurposeMarkers,
    uniquePurposeMarkers,
} from './purpose-markers';

describe('purpose markers', () => {
    it('розпізнає відомі маркери у порядку появи', () => {
        expect(
            findKnownPurposeMarkers('ЄСВ {taxId} за {period} від {fullName}')
        ).toEqual(['taxId', 'period', 'fullName']);
    });

    it('containsPurposeMarker true лише за наявності відомого маркера', () => {
        expect(containsPurposeMarker('Оплата {taxId}')).toBe(true);
        expect(containsPurposeMarker('Оплата за послуги')).toBe(false);
        // Невідомий токен не рахується відомим маркером.
        expect(containsPurposeMarker('Оплата {foo}')).toBe(false);
    });

    it('findUnknownPurposeMarkers ловить токени поза словником', () => {
        expect(findUnknownPurposeMarkers('ЄСВ {taxId} код {mfo}')).toEqual([
            'mfo',
        ]);
        expect(findUnknownPurposeMarkers('ЄСВ {taxId} за {period}')).toEqual(
            []
        );
    });

    it('«мертвий» маркер з пробілами/підкресленням/цифрою рахується невідомим', () => {
        // Вузький `[A-Za-z]+` такі токени не матчив узагалі: шаблон проходив
        // валідацію, форма підстановки поля не рендерила, і літеральний
        // `{ taxId }` їхав у призначення податкового платежу.
        for (const dead of ['{ taxId }', '{tax_id}', '{taxId2}', '{TaxId }']) {
            expect(findUnknownPurposeMarkers(`ЄСВ ${dead}`)).toHaveLength(1);
            expect(findKnownPurposeMarkers(`ЄСВ ${dead}`)).toEqual([]);
        }
    });

    it('підстановка не чіпає невідомі токени', () => {
        expect(
            substitutePurposeMarkers('ЄСВ {taxId} код { taxId }', {
                taxId: '1234567890',
            })
        ).toBe('ЄСВ 1234567890 код { taxId }');
    });

    it('purposeMarkerToken огортає у фігурні дужки', () => {
        expect(purposeMarkerToken('taxId')).toBe('{taxId}');
    });

    it('uniquePurposeMarkers прибирає повтори', () => {
        expect(uniquePurposeMarkers('{taxId} {taxId} {period}')).toEqual([
            'taxId',
            'period',
        ]);
    });

    it('substitutePurposeMarkers підставляє надані значення', () => {
        expect(
            substitutePurposeMarkers('ЄСВ {taxId} за {period}', {
                taxId: '1234567899',
                period: '3 квартал 2026',
            })
        ).toBe('ЄСВ 1234567899 за 3 квартал 2026');
    });

    it('токен усередині значення не підставляється вдруге', () => {
        // Дужки входять у NBU-charset, тож `{period}` проходить валідацію ПІБ.
        // Послідовна заміна маркер-за-маркером підставила б його ще раз, і
        // призначення платежу мовчки відрізнялося б від введеного платником.
        expect(
            substitutePurposeMarkers('ЄСВ {taxId}, платник {fullName}', {
                taxId: '1234567899',
                fullName: 'Іван {period} Петренко',
                period: '3 квартал 2026',
            })
        ).toBe('ЄСВ 1234567899, платник Іван {period} Петренко');
    });

    it('buildPersonalizedPurpose повертає missing при неповних даних', () => {
        const result = buildPersonalizedPurpose('ЄСВ {taxId} за {period}', {
            taxId: '1234567899',
        });
        expect(result).toEqual({
            ok: false,
            reason: 'incomplete',
            missing: ['period'],
        });
    });

    it('buildPersonalizedPurpose підставляє при повних даних', () => {
        const result = buildPersonalizedPurpose('ЄСВ {taxId}', {
            taxId: '1234567899',
        });
        expect(result).toEqual({ ok: true, purpose: 'ЄСВ 1234567899' });
    });

    it('buildPersonalizedPurpose відхиляє зібране призначення понад ліміт NBU', () => {
        // Шаблон біля межі + максимальний ПІБ дають purpose понад норматив.
        const template = `${'A'.repeat(360)} {fullName}`;
        const result = buildPersonalizedPurpose(template, {
            fullName: 'B'.repeat(80),
        });
        expect(result).toEqual({ ok: false, reason: 'too-long' });
    });
});

const SYSTEM_BASE = {
    id: '507f1f77bcf86cd799439011',
    type: 'organization' as const,
    ownerId: null,
    managers: [] as string[],
    slug: 'dps-lviv',
    slugLower: 'dps-lviv',
    name: 'Головне управління ДПС у Львівській області',
    taxId: '12345678',
    taxationSystem: null,
    isVatPayer: null,
    paymentPurposeTemplate: 'Єдиний внесок {taxId} за {period}',
    seoIndexEnabled: false,
    isSystem: true,
    catalogVisible: true,
    deletedAt: null,
    brandedAt: null,
    brand: null,
    createdAt: '2026-05-01T10:00:00.000Z',
    updatedAt: '2026-05-01T10:00:00.000Z',
};

describe('BusinessSchema — системний отримувач (Sprint 29)', () => {
    it('приймає нічий системний запис із порожніми managers і маркерами', () => {
        const result = BusinessSchema.safeParse(SYSTEM_BASE);
        expect(result.success).toBe(true);
    });

    it('звичайний бізнес із маркером у призначенні відхиляється', () => {
        const result = BusinessSchema.safeParse({
            ...SYSTEM_BASE,
            isSystem: false,
            ownerId: '507f1f77bcf86cd799439012',
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0]!.message).toBe(
                'PURPOSE_MARKERS_NOT_ALLOWED'
            );
        }
    });

    it('нічий не-системний запис без managers лишається невалідним', () => {
        const result = BusinessSchema.safeParse({
            ...SYSTEM_BASE,
            isSystem: false,
            paymentPurposeTemplate: 'Оплата за послуги',
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0]!.message).toBe(
                'OWNERLESS_BUSINESS_REQUIRES_MANAGER'
            );
        }
    });
});
