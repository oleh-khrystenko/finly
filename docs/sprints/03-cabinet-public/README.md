# Sprint 3 — Кабінет бізнесу + публічна вивіска

> **Статус (оновлено 2026-05-04):** функціональний end-to-end flow реалізований (§3.0–§3.8 повністю; §3.9 host-aware routing + Server Component; §3.10 docs). 11 SVG банків у `apps/web/src/shared/icons/banks/` через `BANK_DISPLAY` map підключені у `PublicBusinessView`.
> **Pending QA:** UAT-прогон manual checks CAB-1..4 + PUB-1..5 (чек-лист додано, виконання pending — потребує реальних телефонів і 11 банк-додатків).
> **Sprint вважається закритим після:** UAT-прогон manual checks. Деталі — `docs/sprints/README.md` "Sprint 3 → Code deliverables / Pending QA".
> **Передумови:** Sprint 1 (схеми Business/Invoice + IBAN/ІПН-валідатори) і Sprint 2 (QR-ядро з payload-builder-ами 002/003 + `QrService.renderForUrl` / `renderForNbuPayload`) закриті.
> **Що розблоковує:** Sprint 4 (інвойси під бізнесом — повторне використання slug-генератора, BusinessAccessGuard, edit-карток UI), Sprint 5 (per-bank deep-links поверх 11 неактивних логотипів), Sprint 6 (Free vs Paid гейти поверх existing toggle-ів — bookkeeper, vanity slug, SEO).
> **Контекст рішень:** усі продуктові і технічні питання, з яких виросли цілі цього спринта, зафіксовані в [`planning-questions.md`](planning-questions.md). README не дублює rationale — лише імплементаційну механіку.

---

## Мета

Перетворити порожнє поле "у нас є схеми Business/Invoice і QR-ядро" на **робочий end-to-end платіжний флоу**:

1. **ФОП реєструється → проходить 4-step онбординг бізнесу → бачить кабінет з QR і налаштуваннями.**
2. **Клієнт відкриває `pay.finly.com.ua/{slug}` (через тап посилання або скан QR з кабінету) → бачить вивіску з 11 логотипами банків (неактивні в Sprint 3) + 2 активні fallback-кнопки "Інший банк" / "Інший банк (запасний варіант)" + 2 QR-картинки на ті самі адреси.**
3. **ФОП в кабінеті може inline-редагувати кожне поле, видалити бізнес із 5-секундним Undo, перемикнутись у режим бухгалтера для ведення чужих бізнесів, увімкнути SEO-індексацію публічної сторінки.**

Це **не повноцінний продукт** — інвойсів немає (Sprint 4), per-bank кнопок немає (Sprint 5), Paid-гейтів немає (Sprint 6). Але саме після Sprint 3 у нас вперше **є що показати реальним ФОП** для UX-feedback'у на робочому платіжному флоу.

---

## Скоуп

### Backend (`apps/api`)

- 🔲 `BusinessesModule` отримує controller + service + DTO + slug-генератор + `BusinessAccessGuard`. Mongoose-схема Sprint 1 розширюється двома полями (`taxationSystem`, `isVatPayer`, `slugLower`, `seoIndexEnabled`); `slug` regex розширюється до case-preserved.
- 🔲 Endpoints CRUD для **owner-кабінетної зони** (`/businesses/me`, `/businesses/me/:slug`). Slug — primary route-param (не `:id`). QR-PNG-endpoints **тільки в public-зоні** (§3.3); кабінет реюзає public URL без auth.
- 🔲 Endpoint **публічної зони** з whitelist-полями (`/businesses/public/:slug`) — без авторизації, без cookie, віддає мінімум даних.
- 🔲 Endpoint **toggle bookkeeper-режиму** в `UsersController` (PATCH `worksAsBookkeeper`). У Sprint 3 без Paid-перевірки.
- 🔲 Хвости Sprint 2 (G1–G7) — окремий блок, виконується першим.

### Frontend (`apps/web`)

- 🔲 Перейменування `/dashboard` → `/business` як кореневу сторінку кабінету (E2). Видалення `/pay` з middleware (E4).
- 🔲 Header dropdown — toggle "Режим бухгалтера" з постійним inline-описом (E5, без hover-tooltip за `responsive.md` §6).
- 🔲 Сторінка `/business` — список бізнесів + empty-state з CTA "Створити перший бізнес" (F6).
- 🔲 4-step wizard створення бізнесу зі step-навігатором (C8).
- 🔲 Кабінет бізнесу `/business/{slug}` — картки-секції з inline edit per field (E6), preview-toggle публічного вигляду (B2), кнопка "Видалити" з 5s Undo toast (C2 + F8).
- 🔲 Публічна сторінка `pay.finly.com.ua/{slug}` — Server Component з ISR під internal URL-сегментом `app/host-pay/[slug]/page.tsx`; host-aware middleware-rewrite + middleware-block (A1, описано в §3.9); 11 неактивних логотипів банків (B1) + 2 fallback-кнопки + 2 QR (E7); SEO-індексація керована toggle-ом (E3).
- 🔲 Обидві зони адаптивні mobile-first (`responsive.md`).

### Shared (`@finly/types`)

- 🔲 Розширення Zod-контрактів Business (нові поля C1, нова форма slug E1, контракти `CreateBusinessRequest`, `UpdateBusinessRequest` partial, `PublicBusinessView`).
- 🔲 Slug-генератор (free random 8-char alphanum) і reserved-list lookup (вже є константи Sprint 1+планування C3).
- 🔲 `BANK_DISPLAY` метадані (label + path до SVG) для 11 банків — UI-only константа.

---

## НЕ-скоуп

- ❌ **Інвойси.** Жодних `/invoice/...` ендпоінтів, жодних форм створення інвойсу, жодного UI-патерна "Постійний QR / Рахунки" — Sprint 4 (qr-decisions §4.6 закривається разом з реалізацією інвойсів). `/business/{slug}/invoice/{invoice-slug}` маршрут не закладаємо навіть як заглушку (B4).
- ❌ **Per-bank deep-links** — 11 логотипів **неактивні** в Sprint 3 (B1). Тап по логотипу нічого не робить; клікабельні лише дві кнопки "Інший банк". Sprint 5 закриває research, потім вмикає кнопки.
- ❌ **Paid-гейти** на toggle-ах bookkeeper / SEO / vanity slug. Sprint 3 розкриває toggle-и **усім** (E3, E5). Sprint 6 додає gating і модалку "Доступно на Paid".
- ❌ **Vanity slug на Paid.** У Sprint 3 — лише free random 8-char (B3 free-tier). Поле "Slug" у формі редагування існує як readonly. Конверсія в Paid-vanity — Sprint 6.
- ❌ **Custom-logo бізнесу в QR.** У центрі — знак гривні (C5, фікс хвоста Sprint 2 — G2). Власний лого через upload — Sprint 6 (qr-decisions §2.2).
- ❌ **Ліміт на кількість бізнесів** (1 для Free, >1 для Paid). Між Sprint 3 і Sprint 6 деплою на прод немає (C6) — legacy-юзерів не існуватиме, отже ані feature flag, ані grandfather-логіки не закладаємо. Sprint 6 додає ліміт як звичайну валідацію.
- ❌ **Soft-delete UI / restore-флоу для бізнесу.** Hard-delete одразу + 5s frontend-Undo (C2 + F8). Поле `deletedAt` у схемі Sprint 1 залишається невикористаним — коштує нуль, дає опцію передумати без міграції.
- ❌ **Запрошення керівників, передача `ownerId`, KYC, ЄДРПОУ-підтримка для ТОВ/ВАТ** — Phase 1.5+.
- ❌ **Server-side кешування PNG-байтів QR.** Sprint 3 рендерить on-demand через `QrService` + `Cache-Control: public, max-age=3600` на endpoint (immutability забезпечується тим, що при зміні бізнесу slug **не змінюється**, а зміна `acceptedBanks` PNG не впливає на payload — лише на список логотипів у HTML). R2-кеш / ETag з hash-ом — Phase 1.5+.

---

## Епіки

### 3.0 Cross-sprint cleanup — хвости Sprint 2 (БЛОКЕР №0)

Виконується **перед** будь-яким Sprint 3 кодом. G1–G7 у `planning-questions.md` зафіксовані як обов'язкові правки в уже закритих артефактах Sprint 2. Якщо їх не зробити одразу — наступні епіки впираються у застарілі константи / env / тексти.

- 🔲 **G1.** Прибрати env `NBU_PAYLOAD_LINK_HOST` (рішення A2).
    - Видалити з `apps/api/src/config/env.ts` (required-перевірка + whitelist-валідатор `isAllowedNbuPayloadLinkHost003`), з `.env.example`, з `apps/api/src/test-setup.ts` fallback-секції.
    - У `CLAUDE.md` секція "Configuration & Environment > API required" — видалити рядок.
    - **`QrService.renderForNbuPayload(input, version, options)` сигнатура змінюється однозначно:** `options.host` стає **required**-параметром (не читається з env, не має дефолту). Викликаючий controller передає `NBU_HOST_PRIMARY` або `NBU_HOST_LEGACY` залежно від `?host=primary|legacy` query-param. Один QR — один виклик; альтернатива "controller викликає сервіс двічі і об'єднує buffer-и" відкинута, бо HTTP-response з двома PNG не має формату.
    - Whitelist host-ів проти `ALLOWED_NBU_PAYLOAD_LINK_HOSTS_003` лишається в `buildNbuPayloadLink` (Sprint 2) — `QrService` пропускає `host` далі без власних додаткових перевірок.
    - Константи `qr.bank.gov.ua` і `bank.gov.ua/qr` живуть у `packages/types/src/qr/url-prefix.ts` (вже зараз є `ALLOWED_NBU_PAYLOAD_LINK_HOSTS_003`); експортуємо named-константи з зрозумілими іменами (`NBU_HOST_PRIMARY = 'qr.bank.gov.ua'`, `NBU_HOST_LEGACY = 'bank.gov.ua/qr'`) і використовуємо у controller-і.
- 🔲 **G2.** Замінити центральний QR-asset (рішення C5).
    - `apps/api/src/modules/qr/assets/finly-logo-qr.png` → `hryvnia-symbol.png` (за зразком з PDF постанови НБУ № 97, §II.11–12 ст. 5: білий круг із знаком ₴, нормативний розмір прив'язаний до версії QR).
    - `nest-cli.json` `compilerOptions.assets` — оновити шлях.
    - `QrService.logoPath` — оновити ім'я файла.
    - `QrLogoCompositor` — у комментарях підкреслити, що це **нормативний asset** (знак гривні), не довільне лого. Назву класу залишаємо (`Compositor` достатньо generic), щоб у Sprint 6 поверх сів custom-logo upload без перейменування.
- 🔲 **G3.** Переформулювати QR-4 у `docs/manual-checks/README.md`.
    - Поточно: "QR з логотипом Finly всередині все одно сканується".
    - Стає: "QR зі знаком гривні в центрі сканується банк-додатками". Решта тексту — оновити відповідно.
- 🔲 **G4.** Оновити Sprint 2 README (`docs/sprints/02-qr-core/README.md`).
    - §2.0 — рішення про host (`NBU_PAYLOAD_LINK_HOST` як required env) **знято** на користь "дві константи, дві кнопки". Додати посилання на A2 у `planning-questions.md`.
    - §2.3 — `QrLogoCompositor` працює з нормативним asset-ом (знак гривні), не з довільним лого.
    - Manual UAT — замість QR-6 ("вибір хоста") тепер post-launch перевірка "яка з двох кнопок частіше спрацьовує" (це окремий пункт у `manual-checks/README.md`).
- 🔲 **G5.** Оновити `docs/product/qr-spec/README.md`.
    - Секція "Host у нормативі" — додати пункт що Finly реалізує **обидва** допустимі hosts через дві кнопки.
    - Секція "Host вирішення (post QR-6)" — переформулювати під нову модель: QR-6 більше не gating-factor для launch, а post-launch metric для рішення "чи прибрати запасну кнопку".
    - Зняти fail-fast інваріант на env — env більше не існує.
- 🔲 **G6.** Оновити `CLAUDE.md` секція "QR generation pipeline".
    - Згадати, що використовуються **дві константи host** (`qr.bank.gov.ua` як primary, `bank.gov.ua/qr` як legacy fallback) і дві кнопки на UI публічної сторінки.
    - Прибрати згадку про `ENV.NBU_PAYLOAD_LINK_HOST`.
- 🔲 **G7.** Оновити `docs/product/business-flow.md` (рішення E5).
    - Секція §2 "Ролі користувачів і режим бухгалтера" — додати пункт: bookkeeper-режим **= Paid-only**, конверсійний тригер.
    - Секція §6 "Free vs Paid (MVP)" — переписати pricing-модель: Free = 1 свій бізнес; Paid = bookkeeper-режим + multiple businesses + інші paid-фічі.

**DoD §3.0:** `pnpm build` зелений, `pnpm test` зелений (тести `qr.service.*` адаптовані до нового asset-у — змінюється лише шлях, поведінка та), env `NBU_PAYLOAD_LINK_HOST` видалена з усіх файлів і doc-secrets, `manual-checks/README.md` QR-4 переписаний у простому стилі (правило файла — без термінів).

**Ризик:** заміна asset-а може впливати на existing integration тест `qr.service.integration.spec.ts` (round-trip через `jsqr`), якщо новий asset має інші пропорції. Mitigation: тест перевіряє факт читабельності payload, не пікселі — заміна асета не повинна ламати, але прогнати локально перед commit.

---

### 3.1 Розширення схеми Business — нові поля + Zod-контракти

Sprint 1 закрив базові поля. Sprint 3 додає те, що залежало від UI-форми (рішення C1, E1, E3) і не закладалось у фундаменті заздалегідь.

- 🔲 **`RESERVED_SLUGS` розширення на `host-pay`.** Sprint 3 §3.9 вводить internal URL-сегмент `host-pay/[slug]/page.tsx` для middleware-rewrite публічної зони. Щоб ФОП не міг взяти slug `host-pay` і створити рекурсивну rewrite-ситуацію, додаємо `'host-pay'` у TECHNICAL category `packages/types/src/constants/reserved-slugs.ts`. Тривіальна правка (один рядок), але формально contract-level — фіксуємо тут для visibility.
- 🔲 **`taxationSystem`** (рішення C1).
    - Enum `TAXATION_SYSTEMS = ['simplified-1', 'simplified-2', 'simplified-3', 'general'] as const` у `packages/types/src/enums/taxation-system.ts` за конвенцією `as const` array (CLAUDE.md > Convention).
    - Mongoose: required string з enum-обмеженням.
    - Zod: `z.enum(TAXATION_SYSTEMS)` у `BusinessSchema`.
    - UI-label мапа у `packages/types/src/enums/taxation-system.ts` (`TAXATION_SYSTEM_LABEL`): "Спрощена-1", "Спрощена-2", "Спрощена-3", "Загальна". Single source of truth для форми, кабінету і публічної сторінки (хоча на public-сторінці поле не показується — С4 whitelist).
- 🔲 **`isVatPayer`** (рішення C1).
    - Boolean, default `false` у Mongoose.
    - **Coupled-валідація**: `isVatPayer === true` дозволено лише при `taxationSystem ∈ {'simplified-3', 'general'}`. Виражається Zod-refine на entity-схемі (як `OWNERLESS_BUSINESS_REQUIRES_MANAGER` Sprint 1) з кодом `INVALID_VAT_FOR_TAXATION_SYSTEM`.
    - У публічну view-зону **не потрапляє** (C4 whitelist).
- 🔲 **`slug` + `slugLower`** (рішення E1) — case-preserved display, case-insensitive uniqueness/lookup.
    - Поточний regex `^[a-z0-9]+(?:-[a-z0-9]+)*$` змінюється на `^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$` (дозволяємо обидва регістри).
    - Mongoose: додається поле `slugLower: string` (required, lowercase, unique). Indexes: **unique на `slugLower`** (не на `slug`); поточний unique-index на `slug` **видаляється**.
    - Service-layer ремайнінг: при write — `business.slugLower = business.slug.toLowerCase()` (через Mongoose pre-save hook у схемі або у service-методі — переваги другому варіанту, бо явніше і тестується ізольовано). При public-lookup — нормалізуємо вхідний slug до lowercase і шукаємо по `slugLower`.
    - Reserved-перевірка — на lowercase-формі (`RESERVED_SLUGS` зі Sprint 1+C3 уже всі в lowercase).
    - **308 Permanent Redirect** (Next.js `permanentRedirect` → HTTP 308; зберігає метод і тіло, на відміну від історичного 301): якщо клієнт відкрив `pay.finly.com.ua/IVANENKO`, а збережено `IvanEnko` — redirect на канонічну форму. Логіка живе у Server Component-і `app/host-pay/[slug]/page.tsx` (internal route, на який middleware rewrite-ить `pay.finly.com.ua/{slug}` — див. §3.9). Page-handler порівнює `params.slug` з `business.slug` (canonical case-preserved) і викликає `permanentRedirect('/{canonicalSlug}')` — Next.js повертає 308 на user-facing URL `pay.finly.com.ua/{canonicalSlug}` (а не на internal `/host-pay/...`). QR-картинка завжди генерується з канонічним slug-ом (як ФОП його зберіг), тож скан з QR не викликає redirect-hop.
    - **Free random retry** (F5): при колізії на `slugLower` — перегенеруємо. Max 10 спроб; 11-та — `InternalServerErrorException` ("спробуйте ще раз"). Статистично нереальний кейс при 8-char alphanum.
- 🔲 **`seoIndexEnabled`** (рішення E3).
    - Boolean, default `false`. Public-view **повертає** це поле (whitelist C4 розширюється на 5-те поле — `seoIndexEnabled`; 6-те поле — `nbuLinks: { primary, legacy }` — додано рішенням A2 §3.0, див. §3.3 і §3.9), бо public Server Component читає його напряму для рендеру `<meta name="robots">`.
    - У Sprint 3 toggle доступний усім без Paid-gating; Sprint 6 додає gating.
- 🔲 **Видалене поле `deletedAt`** залишається у схемі (Sprint 1 заклав), але **не використовується** (C2 — hard-delete одразу). Документуємо в комменті у схемі: "залишене на майбутнє; зараз hard-delete".
- 🔲 **Length-обмеження `name` і `paymentPurposeTemplate`** (Sprint 2 §2.2 derived-from-spec) — без змін; entity-Zod вже використовує `effectiveLimit('receiverName')` / `effectiveLimit('purpose')`.
- 🔲 **Контракти write-side у `packages/types/src/contracts/businesses.ts`** (новий файл):
    - `CreateBusinessSchema` — full-required входи 4 кроків wizard-а (type, name, requisites.iban, requisites.taxId, taxationSystem, isVatPayer, paymentPurposeTemplate, acceptedBanks). Slug **не приймається з фронту** на створенні — генерується сервером (B3 Free random).
    - `UpdateBusinessSchema` — partial по **edit-allowed підмножині**: `name`, `requisites`, `taxationSystem`, `isVatPayer`, `paymentPurposeTemplate`, `acceptedBanks`, `seoIndexEnabled`. **`slug` / `slugLower` / `type` / `ownerId` / `managers` навмисно виключені** з write-path: slug — readonly у Sprint 3 (Paid-vanity Sprint 6, окремий method), type — immutable після створення (Sprint 4+ при появі ТОВ можуть додатись правила міграції), ownership — через окремі adminі / transfer flow (Phase 1.5+). Schema використовує `.strict()` modifier, щоб невідомі ключі payload-а були reject-ом, не silent-ignore. Coupled-група `taxationSystem + isVatPayer` валідується разом окремим refine-ом (як на full-схемі).
    - `PublicBusinessSchema` — view-схема для public endpoint: `{ type, name, slug, acceptedBanks, seoIndexEnabled, nbuLinks: { primary, legacy } }`. **6 полів:** реквізити (IBAN, ІПН) **не** повертаються JSON-ом — вони присутні лише через `nbuLinks` як Base64URL-encoded NBU payload (той самий vector, що і QR PNG endpoint). Whitelist інваріант: дані доступні **тільки** через формати, які банк читає як платіжну команду, не raw для довільного scraping-у. Single source of truth для frontend-фетчу.
- 🔲 **Тести (api):** schema instantiation для нових полів, reject-тест на `isVatPayer=true` при `taxationSystem=simplified-1`, unique-collision на `slugLower` (не на `slug`), case-preserved збереження, lowercase-lookup match.
- 🔲 **Тести (types):** golden-vector для `CreateBusinessSchema` (валідні + reject на coupled-правилі), `UpdateBusinessSchema` partial (один field, coupled-група), `PublicBusinessSchema` ігнорування зайвих полів.

**DoD:** Mongoose-схема приймає нові поля; entity-Zod і write-DTO дотримуються coupled-правил; public-DTO whitelist'ить точно 6 полів (`type, name, slug, acceptedBanks, seoIndexEnabled, nbuLinks`); existing Sprint 1 тести залишаються зеленими (нові поля required mongoose-default-ами не ламають instantiation).

**Index migration (обов'язковий deliverable Sprint 3, не optional):** перехід з unique-index `{ slug: 1 }` (Sprint 1) на unique-index `{ slugLower: 1 }` не може покладатись на Mongoose-autoIndex. Mongoose **не дропає** старі index-и при старті — стара unique на `slug` залишилась би і ламала би legitimate case-vary slug-и (`IvanEnko` блокувався б проти `ivanenko`). Потрібен явний idempotent migration script.

- 🔲 **Файл `apps/api/scripts/migrations/2026-XX-businesses-slug-lower.ts`** (точна дата при імплементації) — standalone Node-script, що виконується вручну перед deploy і ідемпотентний (повторний запуск → no-op).
    - **Крок 1:** drop existing index `{ slug: 1 }`, якщо існує (`db.businesses.dropIndex('slug_1')` обгорнутий у try/catch на `IndexNotFound`).
    - **Крок 2:** backfill `slugLower` для існуючих документів — `db.businesses.updateMany({ slugLower: { $exists: false } }, [{ $set: { slugLower: { $toLower: '$slug' } } }])`. Aggregation-pipeline-update (доступно з Mongo 4.2+; репо вже на сучасному Mongoose 8 → серверу 6+).
    - **Крок 3:** create unique index `{ slugLower: 1 }`. Якщо існують case-collision-документи (теоретично — у тестовій БД, не в prod, бо production документів ще не існує) — index build впаде з duplicate-key error, що сигналізує про необхідність manual cleanup ДО создания index. Це fail-safe.
- 🔲 **Запуск:** `pnpm --filter api migration:slug-lower` (npm-script-обгортка). Документується у `apps/api/scripts/migrations/README.md` (новий файл) — короткий journal "коли створено / навіщо / чи виконано на staging".
- 🔲 **CI/CD контракт:** deploy.yml виконує `pnpm --filter api migration:slug-lower` як окремий step **перед** старт API container-а. Failure step → блокує deploy (fail-fast).
- 🔲 **Тест:** `apps/api/scripts/migrations/2026-XX-businesses-slug-lower.spec.ts` — інтеграційний з MongoMemoryServer: засіює БД зі старим index і документами без `slugLower`, запускає migration, перевіряє (а) старий index видалений, (б) `slugLower` заповнений `toLowerCase('slug')`, (в) новий unique index створений, (г) повторний запуск не падає.

Цей migration не залежить від рішення C6 ("деплою між Sprint 3 і Sprint 6 немає"). Перший продакшн-deploy (коли б він не стався) виконує script один раз. Якщо Sprint 1-схема ніколи не була в production — script все одно безпечно прокатається (no-op на trivial paths).

**Залишковий operational ризик:** жоден. Якщо production існує і має `Business`-документи з case-vary slug-ами, що породжують duplicate `slugLower` (наприклад, `Foo` і `foo` як два різні бізнеси) — index build впаде, і це правильно: Sprint 3 вводить правило "case-insensitive uniqueness", яке такі пари перетворює на нелегальний стан. Resolution — manual rename одного з них, потім повторний run.

---

### 3.2 Backend — Business CRUD (cabinet zone)

Файли: `apps/api/src/modules/businesses/businesses.service.ts`, `businesses.controller.ts`, `slug-generator.service.ts`, DTO у `dto/`, `BusinessAccessGuard`.

**Інваріант (важливо для §3.8 і §3.9 frontend):** cabinet endpoints приймають **`:slug` як route-param**, не `:id`. Чому:

- ФОП на frontend знає бізнес по slug-у (URL кабінету = `/business/{slug}`). Окремий `GET /businesses/me/resolve?slug=...` як просто щоб дістати `:id` для усіх інших викликів — зайвий round-trip і додаткова поверхня помилок.
- `slugLower` уже має unique-index (§3.1) — lookup О(1).
- `BusinessAccessGuard` працює однаково над `:slug` і `:id` (нижче).
- При Sprint 6 vanity-edit (зміна slug, окремий endpoint поза `PATCH /businesses/me/{slug}` — див. опис `update()` нижче, де slug навмисно immutable у Sprint 3) — після виклику vanity-change endpoint frontend отримує новий slug у response і робить `router.replace('/business/{newSlug}')`. Тривіально.

- 🔲 **`SlugGeneratorService`** — utility-service з одним методом: `generateRandomSlug(): Promise<string>`.
    - Внутрішньо: цикл до 10 спроб, на кожній — генерує 8 chars з alphabet `A-Za-z0-9` (62 символи на позицію → 218 трлн комбінацій), нормалізує до lowercase для перевірки, лукапить у `RESERVED_SLUGS` (Set, O(1)) і у БД (`Business.exists({ slugLower })`). Якщо вільно — повертає **case-preserved** оригінал; якщо зайнято/зарезервовано — наступна спроба.
    - На 11-й спробі — `InternalServerErrorException({ code: 'SLUG_GENERATION_FAILED' })`. Цей шлях статистично недосяжний — алерт тільки якщо БД переповнена, що значить інші проблеми.
    - **Не викликається з Paid-vanity flow** (його немає в Sprint 3). У Sprint 6 додається другий метод `validateVanitySlug(input: string)` поверх того ж reserved-check + БД-collision-check.
- 🔲 **`BusinessesService`** — методи:
    - `create(userId: string, dto: CreateBusinessDto, isBookkeeperMode: boolean): Promise<BusinessDocument>` — згенерувати slug → застосувати правило ownership (бухгалтер-режим: `ownerId=null`, `managers=[userId]`; не-бухгалтер: `ownerId=userId`, `managers=[]`) → `model.create(...)`. Перевірка `worksAsBookkeeper` — тут, з user-документа (не з форми, щоб ФОП не міг "обманом" створити owned бізнес у режимі бухгалтера, обходячи UI).
    - `getOwnedAndManaged(userId: string, isBookkeeperMode: boolean): Promise<BusinessDocument[]>` — фільтр залежно від toggle-а (E5):
        - Bookkeeper-toggle ON → бізнеси, де `ownerId === null && userId ∈ managers`.
        - Bookkeeper-toggle OFF → бізнеси, де `ownerId === userId`.
        - Toggle-перемикання тільки **ховає**/**показує** бізнеси, не архівує (business-flow §2).
    - `getBySlug(slug: string): Promise<BusinessDocument | null>` — case-insensitive lookup по `slugLower`. Спільний primitive для cabinet-controller (через guard) і public-controller (§3.3).
    - `update(slug: string, dto: UpdateBusinessDto): Promise<BusinessDocument>` — partial update; перед save валідує coupled-правила через write-side Zod (`UpdateBusinessSchema.parse`). **`slug` як поле редагування не приймається у Sprint 3** — Paid-vanity лежить у Sprint 6 (НЕ-скоуп вище). Enforcement — **єдиний layer через Zod `.strict()`**:
        1. `UpdateBusinessSchema` навмисно **не містить** ключа `slug` (також `slugLower`, `type`, `ownerId`, `managers`) і використовує `.strict()` modifier. Глобальний `ZodValidationPipe` (NestJS, як на існуючих DTO в репо) відхилить body з невідомими ключами **до** входу в service — controller отримає 400 з `VALIDATION_ERROR` через `AllExceptionsFilter`.
        2. Service-method `update()` **не дублює** цю перевірку — `dto: UpdateBusinessDto` (тип, що derived з Zod-schema через `createZodDto`) на рівні TypeScript просто не містить `slug` як key. Ані runtime-, ані type-route для `slug` mutation не існує.
        3. **Тест (e2e):** `PATCH /businesses/me/{slug}` з body `{ slug: 'evil-vanity' }` → очікуваний 400 з error envelope `{ error: { code: 'VALIDATION_ERROR', message: ... } }` (за фактичним форматом `AllExceptionsFilter` у `apps/api/src/common/filters/all-exceptions.filter.ts` — error responses йдуть як `{ error: ... }`, не `{ data: ... }`; success-envelope `{ data: ... }` стосується лише 2xx). Тест перевіряє `expect(response.body.error.code).toBe('VALIDATION_ERROR')` і що жодне поле бізнесу не змінилось у БД (особливо `slug` / `slugLower`).
           Перерахунок `slugLower` зі сторони service у Sprint 3 ніколи не виконується — `slug` immutable. Sprint 6 при vanity-edit додасть **окремий endpoint + окремий method** `BusinessesService.changeSlug(currentSlug, newSlug, userId)` з reserved-check + collision-check + slugLower update і **окремою Paid-guard**. Розширення існуючого `update()` на slug — явно відкинутий шлях, бо змішує free-edit і Paid-gated path в одному handler-і.
    - `delete(slug: string): Promise<void>` — **hard-delete** (`model.deleteOne` за `slugLower`). Slug звільняється одразу — наступна `create` його може зайняти. Попередження "у бізнесу є активні рахунки" (C2) у Sprint 3 не реалізується технічно: інвойсів немає (Sprint 4 додасть `Invoice.exists({ businessId })` як warning у delete-confirm).
- 🔲 **`BusinessAccessGuard`** (рішення F1) — `@Injectable()` Guard для cabinet endpoint-ів.
    - Витягує `:slug` з route-params, лукапить бізнес через `BusinessesService.getBySlug` (case-insensitive), перевіряє `business.ownerId?.equals(user._id) || business.managers.some(m => m.equals(user._id))`.
    - Якщо бізнесу немає → `NotFoundException({ code: 'BUSINESS_NOT_FOUND' })`.
    - Failed-перевірка ownership → `ForbiddenException({ code: 'BUSINESS_ACCESS_DENIED' })`.
    - Resolved бізнес кладеться в `request.business` через `Reflect`-style attach, щоб controller-метод не робив повторний lookup. NestJS-ідіома (як `@CurrentUser()`).
    - На public-endpoint (`/businesses/public/:slug`) Guard **не застосовується** — публічна зона без авторизації.
- 🔲 **DTO** через `createZodDto()` зі shared Zod-схем (`CreateBusinessDto`, `UpdateBusinessDto`).
- 🔲 **Endpoints у `BusinessesController`** (cabinet, prefix `/businesses/me`). Жодних QR-PNG-endpoints у cabinet-зоні (рішення §3.3 — QR віддаються тільки через public endpoint, кабінет реюзає той самий URL):
  | Метод | Шлях | Guard | Опис |
  |---|---|---|---|
  | GET | `/businesses/me` | `JwtActiveGuard` | Список бізнесів (owned/managed залежно від toggle) |
  | POST | `/businesses/me` | `JwtActiveGuard` | Створення (4-step wizard надсилає одним POST на завершенні). Response містить canonical slug — frontend робить `router.replace('/business/{slug}')` |
  | GET | `/businesses/me/:slug` | `JwtActiveGuard` + `BusinessAccessGuard` | Повний об'єкт бізнесу для кабінету (всі поля, на відміну від public-whitelist) |
  | PATCH | `/businesses/me/:slug` | `JwtActiveGuard` + `BusinessAccessGuard` | Часткове оновлення (одне поле або coupled-група) |
  | DELETE | `/businesses/me/:slug` | `JwtActiveGuard` + `BusinessAccessGuard` | Hard-delete |

**DoD:** усі 5 endpoints віддають правильні envelope-структури (`{ data: ... }`), `BusinessAccessGuard` блокує чужий бізнес (403) і повертає 404 для неіснуючого (`NotFoundException` через сам guard, до контролера запит не доходить), slug-генератор покритий тестом на колізію (мок БД-collision-check двічі поспіль), unit-тести `BusinessesService` (create як ФОП vs як бухгалтер; update coupled-rule reject; delete is hard; getBySlug case-insensitive).

---

### 3.3 Backend — Public endpoint (zone `pay.finly.com.ua`) і shared-QR-endpoints

Окремий `PublicBusinessesController` для явного розділення зон (guards / cache headers / CORS у public відрізняються від cabinet).

**Архітектурне рішення — QR-endpoints **тільки** в public-зоні.** Кабінет відображає QR через ті самі URL (`<img src='/api/businesses/public/{slug}/qr/...'>`), без auth. Чому:

- **QR-вивіска бізнесу public-by-design.** Це платіжна сторінка, яку ФОП роздає клієнтам — будь-яка приватність всередині QR (IBAN, ім'я, ІПН) і так стає видима всім, хто QR відсканував. Cabinet-only QR endpoint не має сенсу — він віддавав би **той самий контент**, тільки за auth-у.
- **Cache-safety:** `Cache-Control: public, max-age=3600` на shared CDN — безпечно, бо ні `Authorization`, ні cookie на запит не відправляються. На authenticated route з `Cache-Control: public` shared-cache міг би видати чужому ФОП відповідь, отриману для іншого `Authorization` — недопустимо. Public-endpoint цю проблему не має взагалі.
- **Frontend-просто:** Cabinet — Client Component (in-memory access token не передається у Server Component / `<Image>`-loader через атомарний URL). Якщо QR було б під auth, кабінету потрібен blob-fetch + `URL.createObjectURL` — додатковий шар без виграшу. Public URL вантажиться `<img>`/`<Image>` напряму.

- 🔲 **GET `/businesses/public/:slug`**.
    - Без guard-ів (public).
    - `@SkipThrottle()` свідомо **не ставимо** — стандартний `ThrottlerGuard` (60 req/min на IP) — достатній (рішення F7). Реальний клієнт відкриває сторінку 1-2 рази; бот-перебір slug-ів — впирається в загальний ліміт.
    - Lookup через `BusinessesService.getBySlug(slug)` (case-insensitive). Якщо не знайдено — `NotFoundException` → 404 (на frontend перетворюється на стандартну Next.js 404 — F2).
    - Response — **тільки whitelist-поля** (рішення C4 + розширення на `seoIndexEnabled` E3 для рендеру `<meta name="robots">` + розширення на `nbuLinks` A2 §3.0 для real-app-link CTA на frontend-вивісці): `type`, `name`, `slug` (canonical case-preserved), `acceptedBanks`, `seoIndexEnabled`, `nbuLinks: { primary, legacy }` — два готових NBU-payload-link-и формату 003 на дві allowed-host адреси. Жодних `iban`, `taxId`, `taxationSystem`, `isVatPayer`, `paymentPurposeTemplate`, `ownerId`, `managers`, timestamps **у JSON-response**. Public Server Component викликає цей endpoint один раз і використовує `nbuLinks` напряму як `href` для CTA (без додаткового payload-build на frontend).
    - **Інваріант leak-сурфейсу (оновлений A2):** реквізити (IBAN, ІПН) **не** повертаються JSON-полями, але присутні у `nbuLinks` як Base64URL-encoded NBU payload (точно той самий vector, що і QR PNG endpoint `/qr/nbu.png` — payload-link і QR кодують однакові дані з однаковим `<base64-url>` у тілі). Whitelist єдність: дані доступні **тільки** через формати, що читаються банком як платіжна команда (QR-картинка + payload-link), не raw JSON для довільного scraping-у. Тобто `nbuLinks` не розширює attack-surface порівняно з QR PNG — він просто дає той самий vector у text-form для CTA-href.
- 🔲 **GET `/businesses/public/:slug/qr/business.png`** — QR на публічну URL (`https://pay.finly.com.ua/{slug}`). Знак гривні в центрі.
- 🔲 **GET `/businesses/public/:slug/qr/nbu.png?host=primary|legacy`** — QR з NBU-payload-link на одну з двох адрес. `primary` = `qr.bank.gov.ua`, `legacy` = `bank.gov.ua/qr`. Обидва — формат 003 (qr-decisions §1.9: 003 = основний, 002 = fallback per-bank через `BANK_PAYLOAD_VERSION`; на public-вивісці використовуємо 003). Знак гривні в центрі.
- 🔲 **`Cache-Control: public, max-age=3600, stale-while-revalidate=86400`** на всі три public-endpoint-и. Безпечно, бо немає `Authorization`. Узгоджується з рішенням F4 (Server Component `revalidate: 60` на frontend) — frontend-кеш агресивніший за backend-кеш у 60 раз, що ОК: backend-cache гасить QR-байти, frontend-cache гасить HTML.

**DoD:** public endpoint віддає рівно 6 полів (`type, name, slug, acceptedBanks, seoIndexEnabled, nbuLinks`) — тест на whitelist `expect(response.body.data).toHaveProperty(...)` для 6 ключів і `not.toHaveProperty(...)` на leak-кандидати (`requisites`, `paymentPurposeTemplate`, `taxationSystem`, `isVatPayer`, `ownerId`, `managers`, `createdAt`, `updatedAt`). Реквізити (IBAN, ІПН) **не** видимі JSON-ом, але присутні у `nbuLinks` як Base64URL payload — це той самий vector, що і QR PNG endpoint, не додатковий leak. 404 при невідомому slug; обидва QR-endpoint-и віддають valid PNG (jsqr round-trip декодує payload-link, або просто test-fixture buffer length > 0); `Cache-Control: public` headers присутні; немає `Authorization` requirement-у — e2e тест без bearer проходить.

**TPM-ризик:** **public-endpoint раніше або пізніше стане ціллю scraping/probing** (бот-перебір slug-ів для виявлення активних бізнесів і phishing). Sprint 3 не закладає захист, бо attack-surface обмежений — leak-fields whitelist — `type + name + slug + acceptedBanks + seoIndexEnabled`, всі вони public-by-design. Реквізити (IBAN, ІПН) недоступні через прямі JSON-поля, але **видимі через `nbuLinks` (Base64URL-encoded NBU payload) і QR-картинку** будь-якому досягнувшому slug — це той самий vector у двох формах (text-link для CTA + image для скана), а не два окремих leak-сурфейси. Це властивість продукту: щоб клієнт міг оплатити, реквізити мусять бути в команді, що читається банком. У Phase 1.5+ (коли з'являться інвойси з сумами) — додаємо per-IP slug-rate-limit (sliding window) і потенційно CAPTCHA на enumerate-патерн. Не блокер MVP.

---

### 3.4 Backend — Bookkeeper toggle endpoint

Існуючий `PATCH /users/me` (`UsersController.updateProfile`) приймає `UpdateProfileDto` з `firstName/lastName/avatar`. Розширюємо його на `worksAsBookkeeper: boolean` (один-польовий toggle).

- 🔲 У `packages/types/src/contracts/users.ts`: `UpdateProfileSchema` додає `worksAsBookkeeper: z.boolean().optional()`.
- 🔲 У `apps/api/src/modules/users/users.service.ts > updateProfile`: при отриманні `worksAsBookkeeper` — простий `$set`. Sprint 3 **не валідує** Paid-tier (рішення E5: Sprint 6 додає модалку "Доступно на Paid").
- 🔲 У `mapUserToProfileResponse` поле `worksAsBookkeeper` вже віддається (Sprint 1 додав); змін не треба.

**DoD:** `PATCH /users/me { worksAsBookkeeper: true }` мутує поле; `getMe` повертає актуальне значення; web `authStore` користувач має поле.

**Зауваження:** **toggle не має side-ефектів на даних** — лише на UI-логіку (фільтрація списку бізнесів, форма створення вибирає правило ownership). Це відповідає "перемикання режиму впливає лише на видимість і логіку створення, не на існуючі дані" (business-flow §2). Якщо ФОП ввімкнув режим бухгалтера, створив 3 ownerless-бізнеси, потім вимкнув режим — три бізнеси **просто зникають з UI** (`ownerId === null && userId ∈ managers` фільтр виключає їх з owned-списку), але живуть у БД. Повторне ввімкнення повертає їх. Тест: cy/jest-mock на список з toggle-перемиканням.

---

### 3.5 Frontend — Навігація і shell кабінету

Виконується разом з §3.6 (вимагається для роутинг-узгодженості). Серцеві рішення E2, E4, E5.

- 🔲 **Перейменування `/dashboard` → `/business`** (рішення E2).
    - Видалити теку `apps/web/src/app/(protected)/dashboard/` повністю (`page.tsx` + 4 sub-компоненти). Sprint 3 фіксує долю кожного зафіксовано — без "вирішимо при імплементації":
        - **`AiChatTeaser` — видалити.** AI chat — Phase 2 territory; teaser у dashboard був розробницькою рекламою фічі, не платіжним UX-кейсом. На `/business` (новий root cabinet) йому місця немає — це список бізнесів. На `/profile` теж немає — там user-data і security. Сторінка `/ai-chat` залишається доступною через існуючий header-dropdown (`useUserMenu` пункт `ai-chat`); хто хоче — клацне з там.
        - **`SubscriptionStatus` — перенести у `/billing`.** Компонент показує `hasActiveSubscription / currentPeriodEnd / cancelAtPeriodEnd`, що логічно належить billing-сторінці. Імпорт + render — без структурних змін.
        - **`SpendExecutionButtons` — видалити повністю.** Це demo-кнопки "вибери виконання, спали його", які працювали у dev для тестування `POST /users/me/executions/spend`. Реальні витрати executions йдуть автоматично з AI chat (`AI_CHAT` action) — ручні кнопки UX не потрібні і не повинні існувати у production-UI.
        - **`TransactionHistory` — видалити з UI повністю.** API endpoint (`GET /users/me/executions/transactions`) залишається, дані зберігаються (audit trail у `ExecutionTransaction` collection). UI-render історії транзакцій корисний 1 раз на квартал — це окрема задача analytics-панелі у Phase 1.5+, з propet pagination, фільтрами і експортом, а не teaser-список 10 останніх записів. Видалення компоненту зараз — звільнення від "напівреалізованої аналітики".

        **Net-ефект**: `apps/web/src/app/(protected)/dashboard/` повністю вилучається; `/billing/page.tsx` отримує один новий imported компонент (`SubscriptionStatus`). Жодних "перенести або видалити" умовностей не лишається.

    - Створити теку `apps/web/src/app/(protected)/business/` з `page.tsx` (список — §3.6) і `[slug]/page.tsx` (кабінет — §3.8).
    - Створення нового бізнесу — окремий route `business/new/page.tsx` (4-step wizard — §3.7).

- 🔲 **Middleware `apps/web/src/middleware.ts`** — три зміни:
    1. `PROTECTED_PATHS`: `'/dashboard'` → `'/business'`.
    2. `PROTECTED_PATHS`: видалити `'/pay'` (рішення E4 — мертвий рудимент).
    3. Auth-redirect після логіну: `'/dashboard'` → `'/business'`.
- 🔲 **Header dropdown — `useUserMenu`**:
    - Перейменувати пункт `dashboard` → `businesses` (UI-label "Бізнеси", route `/business`).
    - Додати пункт `bookkeeperToggle` — **постійний** (відображається завжди, не приховується активним маршрутом, бо це toggle, а не нав-лінк):
        - Title: "Режим бухгалтера".
        - Inline-опис muted-кольором: "вести бізнеси клієнтів, які ще не зареєстровані у Finly" (точне формулювання E5).
        - Switch (`UiSwitch` з `shared/ui/`) праворуч, value читається з `authStore.user.worksAsBookkeeper`.
        - При кліку — `PATCH /users/me { worksAsBookkeeper: !current }` через `apiClient`; success — `useAuthStore.setUser({ ...user, worksAsBookkeeper: !current })` (оптимістичний з rollback на error через існуючий toast `getApiMessage(err.code)`).
        - **Без hover-tooltip** — порушення `responsive.md` §6 (mobile-friendly inline text).
- 🔲 **Видалити `/dashboard` з мап `useUserMenu`** і перевірити `auth/signin?reason=session-expired` flow — login redirect тепер на `/business`.
- 🔲 **Тести** (`apps/web/src/widgets/header/` + `middleware.spec.ts`):
    - `useUserMenu.spec.tsx` — присутність bookkeeper-toggle, оптимістичний update + rollback.
    - `middleware.spec.ts` — `/dashboard` більше не protected (404 у тесті — або redirect на `/business` як fallback?). Рішення: middleware просто не реагує на `/dashboard` як protected; якщо файл сторінки видалено — Next.js 404. Це OK behavior.

**DoD:** Sprint 3 не залишає мертвих посилань на `/dashboard`. `pnpm --filter web test` зелений; smoke у dev — toggle перемикається, header ремайнить.

**TPM-зауваження:** **це найризикованіший епік для регресій** — `/dashboard` був "хабом" demo-компонентів. Sprint 3 завершує цей хаб (рішення вище). Якщо у майбутньому з'явиться реальна аналітика — це окрема `/analytics` сторінка з proper pagination/filters, не повернення `/dashboard`. Жодного `// TODO: restore` коментаря у diff-і не залишається.

---

### 3.6 Frontend — Список бізнесів `/business`

**Архітектурний інваріант для всіх protected pages (§3.6, §3.7, §3.8):** усі cabinet-сторінки — **Client Components** (`'use client'`), не Server Components. Чому:

- Auth у проекті — in-memory access token + Bearer header (`apps/web/src/shared/api/client.ts:6`); refresh-cookie `bid_refresh` httpOnly використовується **тільки** для `/auth/refresh` rotation, не як bearer credential.
- Server Components не мають доступу до in-memory token — будь-який server-side `apiClient.get('/businesses/me')` упреться у 401.
- Існуючий `(protected)/dashboard/page.tsx` уже Client Component (`'use client'` + `useAuthStore`) — повторюємо паттерн.
- Server Components ОК **тільки в public-зоні** (§3.9), де auth не потрібен.

Якщо колись захочемо SSR кабінетного контенту для performance — окрема ініціатива з server-side refresh-flow (Next.js Route Handler як proxy, що бере refresh cookie і додає Bearer). Не блокер MVP.

- 🔲 **Client Component `apps/web/src/app/(protected)/business/page.tsx`**.
    - Client-side fetch через `apiClient.get('/businesses/me')` у `useEffect` (або через TanStack Query — окрема дискусія, рекомендую залишити paзом з існуючими fetch-патернами проєкту: simple `useEffect` + `useState({ data, isLoading, error })` як у `dashboard/TransactionHistory.tsx`).
    - **Фільтр на стороні backend**: `getOwnedAndManaged` (§3.2) уже фільтрує за `worksAsBookkeeper`. На frontend дублювати фільтр не треба.
- 🔲 **Empty state** (рішення F6).
    - Коли `businesses.length === 0`: іконка з `lucide-react` (наприклад, `Building2` або `Briefcase` — обираємо при імплементації, обидві вже є у репо як dep), заголовок "У вас поки немає бізнесів", описовий текст ("Створіть перший бізнес, щоб згенерувати посилання на оплату"), CTA `UiButton` "Створити перший бізнес" → `/business/new`.
    - **Без placeholder-SVG-asset-ів** — це anti-pattern (тимчасовий борг у diff). `lucide-react` icon — фінальне рішення для empty-state-ів MVP; якщо в Sprint 6 продукт захоче illustration-style ассети для landing — це окрема, осмислена задача з proper art direction, не "поставимо тимчасову".
    - Окремий empty-state для **bookkeeper-режиму**: "У вас поки немає клієнтських бізнесів" + CTA "Додати бізнес клієнта". Розрізнення — щоб ФОП не плутався, чому "його" бізнес не видно.
- 🔲 **Заповнений state**: список карток. Картка показує `name`, `type` (label з `BUSINESS_TYPE_LABEL`), `slug`, позначку "клієнтський" для bookkeeper-режиму, CTA "Відкрити" → `/business/{slug}`. На cards — `UiSectionCard`. QR thumbnail у списку **не** показуємо — економимо на network (1 thumbnail × N бізнесів = N PNG-запитів на page load). QR живе на сторінці бізнесу.
- 🔲 **Header CTA** "+ Створити бізнес" (`headerNavStore.setNav` через side-effect у root-page) — щоб з основного списку був швидкий шлях. Альтернатива: floating-action-button на mobile, кнопка-картка наприкінці списку — простіше для MVP.
- 🔲 **Адаптивність** (`responsive.md`):
    - Mobile: одна колонка карток, повна ширина.
    - Tablet: 2 колонки grid.
    - Desktop: 2-3 колонки залежно від ширини.

**DoD:** `/business` рендериться для empty-state і filled-state; UAT на 320px / 768px / 1440px (responsive.md §7); CTA-кнопка веде у `/business/new`; loading state під час client-side fetch (через `UiSpinner` або `UiFullPageLoader`).

---

### 3.7 Frontend — 4-step wizard створення бізнесу `/business/new`

Серцеве рішення C8: 4 кроки + step-навігатор зверху + валідація на кожному кроці. Окремий routes `apps/web/src/app/(protected)/business/new/page.tsx`.

- 🔲 **Step-навігатор (горизонтальний прогрес-бар з 4 кружечками)**.
    - Кружечок поточного кроку — заповнений primary color; пройдених — заповнений success-color; майбутніх — outline.
    - Підпис під кружечком: "Тип і назва" / "Реквізити" / "Оподаткування" / "Призначення і банки".
    - Клік по пройденому кружечку → повернутись редагувати (state не втрачається, бо живе в `useForm` з `mode: 'onChange'` + локальним Zustand `useBusinessWizardStore` для перемикання кроків).
    - Майбутні кружечки **не клікабельні** (валідація поточного має пройти).
    - **Mobile**: vertical stepper (кружечки в колонку) або компактна шкала "Крок 2 з 4" + назва. Пріоритет — mobile-first (responsive.md §6).
- 🔲 **Крок 1 — Тип + Назва.**
    - Поле "Тип бізнесу": readonly-display "ФОП" + помітка "(поки що підтримуємо лише цей тип; ТОВ і ВАТ — у розробці)". У формі ховаємо як hidden input з `type='fop'`, не select-з-одним-пунктом (UX анти-патерн).
    - Поле "Назва" (`UiInput`, label "Назва бізнесу", placeholder "Іваненко"). Zod-валідація через `businessNameSchema` (з MIN-derived limits Sprint 2).
    - Кнопка "Далі" disabled поки `name` invalid.
- 🔲 **Крок 2 — Реквізити (IBAN + ІПН).**
    - "IBAN" (`UiInput`, label "IBAN", `inputMode="text"`, placeholder "UA21 3223 1300 0000 0260 0335 6300 1"). Live-validation через `ibanZod` (Sprint 1 — повна MOD-97).
    - "Індивідуальний податковий номер" (`UiInput`, `inputMode="numeric"`, 10 цифр). Live-validation через `individualTaxIdZod` (control-digit алгоритм ДПС — Sprint 1).
    - Кнопка "Далі" disabled поки обидва invalid.
- 🔲 **Крок 3 — Оподаткування.**
    - "Тип оподаткування" — `UiSelect` з 4 значеннями (`TAXATION_SYSTEM_LABEL` мапа).
    - "Платник ПДВ" — `UiSwitch`. **Coupled-логіка (C1)**: switch disabled, якщо `taxationSystem ∈ {'simplified-1', 'simplified-2'}` (з підказкою "ПДВ доступний для спрощеної-3 і загальної системи"). При зміні `taxationSystem` з-3 → -1: `isVatPayer` автоматично `false`.
    - Кнопка "Далі" disabled поки `taxationSystem` undefined.
- 🔲 **Крок 4 — Призначення і банки.**
    - "Призначення платежу за замовчуванням" (`UiTextarea`, label, max-довжина derived з `effectiveLimit('purpose').chars`). Лічильник символів під полем (не байтів — UX-friendly, error-message при overflow вже вказує на bytes для cyrillic).
    - "Банки, з яких приймати оплати" — список 11 чекбоксів (`UiCheckbox`) з логотипами банків і назвами. **Дефолт — усі 11 увімкнені** (рішення B6). **Мінімум 1** — disabled "Далі"-кнопка, поки `acceptedBanks.length === 0`.
    - Кнопка "Створити".
- 🔲 **Submit-флоу.**
    - На "Створити" — POST `/businesses/me` з повним payload-ом. На success — redirect на `/business/{slug}`.
    - На validation-error від backend (наприклад, race-condition на slug-collision що generator не зловив) — показ toast з `getApiMessage` і повернення на крок 1.
- 🔲 **Wizard state у Zustand store `apps/web/src/features/business-wizard/businessWizardStore.ts`** (in-slice ownership за `overlays.md` §2 / `modular-boundaries.md`). Поля: `currentStep: 1|2|3|4`, `formData: Partial<CreateBusinessRequest>`, `goToStep(n)`, `setStepData(n, data)`. Persist у `sessionStorage` для відновлення при випадковому reload.
- 🔲 **Тести:** smoke `BusinessWizardForm.spec.tsx` — крок-перехід при валідному стані, блокування "Далі" при невалідному, coupled-rule ПДВ × оподаткування, submit з правильним payload-ом (мокнутий fetch).

**DoD:** wizard працює на 320px / 768px / 1440px без horizontal-scroll; `pnpm --filter web test` зелений (новий spec); ESLint clean.

**TPM-фідбек:** **wizard замість одної довгої форми — стандарт для 8-польових onboarding-флоу**, не overengineering. Альтернатива (одна довга форма зі скролом) для MVP виглядала б "грубо" і відштовхнула б нетехнічного ФОП — це валідний product call, не tech-decoration. Sprint 4 при роботі над інвойсом може повторно використати step-pattern (інвойс-форма теж має 3-4 поля з умовною валідацією) — закладаємо `BusinessWizardSteps`-style компоненти узагальнено, щоб Sprint 4 не переписував.

---

### 3.8 Frontend — Кабінет бізнесу `/business/{slug}`

Серцеве рішення E6: **inline edit per field** (Stripe / Linear / Notion-style). + B2 preview-toggle. + C2 видалення з 5s undo (F8).

- 🔲 **Client Component `apps/web/src/app/(protected)/business/[slug]/page.tsx`** (`'use client'` — див. §3.6 інваріант). Client-side fetch `GET /businesses/me/{slug}` через `apiClient` (slug читається з `useParams()`). Backend сам резолвить case-insensitive через `slugLower` (§3.2). При 404 / 403 — окрема UI-сторінка "Доступ заборонено / Бізнес не знайдено" з кнопкою "Повернутись до списку" (рішення F2). При loading — `UiFullPageLoader`.
- 🔲 **Layout сторінки**:
    - Top toolbar: назва бізнесу як заголовок ("ФОП Іваненко"), праворуч — toggle "Перегляд як клієнт" (B2) + кнопка "Відкрити в новій вкладці" (B2 + рішення про `pay.finly.com.ua`).
    - **Картки-секції** (рішення E6):
        1. **"Основне"**: тип (readonly), назва (editable).
        2. **"Реквізити"**: IBAN (editable), ІПН (editable).
        3. **"Оподаткування"**: тип оподаткування + ПДВ (coupled — редагуються однією карткою з тими самими валідаційними правилами C1).
        4. **"Призначення і банки"**: paymentPurposeTemplate (editable), acceptedBanks (список чекбоксів, мінімум 1 — B6).
        5. **"Публічна сторінка"**: slug (readonly Free, vanity у Sprint 6), посилання на `pay.finly.com.ua/{slug}` (copy-button), toggle "Показувати в Google" (E3 — `seoIndexEnabled`).
        6. **"QR-картинка"**: рендер public-endpoint-у `/api/businesses/public/{slug}/qr/business.png` як `<img>` (НЕ `next/image` через `remotePatterns`-обмеження — це власний backend під `/api`, не зовнішній CDN; `<img>` тут OK). Кнопка "Завантажити" — `fetch(url).then(r => r.blob()).then(...)` для збереження файла. Public URL → працює без bearer token (§3.3).
    - **Danger zone** внизу: кнопка "Видалити бізнес" (червона, з confirm-dialog).
- 🔲 **Inline edit per field (E6)**.
    - Кожне поле — readonly з іконкою "олівець" поряд (`UiButton variant="icon-compact"` для desktop / `variant="icon"` для mobile).
    - Click "олівець" → поле стає `UiInput` / `UiSelect` / `UiTextarea` + два mini-кнопки: ✓ "Зберегти" (`UiButton variant="filled"`) і ✗ "Скасувати" (`UiButton variant="text"`). **Variant-найменування узгоджені з існуючим `UiButtonVariant` enum у `apps/web/src/shared/ui/UiButton/types.ts`** — `'filled' | 'outline' | 'soft' | 'destructive-outline' | 'text' | 'destructive-text' | 'icon' | 'icon-compact'`. Жодного нового варіанту в межах Sprint 3 не додаємо; будь-яка потреба у новому variant — це окрема ініціатива з рев'ю design-tokens (`design-tokens.md`) і UI-spec.
    - Save → `PATCH /businesses/me/{slug} { fieldName: newValue }` → optimistic update локального state (useState/useReducer на сторінці) або повторний `apiClient.get('/businesses/me/{slug}')` для re-sync. Toast "Зміни збережено".
    - Cancel → revert до readonly без запиту.
    - Coupled-група `taxationSystem + isVatPayer` редагується **разом** як одна картка (один "олівець" на всю карточку, два контроли всередині, один Save).
    - **Validation на client-side** через ту ж Zod-schema (`UpdateBusinessSchema.partial()`); Save disabled поки невалідно.
- 🔲 **Preview-toggle (B2)**.
    - Перемикач у top toolbar: "Кабінет" / "Перегляд як клієнт".
    - Click "Перегляд як клієнт" → та сама сторінка перерендериться у режимі публічної вивіски: ховаються картки-секції редагування, замість них показується **точна копія** компоненту з §3.9 (11 неактивних логотипів + 2 кнопки + 2 QR). Шапка кабінету залишається (з toggle назад на "Кабінет").
    - Кнопка "Відкрити в новій вкладці" поруч — лінк на `https://pay.finly.com.ua/{slug}` для перевірки "як справді".
    - **Iframe не використовуємо** (B2: явно відкинутий варіант — зайва складність + cross-domain headache).
- 🔲 **Видалення (C2 + F8) — frontend-only Undo**.
    - Click "Видалити бізнес" → `UiConfirmDialog` (через `useDeleteBusinessConfirmStore`): "Ви впевнені, що хочете видалити «{name}»? Після видалення клієнти, які мають збережене посилання, не зможуть оплатити".
        - **Sprint 4** додасть до dialog warning "У бізнесу є 3 активні рахунки" (через `Invoice.exists({ businessId })`); у Sprint 3 — без цього блоку, бо інвойсів немає.
    - Confirm → закрити dialog → optimistically прибрати картку з UI → показати toast з 5s-таймером "«{name}» буде видалено... [Скасувати]" (`sonner` toast з кнопкою).
        - **Жодного запиту на backend поки 5s не минули** (F8 принцип).
        - Click "Скасувати" → відмінити таймер, повернути картку у UI, toast "Видалення скасовано".
        - Минуло 5s без скасування → `DELETE /businesses/me/{slug}` → success → router.replace('/business') (бізнес уже з UI зник, користувач уже на списку).
        - **Browser unload / nav-away протягом 5s = implicit cancel** (F8): запит не йде, при наступному login бізнес знову у списку, ФОП клацає "Видалити" знову.
- 🔲 **Картки-секції — окремі компоненти у `apps/web/src/features/business-edit/`** (новий feature-slice): `BasicSection.tsx`, `RequisitesSection.tsx`, `TaxationSection.tsx`, `BanksSection.tsx`, `PublicSection.tsx`, `QrSection.tsx`. Загальний `EditableField.tsx` примітив для inline-edit-обгортки (повторно використовується у Sprint 4 для інвойсів).
- 🔲 **Тести:**
    - `EditableField.spec.tsx` — readonly → editing → save → readonly; cancel revert.
    - `TaxationSection.spec.tsx` — coupled-rule (зміна `simplified-3 → simplified-1` миттєво ставить `isVatPayer=false`).
    - `business-edit/__tests__/delete-flow.spec.tsx` — 5s undo (jest fake timers): hide → cancel → restored, або hide → 5s pass → DELETE called.

**DoD:** усі 6 карток рендеряться, inline-edit працює per field, preview-toggle перемикається без route-change, undo 5s протестований fake-timers, mobile UAT 320×667 — інтерактивні елементи ≥ 44×44 px.

**TPM-фідбек:** **inline-edit складніший у реалізації, ніж classic full-form з global Save**, але це повна перевага для частих дрібних правок ("підправити IBAN, додати ще один банк"). Альтернатива (full-form) — стандарт для рідкої правки (зміна паролю), а не для "налаштування бізнесу, де щось час від часу міняється". Stripe / Linear / Notion обрали inline саме для такого UX-патерну. Реалізаційний overhead — `EditableField`-обгортка (~150 LOC), що повторно використається у Sprint 4 для інвойсів. Не overengineering.

---

### 3.9 Frontend — Публічна сторінка `pay.finly.com.ua/{slug}`

Це **головний deliverable Sprint 3 для клієнта** (не для ФОП). Виконується за рішеннями A1, A3, B1, B5, B6, C5, E1, E3, E7.

- 🔲 **Host-aware маршрутизація (рішення A1) — explicit internal URL-сегмент + middleware-rewrite + middleware-block.**

    Один Next.js project (`apps/web`), два host-и:
    - `finly.com.ua` (cabinet, protected pages) — все вже є.
    - `pay.finly.com.ua` — public route без auth.

    **Чому не route group `(public)/[slug]/page.tsx`** (відкинутий варіант). Route group `(public)` у App Router — суто file-system конструкт, **не URL-сегмент**: route `app/(public)/[slug]/page.tsx` матчиться як `/{slug}` для **обох** host-ів, включно з `finly.com.ua/{slug}`. Простий middleware "якщо host=pay → rewrite" не закриває cabinet host-а — без явного блока той самий route відкривався б за `finly.com.ua/{slug}`. Це порушує A1 (cookie / auth ізоляція host-ів) і створює leak публічної сторінки на cabinet domain.

    **Чому не page-level `headers().get('host')` check на root catch-all `app/[slug]/page.tsx`** (теж відкинутий). Catch-all на root конфліктує з усіма cabinet route-ами (`/auth/...`, `/business/...`, `/profile`, `/billing`) — Next.js зматчить `[slug]` для всього, що не покрите специфічнішим route. Можна обійти exclude-list-ом на page-handler, але це крихкий contract — додавання нового cabinet route в майбутньому ламає public з силу-shadowing.

    **Прийнятий варіант — internal URL-сегмент `host-pay/` (звичайна літера на старті, без underscore-префікса).**

    Чому `host-pay`, не `__pay` чи `_pay`:
    - У Next.js App Router **будь-яка** тека з префіксом `_` (одинарним) є private folder і opt-out з routing — `app/_pay/page.tsx` route не створює. Цей же префікс-патерн застосовується незалежно від кількості underscore-ів на старті: `__pay` теж починається з `_`, тож теж private folder. URL-сегмент, що **повинен** починатись з literal `_`, потребує encoded `%5F...` форми — workable, але крихкий і нечитабельний у diff/PR.
    - `host-pay` — звичайна тека з нормальною першою літерою; route створюється стандартно. Назва описова: явно вказує "цей route існує тільки на pay-host через middleware-rewrite".
    - **`host-pay` додається у `RESERVED_SLUGS` категорію TECHNICAL** (поряд з `qr`, `api`, `static`, `_next`, …) у `packages/types/src/constants/reserved-slugs.ts`. Це блокує ФОП взяти slug `host-pay` і випадково зіткнутися з internal-route-ом.

    - 🔲 **Файл `apps/web/src/app/host-pay/[slug]/page.tsx`** — публічна сторінка-вивіска. Server Component з `revalidate: 60` (F4). Перший рядок page-handler-а — `headers().get('host')`-check: дозволяє тільки `pay.finly.com.ua` (prod) або `pay.finly.local:3000` (dev). Інакше — `notFound()` з `next/navigation` (тут це валідно — Server Components підтримують `notFound()`, на відміну від middleware). **Defense-in-depth:** навіть якщо middleware-config зломається, page-handler відмовиться рендерити на cabinet host.
    - 🔲 **Middleware (`apps/web/src/middleware.ts`) — три нових branch-и поверх існуючої auth-логіки.** Middleware API дає тільки `NextResponse.next()`, `NextResponse.rewrite(url)`, `NextResponse.redirect(url)` і `new NextResponse(body, init)`. **`notFound()` з `next/navigation` у middleware НЕ доступний** — для 404 використовуємо `new NextResponse(null, { status: 404 })`. Це повертає 404 status без body; для security-критичних branch-ів (B, C) це достатньо — вони ловлять direct-URL-атаки і не потребують рендеру UI.
        - **Branch A — host ∈ `PUBLIC_HOSTS`, path = `/{slug}` (root-рівня), slug ≠ reserved:** `NextResponse.rewrite(new URL('/host-pay/{slug}', req.url))`. Користувач бачить URL `pay.finly.com.ua/IvanEnko`; внутрішньо Next.js рендерить `app/host-pay/[slug]/page.tsx`.
        - **Branch B — host ∈ `PUBLIC_HOSTS`, path ≠ root:** `pay.finly.com.ua/business/...`, `pay.finly.com.ua/auth/...` тощо → `new NextResponse(null, { status: 404 })`. Виняток: path починається з `/api/` (same-origin proxy через `next.config.ts` rewrites — пропускається до backend без middleware-втручання, як зараз).
        - **Branch C — host ∉ `PUBLIC_HOSTS`, path починається з `/host-pay/`:** `new NextResponse(null, { status: 404 })`. Захист від прямого URL-input-у в адресний рядок (`finly.com.ua/host-pay/test`). Робить `host-pay/...` non-addressable з cabinet domain.
    - 🔲 **Друга оборонна лінія для UX (для майбутнього, не Sprint 3):** якщо колись захочемо красивого 404 UI замість blank-body 404 у middleware — pattern Next.js: створити helper-route з нормальною (НЕ underscore-prefixed) назвою, наприклад `app/error-404/page.tsx`, що першим викликом робить `notFound()` з `next/navigation`; middleware rewrite-ить туди з `NextResponse.rewrite(new URL('/error-404', req.url), { status: 404 })`. **Папки з префіксом `_` use-case-ом не підходять** — App Router робить їх private і route не створюється (та сама причина, чому Sprint 3 обрав `host-pay`, не `_pay`). Якщо `error-404` колись додаватимемо — теж кладемо в `RESERVED_SLUGS` категорію TECHNICAL, як зараз `host-pay`. Sprint 3 цього **не** робить — blank 404 у security-branch-ах прийнятний; branded UI тільки на Server-Component-handler-і `host-pay/[slug]/page.tsx` через стандартний Next.js `not-found.tsx` flow.
    - 🔲 **Reserved-slug check у Branch A:** перед rewrite-ом middleware перевіряє `slug.toLowerCase() ∈ RESERVED_SLUGS`. Імпорт через **root export** `import { RESERVED_SLUGS } from '@finly/types'` — це єдиний валідний path у поточному репо: `packages/types/package.json` `exports` зафіксований тільки на `"."`, і `apps/web/tsconfig.json` `paths` має alias тільки `@finly/types` (без `@finly/types/*`). Subpath-style імпорти (`@finly/types/constants/...`) у Sprint 3 **не вводимо** — це окрема ініціатива з повним contract-update (package `exports` map для `./constants`, `./qr`, `./entities` + `tsconfig` alias `@finly/types/*`), що зараз не закриває жодного product-кейсу і коштує build-pipeline-ризик. `RESERVED_SLUGS` уже re-exported з `packages/types/src/index.ts > constants` — root-import дає той самий identifier. Якщо reserved — middleware не rewrite-ить, повертає `new NextResponse(null, { status: 404 })`. Без цієї перевірки `pay.finly.com.ua/host-pay` робив би рекурсивний rewrite на `/host-pay/host-pay` і дав би заплутаний 404 пізніше. Reserved-list розширюється на `host-pay` як описано вище (§3.1).
    - 🔲 **Cookie-ізоляція (A1)**: `bid_refresh` cookie ставиться на `finly.com.ua` (без leading dot, без `Domain=` атрибуту) — **не** видна на `pay.finly.com.ua`. Це вже працює; інваріант фіксується у тесті middleware (`expect(payHostRequest.cookies.has('bid_refresh')).toBe(false)`).
    - 🔲 **Google OAuth** — продовжує бути на `finly.com.ua/auth/google/callback`. Branch B блокує `/auth/...` на public host.
    - 🔲 **Local dev**: додаємо запис `127.0.0.1 pay.finly.local` до `/etc/hosts` користувача (інструкція в `README.md` корня репо). Middleware whitelist host-ів — `['pay.finly.com.ua', 'pay.finly.local:3000']` як константа `PUBLIC_HOSTS`.
    - 🔲 **Тести (`middleware.spec.ts`):** обов'язкові кейси, що матимуть повну coverage host-routing-у:
        1. `host=pay.finly.com.ua` + `path=/IvanEnko` → rewrite на `/host-pay/IvanEnko`.
        2. **`host=finly.com.ua` + `path=/IvanEnko` → 404** (НЕ рендерить public). Це core-test — без нього регрес слайся непомітно.
        3. **`host=finly.com.ua` + `path=/host-pay/test` → 404** (Branch C — direct-URL-attack захист).
        4. `host=pay.finly.com.ua` + `path=/business/foo` → 404 (Branch B).
        5. `host=pay.finly.com.ua` + `path=/api/businesses/public/foo` → pass-through (api proxy не блокується).
        6. `host=pay.finly.com.ua` + cookie `bid_refresh` _не_ видна (cookie-isolation).

- 🔲 **Server-side fetch + 404 + canonical redirect.**
    - `getBySlug(slug)` — case-insensitive lookup (E1). Якщо нема — стандартний Next.js `notFound()` (рішення F2).
    - Якщо знайдено, але URL case ≠ canonical → `permanentRedirect('/{canonicalSlug}')` (E1: 308 Permanent Redirect на канонічну форму).
    - Дані для рендеру — `PublicBusinessSchema` (6 полів: type, name, slug, acceptedBanks, seoIndexEnabled, `nbuLinks: { primary, legacy }`). 6-те поле `nbuLinks` додано рішенням A2 §3.0 — два готових NBU payload-link-и для real app-link CTA "Інший банк / Запасний QR" замість лінків на PNG endpoint.
- 🔲 **SEO / `<meta>`**:
    - `<title>`: "Оплата на {Тип} {Назва} — Finly" (наприклад, "Оплата на ФОП Іваненко — Finly").
    - `<meta name="description">`: "Сторінка для оплати на {Тип} {Назва}. Оберіть банк і завершіть платіж у мобільному додатку".
    - `<meta name="robots" content="index">` якщо `seoIndexEnabled === true`, інакше `noindex` (E3 default = false).
- 🔲 **Layout сторінки (E7 повна структура)**:
    1. **Заголовок**: "Оплата на {Тип} {Назва}" (h1, великим шрифтом).
    2. **Сітка з 11 неактивних логотипів банків (B1)**:
        - Тільки ті, що у `acceptedBanks` (рішення B6: дефолт 11, мінімум 1).
        - Кожен логотип — сірий (filter `grayscale + opacity-60`), `cursor-not-allowed`, з підписом "Незабаром" (рішення B1).
        - Click — нічого не робить (Sprint 5 розблокує).
        - Логотипи реальні (B5), у `apps/web/src/shared/icons/banks/` як `<bankCode>.svg` 11 файлів.
        - Mobile: 3 колонки grid; tablet: 4; desktop: 5-6.
        - **Touch targets ≥ 44×44 px** (responsive.md §2) хоч кнопки і неактивні — анімовано feedback при тапі (focus-ring, без на навігації).
    3. **Дві активні кнопки (E7)**:
        - "**Інший банк**" (primary CTA) — link на NBU-payload-link з `host=qr.bank.gov.ua` (URL_PREFIX_003 на primary host). На тапі ОС ловить через app-link і відкриває банк-додаток.
        - "**Інший банк (запасний варіант)**" (secondary CTA, муted) — link на NBU-payload-link з `host=bank.gov.ua/qr` (legacy host).
        - Підпис під кнопками: "Якщо ваш банк не відкрився — спробуйте запасний варіант". Текст без зайвого поляризації; одна фраза вирішує всі edge-cases B1.
        - **Кнопки на мобільному ≥ 44×44**, на desktop — стандартний button.
    4. **Дві пари QR-картинок (E7)**:
        - QR №1 з payload на primary host (`qr.bank.gov.ua`) + підпис "Або відскануйте з вашого банк-додатка".
        - QR №2 з payload на legacy host (`bank.gov.ua/qr`) + підпис "Запасний варіант — якщо перший QR не відкрився".
        - QR через `<img src='/api/businesses/public/{slug}/qr/nbu.png?host=primary' />` і `?host=legacy` (звичайний `<img>`, не `next/image` — endpoint живе під same-origin `/api/...`, не CDN; `next/image` `remotePatterns` тут не потрібен).
        - Mobile-розмір ≥ 200×200 px (E7).
    5. **Footer**: лого Finly (як SVG, не у центрі QR) + посилання на /privacy і /terms. Згідно рішення C5 — Finly-брендинг живе **у верстці**, не в QR.
- 🔲 **Адаптивність (`responsive.md`)**:
    - Mobile-first; вертикальне укладання усіх блоків.
    - Tablet: можна 2 колонки (банки ліворуч, кнопки + QR праворуч).
    - Desktop: те саме, max-width контейнер ~640px (вузька сторінка для платіжного UX — не landing).
- 🔲 **Тести**:
    - `host-pay/[slug]/page.spec.tsx` — render для `seoIndexEnabled=true|false`, redirect на canonical case, 11 банків як неактивні, 2 кнопки активні з правильними URL-ами; host-check у page-handler-і повертає `notFound()` (з `next/navigation`, валідно у Server Component) при `host=finly.com.ua`.
    - `middleware.spec.ts` — повне покриття 6 кейсів host-routing-у з §3.9 (Branch A/B/C × cookie-isolation).

**DoD:** публічна сторінка повністю рендериться на 320 / 768 / 1440 px, обидві кнопки відкривають корректні URL у DevTools-аудиті, `noindex` дефолт у source HTML, `pnpm --filter web test` зелений.

**TPM-ризик:** **host-aware маршрутизація на одному Next.js project** робиться через явний URL-сегмент + middleware (§3.9). Залишковий ризик — leak публічної сторінки на cabinet host через рідкісну race condition (наприклад, hot-reload у dev переписав middleware а page-handler ще не перерендерився). **Mitigation:** defense-in-depth — `headers().get('host')`-check у самому page-handler-і; обов'язковий middleware-spec кейс №2 (host=finly.com.ua + slug → 404). Без цього кейсу регресія слайся непомітно.

E2E прогон публічної сторінки на CI — Sprint 4 / Sprint 5 (дорожчий setup, потребує DNS-/host-fixture у GH Actions; для MVP unit-spec через mock-host достатньо).

---

### 3.10 Cross-cutting

#### Інтеграція з QR-модулем

`QrService.renderForUrl` і `renderForNbuPayload` — вже готові (Sprint 2). Sprint 3 лише **інжектить** `QrService` у `BusinessesController` і `PublicBusinessesController` через `imports: [QrModule]` у `BusinessesModule`. Жодних змін у Sprint 2 коді (крім G1–G2 cleanup §3.0).

При виклику `renderForNbuPayload`:

- Маппінг `Business.requisites + name + paymentPurposeTemplate` → `PayloadInput`. Helper `buildPayloadInputFromBusiness(business, override?)` у `apps/api/src/modules/businesses/payload-mapper.ts` — приватний для модуля, тестується ізольовано.
- Версія = `'003'` (за замовчуванням; per-bank override через `BANK_PAYLOAD_VERSION` map не використовується на public-сторінці бізнесу — лише per-bank кнопки Sprint 5 використовуватимуть).
- Host — два варіанти (primary / legacy) залежно від `?host` query.

#### Convention compliance

- **`as const` enums** (CLAUDE.md > Convention) — нові константи `TAXATION_SYSTEMS` у `packages/types/src/enums/taxation-system.ts`.
- **Нові entries у `RESPONSE_CODE`** (`packages/types/src/enums/response-code.ts`) — три коди: `BUSINESS_ACCESS_DENIED` (Guard 403), `BUSINESS_NOT_FOUND` (Guard 404), `SLUG_GENERATION_FAILED` (service 500). Кожен додається у `RESPONSE_CODE` об'єкт + `RESPONSE_CODE_TYPE` мап (всі три — `RESPONSE_TYPE.ERROR`) + у `mapApiCode.ts` notification-словник з UA-message-ами (наприклад, `errors.businesses.business_access_denied: 'У вас немає доступу до цього бізнесу'`).
- **Zod refine `message`-strings** (НЕ `RESPONSE_CODE`, повторюємо patern Sprint 1 `OWNERLESS_BUSINESS_REQUIRES_MANAGER`) — `INVALID_VAT_FOR_TAXATION_SYSTEM` для coupled-валідації §3.1 (`isVatPayer === true` поза `simplified-3 / general`). **Цей string бачить лише frontend** — пробивається через RHF-resolver від тієї ж shared Zod-схеми (`UpdateBusinessSchema`), коли користувач натискає "Зберегти" з невалідною комбінацією. Помилка з'являється інлайн під полем "Платник ПДВ" локально, без HTTP-round-trip-у — це default RHF-flow, без додаткового mapping.
    - **Чому НЕ розраховуємо на цей string у API response.** Поточний `AllExceptionsFilter` (`apps/api/src/common/filters/all-exceptions.filter.ts`) при `BadRequestException` від `ZodValidationPipe` повертає лише `{ error: { code, message } }` — Zod `issues[]` (з полем-рівневими refine messages) **не** прокидаються у JSON-відповідь. Тобто навіть якщо queries обходять frontend Zod-resolver і б'ють API напряму, response буде `{ error: { code: 'VALIDATION_ERROR', message: 'Bad Request' } }` без імені конкретного refine. Це навмисна форма: filter — opaque, не leak-ить структуру входу.
    - **API-side роль coupled-rule:** safety-net на випадок drift-у frontend-схеми або direct-API-curl. Невалідна пара `(simplified-1, isVatPayer=true)` reject-ається `ZodValidationPipe` → 400 `VALIDATION_ERROR`. Frontend бачить generic toast "Перевірте введені дані" (`mapApiCode` для `validation_error`); user-friendly inline error під конкретним полем — тільки при normal-flow через RHF.
    - **Якщо колись треба буде показати field-level помилки з API** (наприклад, для server-only валідацій типу IBAN-checksum через 3rd-party): окрема ініціатива поза Sprint 3 — розширити `AllExceptionsFilter` на читання Zod `issues[]` з `exceptionResponse.details` і прокидання у response body (`{ error: { code, message, fields: { fieldName: [...] } } }`), плюс RHF-helper для імпорту server-errors у `formState.errors`. Не блокер MVP, бо існуючих server-only валідацій під час Sprint 3 немає (IBAN/ІПН валідуються Zod-ом локально через Sprint 1 валідатори).
- **FSD layering** (`modular-boundaries.md`) — `business-edit`, `business-wizard`, `bookkeeper-toggle` як features-slices; `app/host-pay/[slug]/page.tsx` тримає публічну сторінку як app-layer-route, переиспользує shared/ui примітиви + features (наприклад, `business-public/PublicBusinessView` як композитний компонент 11 логотипів + 2 кнопки + 2 QR).
- **Overlays** (`overlays.md`) — `useDeleteBusinessConfirmStore` живе **в slice** `apps/web/src/features/business-edit/`, не у глобальному каталозі. Реєструється у `app/overlays.tsx`.
- **UI primitives** — нативні `<button>` / `<input>` заборонені; усе через `Ui*`. Touch-targets ≥ 44×44 (`responsive.md` §2).
- **Tone & Style** — усі toast / confirm / error повідомлення в classic-polite тоні (минулий час для success, без знаку оклику, "ви"). **Локалізація single-locale uk inline** за поточною policy продукту: web-рядки інлайн у JSX/компонентах, email-тексти у `apps/api/src/modules/email/translations.ts`. Sprint 3 в межах §3.10 узгоджує `tone.md` з цією policy (правка §7 — нижче), щоб після спринта правила тону і локалізаційний контракт не суперечили один одному. Жоден агент після Sprint 3 не повинен мати неоднозначності "куди класти рядок".
- **Fail-fast** (`fail-fast.md`) — жодних нових env vars у Sprint 3 (G1 видаляє `NBU_PAYLOAD_LINK_HOST`). Якщо з'явиться щось поточно на ум — додавати тільки разом з .env.example + documenation.

#### Manual checks (`manual-checks/README.md`)

- 🔲 **Оновити QR-4** — рішення G3 (новий текст про "знак гривні в центрі").
- 🔲 **Зняти QR-6 з gate-перед-launch** — рішення G4: тепер це post-launch metric для рішення "чи прибрати запасну кнопку".
- 🔲 **Додати нові пункти Sprint 3** (нумерація — згідно конвенції файла, простими словами без термінів):
    - **CAB-1.** "Зайшли в кабінет з телефона на 320 пікселях — нічого не зрізане". Перевіряємо адаптивність на iPhone SE 1.
    - **CAB-2.** "Створили перший бізнес через 4 кроки — кожен крок зрозумілий, не плутає". Перевіряємо UX wizard-а на нетехнічному користувачі.
    - **CAB-3.** "Видалили бізнес, протягом 5 секунд натиснули Скасувати — бізнес повернувся". Перевіряємо undo flow.
    - **CAB-4.** "Зайшли в режим бухгалтера — свої бізнеси зникли. Вийшли з режиму — повернулись". Перевіряємо toggle.
    - **PUB-1.** "Відкрили публічну сторінку зі смартфона — заголовок, банки, дві кнопки і два QR видно без скролу або з мінімальним скролом".
    - **PUB-2.** "Натиснули кнопку «Інший банк» на iPhone — телефон запропонував обрати між Privat24, Monobank, PUMB". Перевіряємо що app-link працює на новій адресі НБУ.
    - **PUB-3.** "Натиснули кнопку «Інший банк (запасний)» — те саме спрацювало на старій адресі". Перевіряємо legacy-fallback.
    - **PUB-4.** "Відсканували перший QR з іншого телефона — банк відкрився коректно. Те саме для другого QR".
    - **PUB-5.** "Перейшли на адресу `pay.finly.com.ua/IVANENKO` (великими буквами) — сторінка відкрилась за адресою `/IvanEnko`". Перевіряємо canonical-redirect (E1).

Стиль файла — **простою мовою без термінів** (правило файла в шапці). Кожен пункт зрозумілий школяру з першого читання.

#### Документація

- 🔲 **`docs/conventions/tone.md`** — оновити §7 (правило про i18n каталоги): замість вимоги `messages/uk.json + messages/en.json` зафіксувати поточний контракт продукту: "single-locale uk; web-copy інлайн у JSX, email-копія у `apps/api/src/modules/email/translations.ts`; return-to-i18n — окрема велика міграція з ADR, не одна правка прапорця". Це частина Sprint 3 deliverable (не cleanup-tail) — після merge правила тону і локалізаційна policy узгоджені.
- 🔲 **`CLAUDE.md`** — оновити секції:
    - "## Project Structure" — додати `host-pay/[slug]/page.tsx` (host-routed публічна вивіска, internal URL-сегмент під middleware-rewrite), `business/`, `business/[slug]/`, `business/new/` у web; видалити `dashboard/`.
    - "## Domain Model" — додати поля `taxationSystem`, `isVatPayer`, `slugLower`, `seoIndexEnabled` у Business.
    - "## Module Dependency Map" — додати `BusinessesModule → QrModule + UsersModule`.
    - "## API Overview" — додати таблицю `BusinessesController` (cabinet) і `PublicBusinessesController`.
    - "### QR generation pipeline" — оновити за G6.
    - "### Avatar upload pipeline (R2)" і "### Auth/session lifecycle" — без змін.
    - "## Configuration & Environment > API required" — видалити `NBU_PAYLOAD_LINK_HOST` (G1).
    - "## Known Complexities" — додати:
        - "**Slug case-preserved + uniqueness on lower:** Twitter/Instagram-style. Unique-index на `slugLower`, не на `slug`. 308 Permanent Redirect (Next.js `permanentRedirect`) на canonical case при URL mismatch. Reserved-перевірка на lowercase." (E1)
        - "**Hard-delete з frontend-only 5s Undo:** жоден запит на backend поки 5 секунд не минули. Browser unload protягом 5s = implicit cancel. Backend transient flag навмисно відкинутий — `setTimeout` у Node не переживає рестарт і не працює multi-instance." (F8)
        - "**Bookkeeper-toggle тільки UI-фільтр:** ownership-bit на user-документі. Перемикання не мутує жодного бізнесу — лише фільтрує `getOwnedAndManaged` query. Sprint 6 додасть Paid-gating через guard." (E5)
        - "**Public endpoint whitelist (6 полів) + nbuLinks vector:** type, name, slug, acceptedBanks, seoIndexEnabled, `nbuLinks: { primary, legacy }`. Реквізити **не** повертаються JSON-ом — вони присутні лише через `nbuLinks` як Base64URL-encoded NBU payload (той самий vector, що і QR PNG endpoint). Дані доступні **тільки** через формати, що читаються банком як платіжна команда, не raw для довільного scraping-у." (C4 + A2)
- 🔲 **`docs/sprints/README.md`** — оновити статус Sprint 3 (`[ ]` → `[x]` після завершення; на старті — без змін).

#### Тестова стратегія

- **API unit:** `BusinessesService.spec.ts`, `SlugGeneratorService.spec.ts`, `BusinessAccessGuard.spec.ts`, `payload-mapper.spec.ts`.
- **API e2e:** `apps/api/test/businesses.e2e-spec.ts` — full-cycle (create → read → update → delete як ФОП; access-deny як чужий user; public read анонімно).
- **Web unit:** `BusinessWizardForm.spec.tsx`, `EditableField.spec.tsx`, `TaxationSection.spec.tsx`, `delete-flow.spec.tsx`, `host-pay/[slug]/page.spec.tsx`, `middleware.spec.ts` (host-routing 6 кейсів з §3.9 + видалення `/dashboard` + видалення `/pay`).
- **Manual UAT:** оновлення `manual-checks/README.md` (вище).

---

## Definition of Done (спринт у цілому)

- 🔲 Хвости Sprint 2 (G1–G7) виконані; `NBU_PAYLOAD_LINK_HOST` env видалено з усіх артефактів; QR-asset замінений на знак гривні; QR-4 переформулювано.
- 🔲 `pnpm build` зелений (3/3 packages).
- 🔲 `pnpm test` зелений: types з новими contract-spec-ами, api з ~30 нових тестів (CRUD + Guard + slug + service + e2e), web з ~25 нових (wizard + editable + delete + public + middleware).
- 🔲 `pnpm lint` без NEW warnings (preexisting 86 — окрема ініціатива в `tech-backlog.md`).
- 🔲 Cabinet flow — створення бізнесу через 4-step, inline-edit, delete з 5s Undo, bookkeeper-toggle — працюють у dev на всіх трьох viewport-ах (320 / 768 / 1440 px).
- 🔲 Public flow — сторінка `pay.finly.com.ua/{slug}` рендериться (з налаштованим dev-host у `/etc/hosts`), 11 неактивних логотипів + 2 активні кнопки + 2 QR.
- 🔲 Manual checks оновлено (CAB-1..4, PUB-1..5, переформулювані QR-4 / QR-6).
- 🔲 `CLAUDE.md` оновлено (Domain Model, API Overview, Known Complexities, QR pipeline).
- 🔲 `docs/product/business-flow.md` оновлено (G7).

---

## Ризики / TPM-зауваги

### Sprint-blocking

1. **Host-aware маршрутизація на одному Next.js project (A1).** Локальний dev потребує `/etc/hosts` aliasу для `pay.finly.com.ua`; CI/CD — окремий DNS-record + nginx-route, що проксує обидва домени на один Next.js container. **Mitigation**: фіксуємо алгоритм middleware як перший епік §3.5 і верифікуємо на dev до старту §3.9. Якщо middleware-підхід не зайде — fallback на окрему apps/web-public app (додає ~1 день, але виходить deterministic).
2. **Rendering 2 QR на public-сторінці (E7) + cache hit-rate.** Кожна public-сторінка тригерить 2 PNG-генерації (через `apiClient` proxy на api). Sharp на cold cache ~100-300 ms × 2 = blocking ~500 ms на page load. **Mitigation**: `Cache-Control: max-age=3600` на api endpoint + Server Component `revalidate: 60` на frontend → 99% rev-hit на cached HTML. **Verification protocol** (без debug-сліду в shipped code): cold-load latency вимірюється або через DevTools "Network" tab (`pay.finly.com.ua/{slug}` зі скиданням cache, фіксуємо TTFB + Content Download для двох `qr/nbu.png?host=...` запитів), або через окремий dev-only скрипт `apps/api/scripts/benchmark-qr.ts`, що викликає `QrService` напряму у timing-loop і виводить p50/p95. Скрипт живе у `scripts/` — НЕ потрапляє у production bundle, не імпортується з runtime-коду. Жодних `console.time` / `logger.debug` у production code path. Гейт: p95 cold-render ≤ 400 ms; total TTI ≤ 1.5 s на 4G throttle.
3. **Видалення `/dashboard` ламає посилання у логах і email-шаблонах (якщо такі є).** **Mitigation**: повний grep по репо на `'/dashboard'` (вже видно `useUserMenu`, `middleware`, `auth/signin?reason=session-expired` flow) перед merge; всі рядки оновлюються в одному PR. Існуючі sent-emails з link-ами на `/dashboard` — не блокер (post-Sprint-1 deploy-ів не було, реальних користувачів немає).

### Out-of-scope, але закладене коректно

1. **Vanity-slug (Paid)** — Sprint 6. Архітектурно `SlugGeneratorService` готовий до додавання другого методу `validateVanitySlug(input)` без переписування. Reserved-list і case-preserved-storage уже є.
2. **Per-bank deep-links** — Sprint 5. UI-структура (11 логотипів сіткою) готова до того, що логотипи стають активними з `href=monobank://...`. Жодних архітектурних змін від Sprint 3 не вимагається.
3. **Free vs Paid ліміт на 1 бізнес** — Sprint 6. Між Sprint 3 і Sprint 6 деплою на прод немає (C6) — legacy-юзерів з 5 бізнесами не існуватиме.
4. **Active invoice warning при delete (C2)** — Sprint 4 додає, бо потребує `Invoice.exists({ businessId })`. Sprint 3 confirm-dialog показує статичний текст "клієнти з посиланнями не зможуть оплатити".
5. **Custom-logo upload (Sprint 6)** — `QrLogoCompositor` параметризований через `logoPath: string` (Sprint 2 рішення). Sprint 6 додає file-resolver, що приймає R2 key, без зміни renderer-а.
6. **R2-кеш PNG-байтів QR** — Phase 1.5+. Триггер: ETag-based invalidation замість тупого `max-age=3600`. Не блокер, бо at-MVP-scale traffic недостатній для оптимізації.
7. **Telemetry / scan-counter** — Phase 1.5+. На public-сторінці закладемо UTM-параметри в href кнопок банків (Sprint 5 при включенні per-bank), щоб analytics-команда могла на майбутнє підключити GA / Posthog.
8. **`taxationSystem` для ТОВ/ВАТ** — на момент Sprint 3 enum жорстко `simplified-1/2/3 + general` (для ФОП). Розширення (загальна для юр. осіб з іншими характеристиками) — окрема ініціатива при додаванні `BusinessType ≠ 'fop'`. Migration не потрібна, бо існуючі бізнеси заповнили лише ФОП-валідні значення.

---

## Послідовність робіт (рекомендована)

1. **§3.0 Cross-sprint cleanup (G1–G7).** Перший — інакше §3.2 / §3.3 будуть вертатись виправляти env. (~0.5 дня).
2. **§3.1 Schema + contracts.** `taxationSystem`, `isVatPayer`, `slugLower`, `seoIndexEnabled`; partial Zod; tests. Підкладає фундамент для §3.2 і §3.7. (~1 день).
3. **§3.2 Cabinet CRUD + slug-генератор + Guard.** Backend контракт повністю стабілізується. (~1.5-2 дні).
4. **§3.3 Public endpoint.** Тривіально після §3.2 (~0.5 дня).
5. **§3.5 Frontend навігація.** Перейменування `/dashboard` + middleware-зміни + header bookkeeper-toggle. Перед §3.6, бо list-page живе на `/business`. (~0.5 дня).
6. **§3.6 List page + empty-state.** (~0.5 дня).
7. **§3.7 4-step wizard.** Найважче UX-завдання — день-півтора на форму + step-навігатор. (~1.5 дні).
8. **§3.8 Cabinet edit page.** Картки-секції + inline-edit + preview-toggle + delete-undo. (~2 дні; найбільший епік).
9. **§3.9 Public page.** Host-aware middleware (~0.5 дня) + сама сторінка з 11 логотипів + 2 кнопки + 2 QR (~1 день). (~1.5 дні разом).
10. **§3.4 Bookkeeper toggle endpoint** (~0.25 дня) — паралельно з §3.5 (можна ще раніше; фактично 30-хвилинна задача).
11. **§3.10 Cross-cutting cleanup.** Manual checks, CLAUDE.md, business-flow.md. (~0.5 дня).
12. **Регресія + smoke у dev на трьох viewport-ах.** (~0.5 дня).

**Загалом:** ~10–11 робочих днів для одного інженера. При 2 інженерах (один backend + slug + guard, інший — frontend wizard + edit + public) — calendar 6-7 днів. Wizard і edit-page — критичний path; public-сторінка може йти паралельно з edit-page після §3.3.

**Не починати §3.7-§3.9 до закриття §3.1-§3.3** — frontend без backend-контрактів = переписувати після з'ясування, що Zod-схема відрізняється від уявлення.
