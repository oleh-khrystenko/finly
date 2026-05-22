import type { BusinessType } from './business-type';

/**
 * Система оподаткування — sprint 3 рішення C1
 * (`docs/sprints/03-cabinet-public/planning-questions.md`).
 *
 * **Чому окремі поля `taxationSystem` і `isVatPayer`** (а не комбінований
 * enum `simplified-3-vat`): юр-семантика — це **дві ортогональні осі**.
 * Бути на спрощеній-3 і не платити ПДВ — валідно. Платити ПДВ на спрощеній-1
 * — нелегально. Coupled-валідація живе у `entities/business.ts > BusinessSchema`
 * як refine з кодом `INVALID_VAT_FOR_TAXATION_SYSTEM` (повторюємо паттерн
 * sprint 1 `OWNERLESS_BUSINESS_REQUIRES_MANAGER`).
 *
 * **Юр-обмеження за типом бізнесу** (ПКУ розд. XIV гл. 1):
 *  - Групи 1 і 2 спрощеної системи — виключно для фізичних осіб-підприємців
 *    (ФОП). Юр-особи (ТОВ) на них перебувати не можуть.
 *  - Група 3 і загальна система — для обох (ФОП і ТОВ).
 *
 * Allowed-set per-type живе у `ALLOWED_TAXATION_SYSTEMS_BY_TYPE` нижче.
 * Refine `TAXATION_SYSTEM_NOT_ALLOWED_FOR_TYPE` у `BusinessSchema` /
 * write-DTO `createTovVariant` блокує невалідні комбінації; service-layer
 * `BusinessesService.update` повторює перевірку для partial-PATCH, де DTO
 * не несе `type`.
 */

export const TAXATION_SYSTEMS = [
    'simplified-1',
    'simplified-2',
    'simplified-3',
    'general',
] as const;

export type TaxationSystem = (typeof TAXATION_SYSTEMS)[number];

/**
 * Допустимі системи оподаткування за типом бізнесу. Для не-taxation-типів
 * (`individual`, `organization`) список порожній — поля `taxationSystem` /
 * `isVatPayer` у них null (інваріант `TAXATION_FIELDS_MISMATCH_TYPE`).
 *
 * Single source of truth для:
 *  - entity-Zod refine `TAXATION_SYSTEM_NOT_ALLOWED_FOR_TYPE` (read-side);
 *  - write-DTO refine на `createTovVariant` (cabinet write);
 *  - service-layer cross-check у `BusinessesService.update` (PATCH, де DTO
 *    не несе `type`);
 *  - UI-filter SELECT-options у `Step3Taxation` / `TaxationSection`.
 */
export const ALLOWED_TAXATION_SYSTEMS_BY_TYPE: Record<
    BusinessType,
    readonly TaxationSystem[]
> = {
    individual: [],
    fop: ['simplified-1', 'simplified-2', 'simplified-3', 'general'],
    tov: ['simplified-3', 'general'],
    organization: [],
};

export const isTaxationAllowedForType = (
    type: BusinessType,
    system: TaxationSystem
): boolean =>
    (
        ALLOWED_TAXATION_SYSTEMS_BY_TYPE[type] as readonly TaxationSystem[]
    ).includes(system);

/**
 * Підмножина систем оподаткування, на яких ФОП legitimно може бути платником
 * ПДВ. Спрощена-1 / -2 — заборонено законом; спрощена-3 і загальна — дозволено.
 *
 * Тримаємо як окрему `as const`-tuple, щоб coupled-refine у `BusinessSchema`
 * (`isVatPayer === true` дозволено лише при `taxationSystem ∈ цей set`)
 * не дублював літерали — рев'юверу видно, **що саме** перевіряється.
 */
export const VAT_ALLOWED_TAXATION_SYSTEMS = [
    'simplified-3',
    'general',
] as const satisfies readonly TaxationSystem[];

export type VatAllowedTaxationSystem =
    (typeof VAT_ALLOWED_TAXATION_SYSTEMS)[number];

export const isVatAllowedTaxationSystem = (
    value: TaxationSystem
): value is VatAllowedTaxationSystem =>
    (VAT_ALLOWED_TAXATION_SYSTEMS as readonly TaxationSystem[]).includes(value);

/**
 * UA-лейбли для UI (форма wizard-а §3.7, картка кабінету §3.8). Single source
 * of truth — frontend і email-копія читають звідси, ніяких inline-літералів.
 */
export const TAXATION_SYSTEM_LABEL: Record<TaxationSystem, string> = {
    'simplified-1': 'Спрощена-1',
    'simplified-2': 'Спрощена-2',
    'simplified-3': 'Спрощена-3',
    general: 'Загальна',
};
