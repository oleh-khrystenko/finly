# Sprint 1 — Архітектурний фундамент

> **Статус:** working draft, 2026-05-01.
> **Передумови:** жодних — це перший спринт MVP.
> **Що розблоковує:** Спринт 2 (QR-ядро), Спринт 3 (кабінет + публічна вивіска).

---

## Мета

Закласти **схеми БД і юридичну основу** для MVP. Робимо ту частину, яка коштує копійки зараз і дорого — потім (міграції, ризик у проді). UI/повноцінні endpoints — у наступних спринтах.

## Скоуп

- ✅ Схеми Mongoose + Zod-контракти у `packages/types`.
- ✅ Mongoose-індекси.
- ✅ **Tooling:** налаштувати Jest у `packages/types` (наразі пакет не має `test` script — `packages/types/package.json:12`). Без цього кроку DoD-пункти "`pnpm --filter @finly/types test` зелений" і "golden-vector тести для IBAN/ІПН" недосяжні.
- ✅ **Повноцінні** валідатори реквізитів (IBAN MOD-97 checksum, ІПН control digit) — без них фундамент випускає невалідні дані в БД ще до Sprint 2.
- ✅ Onboarding-interceptor: додати `lastName` як обов'язкове поле.
- ✅ Юридичні сторінки (TOS, Privacy) — текст, не ToS-version-bump-логіку (вона вже є).
- ✅ Покриття unit-тестами для нових entity-схем (instantiation, валідатори, indexes через `MongoMemoryServer`).

## НЕ-скоуп

- ❌ Жодних REST endpoints для Business / Invoice — це Спринт 3-4.
- ❌ Жодного UI для Business / Invoice — Спринт 3-4.
- ❌ QR-payload-генерація і per-version (002/003) валідатори довжин полів — це Спринт 2 (там валідатор реквізитів використовується з payload-builder-а).
- ❌ `taxationSystem` поле в схемі Business — додаємо в Спринт 3 разом з UI-формою, де фіксуємо enum остаточно.
- ❌ KYC, delegated managers, передача `ownerId` — Phase 1.5+.
- ❌ Migration script для legacy users без `lastName` — використовуємо існуючий `OnboardingInterceptor` (force-complete profile при наступному вході).

---

## Епіки

### 1.1 User schema upgrade

- [ ] `lastName` → required у профілі
  - У `UserProfileData` (`apps/api/src/modules/users/schemas/user.schema.ts:21`) поле залишається optional у Mongoose-типі (legacy users), але `OnboardingInterceptor` починає блокувати роути з `ONBOARDING_INCOMPLETE` поки `lastName` не заповнений.
  - Zod-контракт оновлення профілю (`packages/types/src/contracts/users.ts`) вимагає `lastName` як non-empty string.
  - Web: форма онбордингу додає поле "Прізвище" поряд з "Ім'я".
- [ ] `role` на верхньому рівні `User`
  - Значення: `'user' | 'admin'`. **"Гість" свідомо НЕ кладемо в БД** — це стан "немає JWT", entity не створюється.
  - Дефолт: `'user'`. NestJS-роути під `'admin'` у MVP **не пишуться** — лише поле.
  - У `packages/types/src/enums/user-role.ts` — `as const` array (див. Cross-cutting > Convention), реекспортовано як один source of truth для Zod, Mongoose і TS-type.
- [ ] `worksAsBookkeeper: boolean` на верхньому рівні `User`
  - Дефолт: `false`. Toggle-логіка (вплив на форму створення Business) — Спринт 3.
- [ ] Indexes — без змін на цьому етапі (`role` і `worksAsBookkeeper` не запитуємо у hot-path).
- [ ] Тести: оновити фікстури в `apps/api/test/**` під нові обов'язкові поля.

**DoD:** `pnpm --filter api test` зелений; `getMe()` повертає `role` і `worksAsBookkeeper`; онбординг блокує роути без `lastName`.

---

### 1.2 Business schema (нова сутність)

Файл: `apps/api/src/modules/businesses/schemas/business.schema.ts` (новий модуль, поки **без** controller — лише `@Module` із `MongooseModule.forFeature`).

- [ ] Поля верхнього рівня
  - [ ] `type: BusinessType` — у MVP лише `'fop'` (`BUSINESS_TYPES = ['fop'] as const`). Структура schema/Zod готова до розширення новими значеннями, але **wire-values для ТОВ / ВАТ свідомо НЕ фіксуємо зараз** — `'vat'` як транслітерація ВАТ конфліктує з міжнародною абревіатурою VAT (Value-Added Tax) у бухгалтерському контексті, тож конкретні рядки обговорюються разом з юр. доменом у момент додавання типу (одночасно з ЄДРПОУ-валідатором і per-type правилами реквізитів).
  - [ ] `ownerId: ObjectId | null` — nullable з самого початку.
  - [ ] `managers: ObjectId[]` — масив user-id; non-empty якщо `ownerId === null` (інваріант на app-layer, не у Mongoose-валідаторі — Mongoose не знає про комбінаторні правила).
  - [ ] `slug: string` — глобально-унікальний, lowercase, kebab-case; формат і генератор див. далі.
  - [ ] `name: string` — public-name бізнесу (наприклад `"Іваненко"`); рендер на UI як `"{typeLabel} {name}"` через мапу `BUSINESS_TYPE_LABEL`.
  - [ ] `requisites` (subdoc, поки лише ФОП-варіант)
    - [ ] `iban: string` — повний валідатор: prefix `UA`, 27 знаків, MOD-97 checksum (стандарт ISO 13616). Реалізація — у спільному `packages/types/src/validation/iban.ts`, споживається і Zod-схемою, і Sprint 2 QR-payload-builder.
    - [ ] `taxId: string` — ІПН для ФОП: 10 цифр + control digit (алгоритм ДПС: `Σ(digit_i × weight_i) mod 11`). Реалізація — у `packages/types/src/validation/tax-id.ts`.
    - [ ] **`taxationSystem` свідомо НЕ додаємо у Sprint 1** — точний enum (єдиний податок 1/2/3, загальна, ПДВ-плательник) фіксуємо в Спринті 3 разом з UI-формою. Додавати поле зараз як `string` без enum = пропуск невалідних значень в БД.
  - [ ] `paymentPurposeTemplate: string` — текстовий шаблон призначення платежу за замовчуванням; per-invoice override живе у Invoice (1.3).
  - [ ] `acceptedBanks: BankCode[]` — підмножина з `MVP_BANKS` константи (див. нижче).
  - [ ] `deletedAt: Date | null` — soft-delete. Hard-delete + cron — Phase 1.5+ (зараз schema-готова, cron не пишемо).
  - [ ] `createdAt`, `updatedAt` через `timestamps: true`.
- [ ] Indexes
  - [ ] `{ slug: 1 }` — unique.
  - [ ] `{ ownerId: 1 }` — sparse (для запиту "мої бізнеси").
  - [ ] `{ managers: 1 }` — для запиту "бізнеси, де я керівник".
- [ ] Reserved-slug константа
  - Файл `packages/types/src/constants/reserved-slugs.ts`: `['qr', 'api', 'static', '_next', '_health']` (з `qr-decisions.md` 4.3). Slug-генератор у Спринті 3 буде з цього читати.
- [ ] MVP-набір банків
  - Файл `packages/types/src/constants/banks.ts`: `MVP_BANKS = [...] as const` — 11 кодів (`privatbank`, `monobank`, `pumb`, `oschadbank`, `sense`, `ukrgazbank`, `sportbank`, `izibank`, `raiffeisen`, `abank`, `credit_dnipro`).
  - Тип `BankCode = (typeof MVP_BANKS)[number]`.
  - Display-метадані (label, logo) — НЕ тут; це задача Спринту 3 (UI-шар).

**DoD:** schema instantiation у unit-тесті проходить; reject-тест на дублікат slug; reject-тест на невалідний `BankCode` у `acceptedBanks`.

**Відкриті питання, що НЕ блокують Sprint 1:**
- Точний enum `taxationSystem` (поле додається у Sprint 3 разом з формою).
- Free-tier обмеження на `acceptedBanks` (Open Q #5 з business-flow) — застосовується на app-layer у Sprint 6.
- Per-version (002/003) обмеження довжин для `name` / `paymentPurposeTemplate` — фіксуємо в Sprint 2 поверх існуючих `min/max` Zod-обмежень.

---

### 1.3 Invoice schema (нова сутність)

Файл: `apps/api/src/modules/invoices/schemas/invoice.schema.ts` (новий модуль, без controller).

- [ ] Поля верхнього рівня
  - [ ] `businessId: ObjectId` — required, ref to Business.
  - [ ] `slug: string` — формат `{людська-частина}-{8-char-tail}` або `{tail}` (qr-decisions §4.3.1). Унікальність — у межах бізнесу (compound index).
  - [ ] `amount: number | null` — `null` означає "клієнт вводить сам" (вивіска-режим у межах інвойсу — рідкісний, але валідний).
  - [ ] `amountLocked: boolean` — дефолт `false`; `true` = клієнт не може правити суму (qr-decisions §1.4).
  - [ ] `paymentPurpose: string | null` — per-invoice override; `null` = використовуємо `business.paymentPurposeTemplate`.
  - [ ] `validUntil: Date | null` — `null` = без терміну дії (qr-decisions §1.5).
  - [ ] `slugPreset: SlugPreset | null` — який пресет згенерував slug (`'simple' | 'with-month' | 'with-year' | 'with-purpose' | null`); потрібно для аналітики/відлагодження, не для логіки.
  - [ ] `deletedAt: Date | null` — soft-delete.
  - [ ] `createdAt`, `updatedAt`.
- [ ] **Що навмисне НЕ закладаємо** (Модель А, qr-decisions §1.12)
  - ❌ `paidAt`, `transactions[]`, `paymentStatus` — трекінг оплат це Phase 1.5.
  - ❌ Webhook-pointers до банків.
  - **Архітектурний guard:** структура така, що додавання `paidAt` + окремої таблиці `Transaction` пізніше **не вимагає** переписувати Invoice (тільки `$set` нового поля).
- [ ] Indexes
  - [ ] `{ businessId: 1, slug: 1 }` — compound unique.
  - [ ] `{ businessId: 1, createdAt: -1 }` — для списку інвойсів у кабінеті.
  - [ ] `{ validUntil: 1 }` — sparse, для майбутнього cron "expired invoices" (cron не пишемо у Sprint 1).
- [ ] Slug-preset values у `packages/types/src/enums/slug-preset.ts`: `'simple' | 'with-month' | 'with-year' | 'with-purpose'` (qr-decisions §4.3.1.1) — `as const` array.

**DoD:** schema instantiation; compound-unique reject-тест; `validUntil < createdAt` має бути app-layer-помилка (НЕ Mongoose-валідатор — це rule, що залежить від часу запиту).

---

### 1.4 Валідатори реквізитів (shared, у `packages/types`)

Цей епік існує, бо інакше Business schema приймає невалідні дані до Sprint 2. Логіку пишемо один раз, переживає й Sprint 2 (QR-payload), і Sprint 3 (UI-форми).

- [ ] `packages/types/src/validation/iban.ts`
  - [ ] `isValidIban(value: string): boolean` — формат `UA\d{27}` + ISO 13616 MOD-97 checksum.
  - [ ] `ibanZod` — `z.string().refine(isValidIban, { message: 'INVALID_IBAN' })` для прямого використання у `business.ts` контракті.
- [ ] `packages/types/src/validation/tax-id.ts`
  - [ ] `isValidIndividualTaxId(value: string): boolean` — 10 цифр + control digit за алгоритмом ДПС (ваги `-1, 5, 7, 9, 4, 6, 10, 5, 7`, контрольна = `Σ mod 11 mod 10`).
  - [ ] `individualTaxIdZod` — Zod-варіант.
  - [ ] **НЕ робимо ЄДРПОУ-валідатор** — він знадобиться лише з ТОВ/ВАТ (Phase 1.5+).
- [ ] Unit-тести: golden-vector (5+ валідних IBAN з UA-банків + 5+ невалідних з різними failure-modes; те саме для ІПН).

**DoD:** `pnpm --filter @finly/types test` зелений; функції експортовані з `index.ts` для імпорту з api / web.

---

### 1.5 Юридичні сторінки

Файли: `apps/web/src/app/privacy/page.tsx`, `apps/web/src/app/terms/page.tsx`.

- [ ] Privacy Policy
  - Узгодити з брендом Finly (rebrand вже у `8b3e8de`, перевірити консистентність).
  - Описати, що сервіс **генерує** платіжні посилання та QR-коди, **не зберігає** платіжні дані клієнтів і **не проводить** платежі сам.
  - Згадати "Бізнес" як окрему сутність (ФОП у MVP, ТОВ/ВАТ у майбутньому).
- [ ] Terms of Service
  - Аналогічно — узгодити з продуктом.
  - Окремо позначити, що **трекінг оплат не входить у scope** (Модель А) — превентивно проти юзерських очікувань.
- [ ] Bump `TERMS_VERSION`
  - Існуюча інфраструктура: `authStore` показує modal при outdated `termsVersion` — новий рядок версії автоматично спрацює.
- [ ] Тексти писати **під ревʼю юриста**.
  - У Sprint 1 — drафт; final-вичитування може бути асинхронним і не блокувати лонч кабінету (Sprint 3), але **мусить** закритись до публічного релізу (Sprint 6).

**DoD:** обидві сторінки рендеряться, посилаються одна на одну, `TERMS_VERSION` bumpнутий, регресія на existing modal "прийняти умови" не зламана.

---

## Cross-cutting

### Convention: `as const` замість TS `enum`

У всьому новому коді **не використовуємо** TS-кейворд `enum` — повторюємо існуючу конвенцію репо (`RESPONSE_CODE`, `RESPONSE_TYPE` у `packages/types/src/enums/response-code.ts`).

**Стандартна форма для нових перерахувань зі Sprint 1** — `as const` tuple + type extraction:

```ts
// packages/types/src/enums/user-role.ts
export const USER_ROLES = ['user', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];
```

Один source of truth, що компонується з усіма споживачами без adapter-коду:
- **Zod:** `z.enum(USER_ROLES)` (приймає readonly tuple напряму).
- **Mongoose:** `@Prop({ type: String, enum: USER_ROLES, default: 'user' })` — `enum` тут — це опція Mongoose, не TS-кейворд (Mongoose очікує саме array).
- **TS-type:** `UserRole` для функцій / DTO / форм.

**Object-form (як у `RESPONSE_CODE`)** залишаємо лише там, де ключ і значення семантично різні (DX-name vs wire-value). Для plain value-list — array form.

### Контракти у `packages/types`

Все, що підпадає під обидва runtime-и (api + web), іде сюди:
- `entities/business.ts`, `entities/invoice.ts` — Zod-схеми + TS-типи.
- `enums/user-role.ts`, `enums/business-type.ts`, `enums/slug-preset.ts` — за конвенцією вище.
- `constants/banks.ts`, `constants/reserved-slugs.ts`.
- Build-порядок: `pnpm --filter @finly/types build` має пройти **до** API/Web build.

### Тести

- **Tooling-передумова** (виконати **до** написання тестів у `@finly/types`):
  - [ ] Додати dev-deps: `jest`, `ts-jest`, `@types/jest` у `packages/types/package.json` (через `pnpm --filter @finly/types add -D ...`). Версію `jest` тримаємо синхронно з `apps/api` (Jest 30).
  - [ ] Створити `packages/types/jest.config.ts` (preset `ts-jest`, `testEnvironment: 'node'`, `testMatch` = `<rootDir>/src/**/*.spec.ts`).
  - [ ] Додати у `scripts`: `"test": "jest"`, `"test:watch": "jest --watch"`. Перевірити, що `pnpm test` (turbo на корені) тепер підхоплює `@finly/types`.
  - [ ] Оновити `packages/types/tsconfig.json` для test-файлів (включити `jest` у `types: [...]`) — або окремий `tsconfig.spec.json`, як зручніше.
  - [ ] Перевірити, що CI (`.github/workflows/ci.yml`) виконує тести `@finly/types` без додаткових налаштувань (turbo-pipeline вже включає `test`).
- Unit (api): `apps/api/src/modules/businesses/schemas/business.schema.spec.ts`, `…/invoices/schemas/invoice.schema.spec.ts` — instantiation + Zod валідація + reject на невалідні підстановки.
- **Integration (api) з `MongoMemoryServer`** (вже у стеку, див. `apps/api/src/test-setup.ts`):
  - Створюються collections `businesses` і `invoices` при першому save.
  - Indexes побудовані: `db.collection('businesses').indexes()` повертає очікуваний набір (`slug` unique, `ownerId`, `managers`); `db.collection('invoices').indexes()` — `(businessId, slug)` compound unique, `(businessId, createdAt)`, `validUntil` sparse.
  - Duplicate-key reject спрацьовує (insert одного ж slug двічі → `MongoServerError` з кодом 11000).
- Unit (types): golden-vector тести для IBAN/ІПН валідаторів (1.4) + smoke-тест Zod-схем (parse валідного об'єкта + reject невалідного).
- E2E: **не додаємо** у Sprint 1 — endpoints поки не існують.

---

## Definition of Done (спринт у цілому)

- [ ] `pnpm build` зелений у всіх workspace.
- [ ] `pnpm test` зелений (api + types + web), включно з integration-тестом collections+indexes (Cross-cutting > Тести).
- [ ] `pnpm lint` без warnings.
- [ ] `getMe()` повертає `role` і `worksAsBookkeeper` (перевіряється existing API-spec, оновити assertions).
- [ ] Privacy + Terms pages рендеряться з оновленим текстом, `termsVersion` modal спрацьовує на existing user-сесії (web-spec на `AuthInitializer`).
- [ ] PR-опис містить посилання на цей документ і на конкретні розділи `business-flow.md` / `qr-decisions.md`, на яких базуються рішення.

---

## Ризики / TPM-зауваги

Розділені на дві групи: ризики, що блокують **закриття Sprint 1**, і відомі обмеження, що свідомо виходять за межі цього спринту (вирішуються у наступних — посилання конкретні, не TODO-комент у коді).

### Sprint-blocking

1. **Existing users без `lastName`.** Покладаємось на `OnboardingInterceptor` — для legacy users це force-modal при наступному вході. Перевірити, що web-flow онбордингу справді переадресовує (existing test може не покривати новий required field). Якщо в проді users мало і всі без lastName — ОК; якщо багато з різними станами — продумати copy-text модалу.
2. **Юридичні тексти до ревʼю юриста.** Drафт — частина Sprint 1, фінал — у Sprint 6. Ризик: drафт live на staging/preview зі сторонніми відвідувачами (search engines). Mitigation у скоупі Sprint 1: `noindex` на обох сторінках до closing Sprint 6.

### Out-of-scope, але закладене коректно

1. **`acceptedBanks` як строковий масив без referential integrity.** Свідоме рішення MVP. Перехід на ref-collection — окремий ітем, додати в Sprint 6 backlog при появі мета-даних банків (логотипи зʼявляться у Sprint 3).
2. **Reserved-slug список в коді, не в БД.** Прийнятно: адмінської ролі поки немає (Sprint 1 закладає поле, не runtime-логіку). Питання повертається разом з admin-tooling — окрема ініціатива поза MVP.
3. **Soft-delete без cron-cleanup для Business/Invoice.** Hard-delete + cron — окремий ітем у плані Phase 1.5. Дані ростуть лінійно з кількістю користувачів — на MVP-масштабі (цільові ~100-1000 ФОП у перший квартал) не проблема.
4. **`taxationSystem` додається у Sprint 3.** Зафіксовано в плані Sprint 3 як deliverable, не у `tech-backlog.md` як TODO.

---

## Послідовність робіт (рекомендована)

1. **Tooling-передумова:** Jest у `packages/types` (config + scripts + CI smoke). Без цього `@finly/types` тести нема куди писати (~0.5 дня).
2. `packages/types` — `as const` enums, константи, IBAN/ІПН валідатори з golden-vector тестами, Zod-схеми (2 дні).
3. User schema upgrade + onboarding-interceptor — паралельно з (2) (1 день).
4. Business + Invoice schemas + unit + integration-тести з `MongoMemoryServer` (2 дні).
5. Privacy + Terms тексти + `noindex` (1 день).
6. Регресія: full test sweep + smoke в dev (0.5 дня).

**Загалом:** ~7 робочих днів для одного інженера. Якщо схеми пише одна людина, а юридичні тексти інша — 4-5 днів calendar.
