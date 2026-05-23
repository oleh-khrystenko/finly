import React from 'react';
import { render, screen } from '@testing-library/react';
import type { Business, BusinessType, TaxationSystem } from '@finly/types';
import TaxationSection, { hasTaxationFields } from './TaxationSection';

const VALID_RNOKPP = '1234567899';
const VALID_EDRPOU = '12345678';

/**
 * Sprint 7 §SP-3 — `Business.taxationSystem` / `isVatPayer` `nullable` для
 * не-taxation типів. Factory нижче повертає coupled-валідну фікстуру:
 *  - fop / tov → simplified-3 + isVatPayer=false (default-комбінація);
 *  - individual / organization → null + null (Sprint 7 invariant iff).
 *
 * Будь-який override ризикує порушити iff-refine у `BusinessSchema` (entity
 * Zod), але runtime-парс тут не виконується — фікстура напряму у render.
 */
function makeBusiness(
    overrides: Partial<Business> & { type: BusinessType }
): Business {
    const isTaxationType = overrides.type === 'fop' || overrides.type === 'tov';
    const base: Business = {
        id: '507f1f77bcf86cd799439011',
        type: overrides.type,
        ownerId: '507f1f77bcf86cd799439012',
        managers: [],
        slug: 'IvanEnko',
        slugLower: 'ivanenko',
        name: 'Іваненко',
        taxId:
            overrides.type === 'tov' || overrides.type === 'organization'
                ? VALID_EDRPOU
                : VALID_RNOKPP,
        taxationSystem: isTaxationType ? 'simplified-3' : null,
        isVatPayer: isTaxationType ? false : null,
        paymentPurposeTemplate: 'Оплата',
        seoIndexEnabled: false,
        deletedAt: null,
        createdAt: new Date('2026-05-01'),
        updatedAt: new Date('2026-05-01'),
    };
    return { ...base, ...overrides };
}

/**
 * Sprint 7 §SP-7 — type-guard для conditional unmount у
 * `app/(protected)/business/[slug]/page.tsx`. Тут тестуємо обидва шари:
 *  1. Сам guard повертає true / false коректно для 4 типів;
 *  2. Render-pattern `{hasTaxationFields(b) && <TaxationSection />}` не
 *     додає секцію у DOM для individual / organization (план §7.8 acceptance:
 *     `queryByText('Оподаткування') === null`).
 */
describe('hasTaxationFields — Sprint 7 §SP-7 type-guard', () => {
    // Tuple-тип явно: `it.each<...>` робить `taxationSystem` валідним
    // `TaxationSystem | null` без casts (попередня версія мала
    // broken `as 'simplified-3' | null`-cast, що приводив `'general'` до
    // невідповідного literal-у).
    type GuardCase = readonly [
        type: BusinessType,
        taxationSystem: TaxationSystem | null,
        isVatPayer: boolean | null,
        expected: boolean,
    ];
    const guardCases: readonly GuardCase[] = [
        // Канонічно-валідні комбінації (passes Sprint 7 entity-Zod iff-refine).
        ['fop', 'simplified-3', false, true],
        ['tov', 'general', true, true],
        ['individual', null, null, false],
        ['organization', null, null, false],
        // Drift-кейси (data-corruption, legacy-state). Sprint 7 §7.8 acceptance —
        // type-driven primary блокує render для не-taxation типу навіть якщо
        // дані непустi; symmetrically для taxation-required type з null-полями
        // — guard не пропускає, щоб уникнути runtime-crash у TaxationSection.
        ['individual', 'general', true, false],
        ['organization', 'simplified-3', true, false],
        ['fop', null, null, false],
        ['tov', null, null, false],
        ['fop', 'simplified-3', null, false],
        ['tov', null, true, false],
    ];

    it.each(guardCases)(
        '%s з taxationSystem=%s, isVatPayer=%s → guard=%s',
        (type, taxationSystem, isVatPayer, expected) => {
            const business = makeBusiness({
                type,
                taxationSystem,
                isVatPayer,
            });
            expect(hasTaxationFields(business)).toBe(expected);
        }
    );
});

/**
 * Sprint 7 §7.8 acceptance — page-render без TaxationSection для не-taxation
 * типів. Цей тест моделює render-pattern з `business/[slug]/page.tsx`
 * (line ~254): `{hasTaxationFields(business) && <TaxationSection />}`.
 * Розташований **тут**, поряд з guard-ом, бо логіка conditional unmount —
 * це власне розширення `hasTaxationFields` API; окремий page.spec ризикує
 * накопичити mock-and-stub coupling до useRouter / useParams / fetch / toast,
 * що тут не релевантно.
 */
describe('TaxationSection conditional render (page-level pattern)', () => {
    function EditSectionsPattern({ business }: { business: Business }) {
        // `hasTaxationFields` — type-guard, що narrow-ить `business` до
        // `TaxationCapableBusiness` всередині `&&`-блоку. Жоден `as`-cast тут
        // не потрібен — TS виводить тип сам, і це і є точка перевірки що
        // contract guard-у працює коректно.
        return (
            <div>
                {hasTaxationFields(business) && (
                    <TaxationSection
                        business={business}
                        onSave={() => Promise.resolve()}
                    />
                )}
            </div>
        );
    }

    it('fop → TaxationSection у DOM', () => {
        render(
            <EditSectionsPattern business={makeBusiness({ type: 'fop' })} />
        );
        expect(screen.getByText('Оподаткування')).toBeInTheDocument();
    });

    it('tov → TaxationSection у DOM', () => {
        render(
            <EditSectionsPattern
                business={makeBusiness({
                    type: 'tov',
                    taxationSystem: 'general',
                    isVatPayer: true,
                })}
            />
        );
        expect(screen.getByText('Оподаткування')).toBeInTheDocument();
    });

    it('individual → TaxationSection НЕ у DOM (план §7.8 acceptance)', () => {
        render(
            <EditSectionsPattern
                business={makeBusiness({ type: 'individual' })}
            />
        );
        expect(screen.queryByText('Оподаткування')).toBeNull();
    });

    it('organization → TaxationSection НЕ у DOM', () => {
        render(
            <EditSectionsPattern
                business={makeBusiness({ type: 'organization' })}
            />
        );
        expect(screen.queryByText('Оподаткування')).toBeNull();
    });
});
