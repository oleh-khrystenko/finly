/**
 * Юр-форма платника (отримувача коштів).
 *
 * Sprint 7 розширює enum з одного варіанта (`'fop'`) на 4. Декартова крос-таблиця
 * 2-х осей (taxId-формат × оподаткування) фіксує саме ці 4 значення; будь-який
 * інший підваріант (ПрАТ, ПАТ, ОСББ-vs-фонд) — підмножина одного з 4, не нове
 * enum-значення (детальний rationale — `docs/sprints/07-payer-types/README.md`
 * §SP-1).
 *
 * **Order matters** — wizard-радіокартки рендеряться у цьому порядку
 * (зверху-вниз / зліва-направо): найпростіший сценарій (індивідуал) спочатку,
 * найрідший (organization) — в кінці.
 */
export const BUSINESS_TYPES = [
    'individual',
    'fop',
    'tov',
    'organization',
] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number];

/**
 * UA-короткий label для UI (radio-cards у wizard-і §7.7, read-mode у
 * `BasicSection` §7.8, SEO `<title>`-теги). Single source of truth — frontend
 * читає звідси, ніяких inline-літералів.
 */
export const BUSINESS_TYPE_LABEL: Record<BusinessType, string> = {
    individual: 'Фізособа',
    fop: 'ФОП',
    tov: 'ТОВ',
    organization: 'Неприбуткова організація',
};

/**
 * Підмножина типів, для яких поля `taxationSystem` і `isVatPayer` обов'язкові
 * (Sprint 7 §SP-3 інваріант iff). Для `individual` / `organization` ці поля —
 * `null`, бо юр-семантично оподаткування не застосовується (фізособа з
 * особистим збором, неприбуткова організація).
 *
 * Тримаємо як окрему `as const`-tuple — refine у `BusinessSchema` і
 * service-layer cross-check читають саме звідси, без зашитого `(type === 'fop'
 * || type === 'tov')`-дубля. Додавання типу з оподаткуванням у майбутньому —
 * point-edit цієї tuple.
 */
export const TAXATION_REQUIRED_TYPES = [
    'fop',
    'tov',
] as const satisfies readonly BusinessType[];

export type TaxationRequiredType = (typeof TAXATION_REQUIRED_TYPES)[number];

/**
 * `true` для типів, де `taxationSystem` і `isVatPayer` обов'язкові.
 *
 * Single source of truth для:
 *  - Zod refine у `BusinessSchema` (read-side інваріант).
 *  - `BusinessesService.update` cross-check (PATCH без `type` → читає
 *    document-resident `type`).
 *  - Frontend conditional rendering (`TaxationSection` unmount, wizard
 *    dynamic step-list).
 */
export const requiresTaxation = (type: BusinessType): boolean =>
    (TAXATION_REQUIRED_TYPES as readonly BusinessType[]).includes(type);

/**
 * Довжина "Коду одержувача" згідно нормативу НБУ постанови № 97 (додатки 3/4):
 *  - 10 цифр — РНОКПП (фізособа / ФОП).
 *  - 8 цифр — ЄДРПОУ (юр.особа: ТОВ / ОСББ / фонд / тощо).
 *
 * Discriminator-таблиця замість `if/else` чи `.includes()` — додавання нового
 * `BusinessType` без оновлення цього мапінгу дає compile-error через
 * `Record<BusinessType, ...>` exhaustiveness (fail-fast convention).
 */
const TAX_ID_LENGTH_BY_TYPE: Record<BusinessType, 8 | 10> = {
    individual: 10,
    fop: 10,
    tov: 8,
    organization: 8,
};

export const taxIdLengthFor = (type: BusinessType): 8 | 10 =>
    TAX_ID_LENGTH_BY_TYPE[type];
