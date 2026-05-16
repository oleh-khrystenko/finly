# Sprint 1 — Архітектурний фундамент

> **Статус:** code-deliverables ✅, 2026-05-01. Не закритi: lint cleanup (86 preexisting warnings, винесено в tech-backlog); юридичне фінал-ревʼю — Sprint 6.
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

- [x] `lastName` → required у профілі
    - У `UserProfileData` (`apps/api/src/modules/users/schemas/user.schema.ts:21`) поле залишається optional у Mongoose-типі (legacy users), але `OnboardingInterceptor` починає блокувати роути з `ONBOARDING_INCOMPLETE` поки `lastName` не заповнений.
    - Zod-контракт оновлення профілю (`packages/types/src/contracts/users.ts`) вимагає `lastName` як non-empty string. Onboarding-gate і form-validation ділять одну Zod-схему — інваріант симетричний між read- і write-path.
    - Web: форма онбордингу додає поле "Прізвище" поряд з "Ім'я" (required, з asterisk).
- [x] `role` на верхньому рівні `User`
    - Значення: `'user' | 'admin'`. **"Гість" свідомо НЕ кладемо в БД** — це стан "немає JWT", entity не створюється.
    - Дефолт: `'user'`. NestJS-роути під `'admin'` у MVP **не пишуться** — лише поле. Legacy fallback на read-time у `mapUserToProfileResponse`.
    - У `packages/types/src/enums/user-role.ts` — `as const` array (див. Cross-cutting > Convention), реекспортовано як один source of truth для Zod, Mongoose і TS-type.
- [x] `worksAsBookkeeper: boolean` на верхньому рівні `User`
    - Дефолт: `false`. Toggle-логіка (вплив на форму створення Business) — Спринт 3.
- [x] Indexes — без змін на цьому етапі (`role` і `worksAsBookkeeper` не запитуємо у hot-path).
- [x] Тести: оновлено фікстури `users.controller.spec.ts`; додано `onboarding.interceptor.spec.ts`, `ProfileForm.spec.tsx`, `onboarding.spec.ts`.

**DoD:** ✅ `pnpm --filter api test` зелений (390 tests); `getMe()` повертає `role` і `worksAsBookkeeper` (3 spec кейси); онбординг блокує роути без `lastName` (6 interceptor кейсів).

---

### 1.2 Business schema (нова сутність)

Файл: `apps/api/src/modules/businesses/schemas/business.schema.ts` (новий модуль, поки **без** controller — лише `@Module` із `MongooseModule.forFeature`).

- [x] Поля верхнього рівня
    - [x] `type: BusinessType` — у MVP лише `'fop'` (`BUSINESS_TYPES = ['fop'] as const`). Структура schema/Zod готова до розширення новими значеннями, але **wire-values для ТОВ / ВАТ свідомо НЕ фіксуємо зараз** — `'vat'` як транслітерація ВАТ конфліктує з міжнародною абревіатурою VAT (Value-Added Tax) у бухгалтерському контексті, тож конкретні рядки обговорюються разом з юр. доменом у момент додавання типу (одночасно з ЄДРПОУ-валідатором і per-type правилами реквізитів).
    - [x] `ownerId: ObjectId | null` — nullable з самого початку.
    - [x] `managers: ObjectId[]` — масив user-id; non-empty якщо `ownerId === null` (інваріант на app-layer через Zod-refine у `@finly/types/entities/business`, не у Mongoose-валідаторі — Mongoose не знає про комбінаторні правила).
    - [x] `slug: string` — глобально-унікальний, lowercase, kebab-case; формат і генератор див. далі.
    - [x] `name: string` — public-name бізнесу (наприклад `"Іваненко"`); рендер на UI як `"{typeLabel} {name}"` через мапу `BUSINESS_TYPE_LABEL`.
    - [x] `requisites` (subdoc, поки лише ФОП-варіант)
        - [x] `iban: string` — повний валідатор: prefix `UA`, 27 знаків, MOD-97 checksum (стандарт ISO 13616). Реалізація — у спільному `packages/types/src/validation/iban.ts`, споживається і Zod-схемою, і Sprint 2 QR-payload-builder. **8 valid + 10 invalid golden vectors**.
        - [x] `taxId: string` — ІПН для ФОП: 10 цифр + control digit (алгоритм ДПС: `Σ(digit_i × weight_i) mod 11`). Реалізація — у `packages/types/src/validation/tax-id.ts`. **7 valid + 8 invalid golden vectors**.
        - [x] **`taxationSystem` свідомо НЕ додано у Sprint 1** — точний enum (єдиний податок 1/2/3, загальна, ПДВ-плательник) фіксується в Спринті 3 разом з UI-формою. Додавати поле зараз як `string` без enum = пропуск невалідних значень в БД.
    - [x] `paymentPurposeTemplate: string` — текстовий шаблон призначення платежу за замовчуванням; per-invoice override живе у Invoice (1.3).
    - [x] `acceptedBanks: BankCode[]` — підмножина з `MVP_BANKS` константи (див. нижче).
    - [x] `deletedAt: Date | null` — soft-delete. Hard-delete + cron — Phase 1.5+ (schema-готова, cron не пишемо).
    - [x] `createdAt`, `updatedAt` через `timestamps: true`.
- [x] Indexes
    - [x] `{ slug: 1 }` — unique.
    - [x] `{ ownerId: 1 }` — sparse (для запиту "мої бізнеси").
    - [x] `{ managers: 1 }` — для запиту "бізнеси, де я керівник".
- [x] Reserved-slug константа
    - Файл `packages/types/src/constants/reserved-slugs.ts`: `['qr', 'api', 'static', '_next', '_health']` (з `qr-decisions.md` 4.3). Slug-генератор у Спринті 3 буде з цього читати.
- [x] MVP-набір банків
    - Файл `packages/types/src/constants/banks.ts`: `MVP_BANKS = [...] as const` — 11 кодів (`privatbank`, `monobank`, `pumb`, `oschadbank`, `sense`, `ukrgazbank`, `sportbank`, `izibank`, `raiffeisen`, `abank`, `credit_dnipro`).
    - Тип `BankCode = (typeof MVP_BANKS)[number]`.
    - Display-метадані (label, logo) — НЕ тут; це задача Спринту 3 (UI-шар).

**DoD:** ✅ schema instantiation проходить (9 integration tests з MongoMemoryServer); reject-тест на дублікат slug (code 11000); reject-тест на невалідний `BankCode` у `acceptedBanks`; lowercase slug; defaults; Zod-Business з `objectIdSchema` для всіх ID-полів.

**Відкриті питання, що НЕ блокують Sprint 1:**

- Точний enum `taxationSystem` (поле додається у Sprint 3 разом з формою).
- Free-tier обмеження на `acceptedBanks` (Open Q #5 з business-flow) — застосовується на app-layer у Sprint 6.
- Per-version (002/003) обмеження довжин для `name` / `paymentPurposeTemplate` — фіксуємо в Sprint 2 поверх існуючих `min/max` Zod-обмежень.

---

### 1.3 Invoice schema (нова сутність)

Файл: `apps/api/src/modules/invoices/schemas/invoice.schema.ts` (новий модуль, без controller).

- [x] Поля верхнього рівня
    - [x] `businessId: ObjectId` — required, ref to Business.
    - [x] `slug: string` — формат `{людська-частина}-{8-char-tail}` або `{tail}` (qr-decisions §4.3.1). Унікальність — у межах бізнесу (compound index).
    - [x] `amount: number | null` — `null` означає "клієнт вводить сам" (вивіска-режим у межах інвойсу — рідкісний, але валідний). Зберігається у копійках (int).
    - [x] `amountLocked: boolean` — дефолт `false`; `true` = клієнт не може правити суму (qr-decisions §1.4). Контрадикторний стан `amount=null + amountLocked=true` блокується Zod-refine у `@finly/types/entities/invoice`.
    - [x] `paymentPurpose: string | null` — per-invoice override; `null` = використовуємо `business.paymentPurposeTemplate`.
    - [x] `validUntil: Date | null` — `null` = без терміну дії (qr-decisions §1.5).
    - [x] `slugPreset: SlugPreset | null` — який пресет згенерував slug (`'simple' | 'with-month' | 'with-year' | 'with-purpose' | null`); потрібно для аналітики/відлагодження, не для логіки.
    - [x] `deletedAt: Date | null` — soft-delete.
    - [x] `createdAt`, `updatedAt`.
- [x] **Що навмисне НЕ закладено** (Модель А, qr-decisions §1.12)
    - ❌ `paidAt`, `transactions[]`, `paymentStatus` — трекінг оплат це Phase 1.5.
    - ❌ Webhook-pointers до банків.
    - **Архітектурний guard:** структура така, що додавання `paidAt` + окремої таблиці `Transaction` пізніше **не вимагає** переписувати Invoice (тільки `$set` нового поля).
- [x] Indexes
    - [x] `{ businessId: 1, slug: 1 }` — compound unique.
    - [x] `{ businessId: 1, createdAt: -1 }` — для списку інвойсів у кабінеті.
    - [x] `{ validUntil: 1 }` — sparse, для майбутнього cron "expired invoices" (cron не пишемо у Sprint 1).
- [x] Slug-preset values у `packages/types/src/enums/slug-preset.ts`: `'simple' | 'with-month' | 'with-year' | 'with-purpose'` (qr-decisions §4.3.1.1) — `as const` array.

**DoD:** ✅ schema instantiation (13 integration tests з MongoMemoryServer); compound-unique reject-тест (code 11000); same slug під різними businesses passes; `validUntil < createdAt` як app-layer-помилка задокументовано як свідомий вибір (тест явно перевіряє, що Mongoose НЕ блокує past `validUntil`).

---

### 1.4 Валідатори реквізитів (shared, у `packages/types`)

Цей епік існує, бо інакше Business schema приймає невалідні дані до Sprint 2. Логіку пишемо один раз, переживає й Sprint 2 (QR-payload), і Sprint 3 (UI-форми).

- [x] `packages/types/src/validation/iban.ts`
    - [x] `isValidIban(value: string): boolean` — формат `UA\d{27}` + ISO 13616 MOD-97 checksum (running-mod без BigInt).
    - [x] `ibanZod` — `z.string().refine(isValidIban, { message: 'INVALID_IBAN' })` для прямого використання у `business.ts` контракті.
- [x] `packages/types/src/validation/tax-id.ts`
    - [x] `isValidIndividualTaxId(value: string): boolean` — 10 цифр + control digit за алгоритмом ДПС (ваги `-1, 5, 7, 9, 4, 6, 10, 5, 7`, контрольна = `(Σ mod 11) mod 10`).
    - [x] `individualTaxIdZod` — Zod-варіант.
    - [x] **ЄДРПОУ-валідатор НЕ зроблено** — свідомо, він знадобиться лише з ТОВ/ВАТ (Phase 1.5+).
- [x] Unit-тести: golden-vector (8 valid IBAN + 10 invalid; 7 valid IPN + 8 invalid) з різними failure-modes.

**DoD:** ✅ `pnpm --filter @finly/types test` зелений (99 tests, 5 suites); функції експортовані з `index.ts` для імпорту з api / web.

---

### 1.5 Юридичні сторінки

Файли: `apps/web/src/app/privacy/page.tsx`, `apps/web/src/app/terms/page.tsx`.

- [x] Privacy Policy (драфт)
    - Узгоджено з брендом Finly (rebrand `8b3e8de`).
    - Описано, що сервіс **генерує** платіжні посилання та QR-коди, **не зберігає** платіжні дані клієнтів і **не проводить** платежі сам.
    - "Бізнес" згадано як окрему сутність (ФОП у MVP, ТОВ/ВАТ у майбутньому).
- [x] Terms of Service (драфт)
    - Узгоджено з продуктом.
    - Окрема секція "Що Finly НЕ робить" — Модель А, явно: не платіжна установа, не зберігає картки, не відстежує статус оплат, не повідомляє про надходження.
- [x] Bump `TERMS_VERSION` — `'2026-03-14'` → `'2026-05-01'`. Існуюча інфраструктура (`AuthInitializer` + `TermsReacceptDialog`) автоматично відкриває modal для existing users.
- [x] Тексти — драфт; **юридичне фінал-вичитування свідомо відкладено до Sprint 6** (план явно дозволяє асинхронне закриття; mitigation на час драфту — `noindex` мета-тег на обох сторінках через розширений `fetchMetadata`).

**DoD:** ✅ обидві сторінки рендеряться (web build emits `/privacy` і `/terms` як static); cross-links один на одну (Privacy → /terms, Terms → /privacy + mailto); `TERMS_VERSION` bumpнутий; `AuthInitializer.spec.tsx` покриває bump → modal-open (3 нових кейси: outdated, current, null); `metadata.spec.ts` покриває `noindex` контракт (3 кейси).

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
    - [x] Додано dev-deps: `jest@30`, `ts-jest@29`, `@types/jest@30`, `ts-node@10` у `packages/types/package.json`. Синхронно з `apps/api`.
    - [x] Створено `packages/types/jest.config.ts` (preset `ts-jest`, `testEnvironment: 'node'`, `testMatch` = `<rootDir>/src/**/*.spec.ts`).
    - [x] Додано у `scripts`: `"test": "jest"`, `"test:watch": "jest --watch"`. `pnpm test` (turbo на корені) підхоплює `@finly/types` через `turbo run test` (нічого вручну wire-up не треба).
    - [x] Окремий `packages/types/tsconfig.spec.json` з `module: 'commonjs'` + `types: ['jest']`; `tsconfig.build.json` excludes `*.spec.ts` щоб `dist/` лишався чистим.
    - [x] CI (`.github/workflows/ci.yml`) виконує `pnpm test` напряму — всі workspace через turbo, без ручного `--filter` per-package.
- Unit (api): `apps/api/src/modules/businesses/schemas/business.schema.spec.ts`, `…/invoices/schemas/invoice.schema.spec.ts` — instantiation + Zod валідація + reject на невалідні підстановки.
- **Integration (api) з `MongoMemoryServer`** (вже у стеку, див. `apps/api/src/test-setup.ts`):
    - Створюються collections `businesses` і `invoices` при першому save.
    - Indexes побудовані: `db.collection('businesses').indexes()` повертає очікуваний набір (`slug` unique, `ownerId`, `managers`); `db.collection('invoices').indexes()` — `(businessId, slug)` compound unique, `(businessId, createdAt)`, `validUntil` sparse.
    - Duplicate-key reject спрацьовує (insert одного ж slug двічі → `MongoServerError` з кодом 11000).
- Unit (types): golden-vector тести для IBAN/ІПН валідаторів (1.4) + smoke-тест Zod-схем (parse валідного об'єкта + reject невалідного).
- E2E: **не додаємо** у Sprint 1 — endpoints поки не існують.

---

## Definition of Done (спринт у цілому)

- [x] `pnpm build` зелений у всіх workspace (3/3 packages).
- [x] `pnpm test` зелений: types **99 tests**, web **128 tests**, api **390 tests** = **617 total**, включно з integration-тестом collections+indexes (22 кейси з MongoMemoryServer).
- [ ] `pnpm lint` без warnings. **Не виконано буквально:** репо містить 86 preexisting warnings (form.watch React Compiler skip; mongoose-document `no-unsafe-argument` в auth.service). Sprint 1 код не додав жодного нового. Вичищення preexisting шару виходить за межі цього спринту й винесено окремим ітемом у `docs/product/tech-backlog.md`.
- [x] `getMe()` повертає `role` і `worksAsBookkeeper` — `users.controller.spec.ts` покриває presence + legacy fallback + admin + bookkeeper-true гілки.
- [x] Privacy + Terms pages рендеряться з оновленим текстом (драфт), `termsVersion` modal спрацьовує на existing user-сесії — `AuthInitializer.spec.tsx` тестує bump scenario напряму.

> **PR-опис** з посиланням на цей документ і конкретні розділи `business-flow.md` / `qr-decisions.md` — це частина процесу подачі PR (виконується автором PR при `gh pr create`), не code deliverable. Виноситься з checklist'у DoD як post-step.

---

## Ризики / TPM-зауваги

Розділені на дві групи: ризики, що блокують **закриття Sprint 1**, і відомі обмеження, що свідомо виходять за межі цього спринту (вирішуються у наступних — посилання конкретні, не TODO-комент у коді).

### Sprint-blocking — статус закриття

1. **Existing users без `lastName`.** ✅ Mitigated. `OnboardingInterceptor` блокує API через `ONBOARDING_REQUIRED_FIELDS = ['firstName', 'lastName']`; gate і form ділять одну Zod-схему (`lastNameSchema`), тож read-path не може розійтись з write-path. Покрито 6 кейсами `onboarding.interceptor.spec.ts` + 14 кейсами `onboarding.spec.ts` (включно з whitespace-only, single-char, missing fields). Copy-text модалу — preexisting `TermsReacceptDialog`-style, окремий шаблон не потрібен.
2. **Юридичні тексти до ревʼю юриста.** ✅ Mitigated. Драфт — Sprint 1, юридичний фінал — Sprint 6. Risk-mitigation `noindex` мета-тег на обох сторінках через `fetchMetadata({ noindex: true })`; покрито 3 кейсами `metadata.spec.ts`. До юр. ревʼю drафт буде live тільки на staging/preview зі `noindex` policy.

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
