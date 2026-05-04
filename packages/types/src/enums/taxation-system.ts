/**
 * Система оподаткування ФОП — sprint 3 рішення C1
 * (`docs/sprints/03-cabinet-public/planning-questions.md`).
 *
 * **Чому окремі поля `taxationSystem` і `isVatPayer`** (а не комбінований
 * enum `simplified-3-vat`): юр-семантика — це **дві ортогональні осі**.
 * Бути на спрощеній-3 і не платити ПДВ — валідно. Платити ПДВ на спрощеній-1
 * — нелегально. Coupled-валідація живе у `entities/business.ts > BusinessSchema`
 * як refine з кодом `INVALID_VAT_FOR_TAXATION_SYSTEM` (повторюємо паттерн
 * sprint 1 `OWNERLESS_BUSINESS_REQUIRES_MANAGER`).
 *
 * **Скоуп MVP** — лише ФОП-варіанти. Юр-форми ТОВ/ВАТ матимуть свої правила
 * (загальна система може мати інші характеристики для юр.особи); розширення —
 * окрема ініціатива при додаванні `BusinessType ≠ 'fop'`. Migration не
 * потрібна, бо існуючі бізнеси заповнили лише ФОП-валідні значення.
 */

export const TAXATION_SYSTEMS = [
    'simplified-1',
    'simplified-2',
    'simplified-3',
    'general',
] as const;

export type TaxationSystem = (typeof TAXATION_SYSTEMS)[number];

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
