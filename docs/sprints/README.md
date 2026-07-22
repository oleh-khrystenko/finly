# Finly — План спринтів MVP (Phase 1)

> Короткий tree-overview спринтів MVP. Кожен спринт планується далі окремим документом у цій папці.
>
> **Статус:** оновлено 2026-06-05. Sprint 1, 2 закриті; Sprint 3, 4, 7, 8 — функціональний flow закритий, UAT-прогон pending (раніше згаданий 8.5 follow-up CTA superseded by Sprint 10 SP-7); **Sprint 5, 9–16 — реалізовано (код у `main`)**; Sprint 17 (білінг на WayForPay) — дослідження зроблено, план переписується. **Sprint 9 розщеплено 2026-05-11 на 4 окремі спринти (9, 10, 11, 12)** через надмірний обсяг оригінального плану — деталі у відповідних README. Білінг отримав порядковий номер 17 у дереві, але живе в теці `06-billing` (слот 06 звільнився від оригінального плейсхолдера "Монетизація + лонч").

---

## [1. Архітектурний фундамент](01-foundation/README.md)

- [x] Схеми БД (closed-end, без UI там, де "заготовка")
    - [x] `User`: `lastName` required, `role` enum, `worksAsBookkeeper`
    - [x] `Business`: `type`, nullable `ownerId`, `managers`, реквізити
    - [x] `Invoice`: належить бізнесу, slug, lock-поля
- [x] Юридичні сторінки (TOS / Privacy під Finly)

> Code-deliverables закриті. Open: `pnpm lint` без warnings (86 preexisting → винесено в [`tech-backlog.md`](../product/tech-backlog.md)); юридичне фінал-ревʼю — Sprint 6.

## [2. QR-ядро (генерація + валідація)](02-qr-core/README.md)

- [x] Генератор формату **003** (основний)
- [x] Генератор формату **002** (fallback)
- [x] Валідатори реквізитів (IBAN checksum, ІПН, довжини за версіями)

> Закрито. Sprint 3 §3.0 додав ревізії A2 (дві host-кнопки замість env) і C5 (нормативний asset гривні замість Finly-лого).

## [3. Кабінет бізнесу + публічна вивіска](03-cabinet-public/README.md)

**Реалізовано:**

- [x] Backend: BusinessesModule (CRUD на slug як route-param, BusinessAccessGuard, SlugGeneratorService, payload-mapper) + PublicBusinessesController (whitelist 6 полів + nbuLinks + 2 QR endpoints)
- [x] Schema: case-preserved slug + `slugLower` unique-index, taxationSystem/isVatPayer coupled-rule, seoIndexEnabled, migration 2026-05-03
- [x] Bookkeeper toggle (UsersService.updateProfile + frontend dropdown)
- [x] Frontend cabinet `/business`, `/business/new` (4-step wizard), `/business/[slug]` (inline-edit + preview-toggle + 5s undo delete)
- [x] Публічна сторінка `pay.finly.com.ua/{slug}` через host-aware middleware-rewrite на `/host-pay/[slug]` (Server Component, ISR, canonical-redirect, SEO `noindex` default)
- [x] Manual checks **чек-лист додано** (CAB-1..4 + PUB-1..5; UAT-прогон — pending QA, статус кожного пункту "⬜ ще не зроблено" у docs/manual-checks/README.md)
- [x] Cross-cutting: CLAUDE.md (Project Structure / Domain Model / Module Map / API Overview / Known Complexities), tone.md §7 single-locale, business-flow.md, qr-spec/README.md

**Open deliverable:**

- [ ] **11 SVG логотипів банків** у `apps/web/src/shared/icons/banks/` (Sprint plan §3.9 + B5: "Реальні логотипи зі сайтів банків"). Зараз `PublicBusinessView` рендерить generic text-tile з ініціалом — це working fallback для UAT, але **не Sprint plan deliverable**. B5 generic-варіант передбачений для майбутнього юр-конфлікту ("якщо колись хтось із банків попросить прибрати — заміняємо на generic"), не для initial implementation. Збір assets з brand-guidelines 11 банків — окрема задача (вибір license-clean SVG, нормалізація розмірів).

**Pending QA:**

- [ ] **UAT-прогон** Manual checks CAB-1..4 + PUB-1..5 (потребує реального телефона + 11 банків + іншого пристрою для скана QR). Статус кожного пункту у `docs/manual-checks/README.md` поки `⬜`; результати фіксуються у "Журналі результатів" того ж файла.
- [ ] E2E-прогон публічної сторінки на CI (Sprint 4/5 — потребує DNS-fixture у GH Actions для emulating `pay.finly.com.ua` host у тесті).

> Status summary: функціональний end-to-end flow ФОП → кабінет → wizard → cabinet з QR → публічна сторінка з real NBU app-link CTA працює. **Sprint вважається закритим після** (а) збору 11 SVG логотипів, (б) UAT-прогону manual checks.

## [4. Інвойси](04-invoices/README.md)

**Реалізовано:**

- [x] §4.0 Infra-prep: `MongoMemoryReplSet` test-helper, `extra_hosts` alias у `docker-compose.dev.yml`, README "Mongo replica-set для local dev" з 3 варіантами (Atlas / Docker `--replSet rs0` / local mongod)
- [x] §4.1 Schema + slug-генератор: `Business.invoiceSlugPresetDefault`, `Invoice.{slugCounterScope, slugCounter}` + partial-unique compound, `InvoiceSlugGeneratorService` (4 пресети + counter monotonic per-(business, scope), Kyiv-tz boundary-fix), `humanSlugPartSchema` + `SlugInputSchema` discriminated union, `formatYymmddhhmmss` + `getKyivYearMonth` через `Intl.DateTimeFormat({ timeZone: 'Europe/Kyiv' })`
- [x] §4.2 Backend CRUD (cabinet): `InvoicesService`, `InvoiceAccessGuard`, `InvoicesController` (5 endpoints), розширення `BusinessesController.{list, getBySlug, delete}` на `invoicesCount` + `affectedInvoices`, **cascade hard-delete через `withTransaction`** (atomic-or-nothing, 4 нові RESPONSE_CODE), `applyJsonTransform` для `_id → id` JSON shape
- [x] §4.3 Backend public: `PublicInvoicesController` (3 endpoints, whitelist 7 полів через `PublicInvoiceSchema`, `paymentPurpose` always-resolved через `effectiveInvoicePurpose`), `payload-mapper.ts` (`buildPayloadInputFromInvoice` з amount/lockMask/validUntil)
- [x] §4.4 Frontend cabinet: `InvoicesSection` (paginated list з `mergeUniqueById`-dedup) + `InvoicesSettingsSection` (5 опцій dropdown `invoiceSlugPresetDefault`) на сторінці бізнесу; counter "{N} рахунків" + scroll-target `#invoices` на `BusinessCard`; `useSlugPresetWarningStore` для `with-purpose` privacy-warning; `UiEditableField` переніс у `shared/ui/`
- [x] §4.5 Frontend create: form-route з flat 6-option slug-dropdown, RHF + Zod-resolver, live-validation `humanSlugPartSchema`, лічильник символів `purpose`, coupled SP-6 amount-lock, default-preset з business-level налаштування
- [x] §4.6 Frontend cabinet-invoice: `/business/[slug]/invoice/[invoiceSlug]` з 6 секціями-картками (Amount/Purpose/ValidUntil/Slug/QR/Danger), inline-edit через `UiEditableField`, preview-toggle (SP-2 prefetch-on-mount), 2-step delete (`useDeleteInvoiceConfirmStore` modal + `scheduleInvoiceDeleteWithUndo` 5s-undo)
- [x] §4.7 Frontend public-сторінка: middleware **Branch A2** (2-сегментний path → rewrite на `/host-pay/{biz}/{inv}`), Server Component з canonical-redirect business-slug + `noindex` для всіх invoices, `InvoicePublicView` (heading з amount, sub-info, expired-banner sanity-block)
- [x] §4.8 Cross-cutting docs: CLAUDE.md (Domain Model + Module Map + API Overview + Known Complexities), business-flow.md (Free invoices у §6), qr-decisions.md closure-маркери

**Pending QA:**

- [ ] **UAT-прогон INV-1..7** (`docs/manual-checks/README.md` § Інвойси): live-банк-тести з фіксованою/null-amount QR, expired-banner, cascade-delete, with-purpose-warning, simple-counter monotonic, листинг counter — потребують реального телефона з 3 банками + іншого пристрою для скана.

> Status summary: backend (api unit 575 + e2e 81), frontend (web 302), middleware spec (33), build 3/3 — все зелене. Sprint вважається закритим після UAT-прогону INV-1..7.

## [5. Per-bank deep links (research-driven)](05-per-bank/README.md)

- [x] Research-spike по банках (iOS+Android, payload, fallback) — AASA-дослідження deep-link-ів
- [x] Імплементація per-bank кнопок + policy для непокритих банків

> Реалізовано (код у `main`): per-bank deep-link grid на публічних сторінках + реальні App Store логотипи через примітив `UiBankLogo`.

## 6. Монетизація + лонч

- [ ] Free vs Paid гейти (ліміт бізнесів)
- [ ] Preview-режим у кабінеті + onboarding (2 landing)

> Плейсхолдер майбутньої роботи; окремої теки не має (слот `06-` зайнятий білінгом, див. Sprint 17). Частини оригінального скоупу вже від'єдналися в окремі спринти: vanity-slug — Sprint 15, каркас custom-logo у QR (шар C) — Sprint 14, білінг-провайдер — Sprint 17.

## [7. QR-код не тільки для бізнесу](07-payer-types/README.md)

Зараз сайт думає, що QR-код потрібен тільки підприємцям. Але насправді він стане в нагоді й звичайній людині — скинутись з друзями на вечірку, зібрати на подарунок чи донати на благодійність. Тому додамо вибір з чотирьох варіантів: я особисто, ФОП, ТОВ або організація (як ОСББ чи благодійний фонд), і кожен буде заповнювати лише ті поля, які йому потрібні.

Важливо пам'ятати: у фізособи і ФОП код 10-значний (РНОКПП), а у ТОВ і організацій — 8-значний (ЄДРПОУ), тому перевірка номера буде різна. Поля про систему оподаткування і ПДВ показуємо тільки ФОП і ТОВ — звичайній людині й ОСББ вони не потрібні. Усе інше (рахунок, назва, призначення платежу) однакове для всіх.

## [8. Публічний QR-генератор для незареєстрованих + claim-flow](08-public-qr-preview/README.md)

Лендінг `finly.com.ua` стає інтерактивним: будь-яка людина без реєстрації вводить IBAN + РНОКПП + призначення → за 2 секунди отримує валідний за нормативом НБУ QR-код 003 + universal-link, що відкривається в банк-додатку. Дані живуть у браузері через `localStorage` і не зникають при перезавантаженні. Один клік "Зберегти у кабінет" → реєстрація → бізнес автоматично створюється у БД і прив'язується до акаунта; banner на business-detail запрошує переглянути список банків.

**Реалізовано:**

- [x] §8.0 Shared contract `QrPreviewInputSchema` + `QrPreviewResponseSchema` (reuse `businessNameSchema` / `ibanZod` / `individualTaxIdZod` / `businessPaymentPurposeTemplateSchema`).
- [x] §8.1 Backend: `QrController` з `POST /qr/preview` (без auth, без БД, throttle-bucket `'qr-preview'` 10/min/IP), reuse `QrService.renderForNbuPayload`.
- [x] §8.2 Frontend persistence: entity `qr-landing-draft` (Zustand+persist+localStorage `finly:landing-draft`, version 1, intent state-machine).
- [x] §8.3 Frontend feature `qr-landing-preview`: `QrLandingBlock` (orchestrator з form-lift + hydration-gate), `QrLandingForm` (4 поля + RHF + Zod), `QrLandingResult` (empty/filled state, copy + claim CTA), `publicPostJson` у `shared/api/client.ts`.
- [x] §8.4 Claim-flow: `useClaimLandingDraft` hook у `(protected)/layout.tsx` як sibling до AuthGuard; race-protection через `inProgressRef`; чекає на onboarding completion для гілки B.
- [x] §8.5 Banner `CompletedFromLandingBanner` на business-detail (`?completed-from=landing`), scroll-target `id="banks"` на `BanksSection`.
- [x] §8.6 Hero: widget `landing-hero` з 3 content-complete benefit-tiles, перепис `app/page.tsx`.
- [x] Cross-cutting fixes: NBU-charset refine на entity-Zod (закриває "save → render valid" інваріант для `businessNameSchema` / `businessPaymentPurposeTemplateSchema` / `invoicePaymentPurposeSchema`); `PayloadValidationError` → 400 у `AllExceptionsFilter` з `RESPONSE_CODE.PAYLOAD_TOO_LARGE`.

**Open follow-up (Sprint 8.5):**

- [x] **~~`claim-failed` recovery CTA на `/business`-empty-state~~** — **superseded by Sprint 9 §SP-7** (form-recovery flow). Sprint 9 переписує claim-flow на 2 sequential POST (Business → Account); failure будь-якого з POST-ів робить `router.push('/business/new?from=landing')` або `'/business/{slug}/account/new?from=landing'` з pre-fill з `qrLandingDraftStore.formData`. Це покриває recovery-path детермінoвано і одразу, без ручної навігації user-а на `/business`-empty-state і без потреби в окремому CTA. Додатково Sprint 9 §9.4 видаляє helper `claimLandingDraftAsBusiness`, на якому планував reuse цей CTA, і migrate-ить legacy `intent === 'claim-failed'` → `'idle'` (нові granular states `'claim-failed-business'` / `'claim-failed-account'` обробляються form-recovery flow напряму). Original рядок ticket-у був написаний до Sprint 9 architecture-decision і втратив підставу.

**Pending QA:**

- [ ] **UAT-прогон LAND-1..8** (`docs/manual-checks/README.md` § "Лендінг без реєстрації"): live-телефон + банк-додаток для перевірки сканування anon-QR; reload форми після localStorage-persist; claim-flow гілки A (Google OAuth з повним профілем) і B (magic-link → /profile?mode=new → автоматичний claim після PATCH).

> Status summary: types 517, api unit 642, web 504 — все зелене. Sprint вважається функціонально закритим; повне close після UAT-прогону LAND-1..8. Sprint 8.5 follow-up CTA закрито як superseded by Sprint 9 §SP-7.

## [9. Banking Accounts: розщеплення Business на Business + Account](09-accounts/README.md)

Поточна модель плутає юр-особу (тип, ІПН, оподаткування) і банківський рахунок (IBAN). ФОП з двома рахунками (Privat + Mono) мусить дублювати юр-особу як два бізнеси з ідентичним ІПН — некоректно. Sprint 9 розщеплює `Business` на дві сутності: `Business` (юр-особа) + `Account` (банківський рахунок). `Invoice` отримує `accountId`. Public URL стає матрьошковим (`/{biz}/{accountSlug}/{invoiceSlug}`); cabinet-навігація — теж nested. Інвойсна нумерація — per-account. IBAN immutable; account можна видалити тільки з 0 інвойсів. **CTA "Зберегти у кабінет" на лендінгу тимчасово вимикається** на час між Sprint 9 і Sprint 10 deploy (anon-claim flow ламається на schema-change). Production-міграція не потрібна — даних ще немає, dropDatabase + чистий старт.

**Status:** реалізовано (код у `main`). Розщеплення Business → Business + Account, nested public URL і per-account нумерація — у проді.

## [10. Anon-claim refactor під Business + Account модель](10-anon-claim-refactor/README.md)

Sprint 9 schema-change ламає Sprint 8 anon-claim flow на backend-рівні (чинний body `{ requisites.iban }` reject-ається). Sprint 10 повертає CTA "Зберегти у кабінет" з новою архітектурою: 2 sequential POST (Business → Account) з granular state-machine + form-recovery patern на failure; magic-link через Redis-draft sub-поле для cross-device flow з KEEPTTL-overwrite на anti-spam dedup-hit; idempotency-key захист від duplicate-Business на retry-after-tab-close через partial-unique-index; terms-pre-stamp на backend (закриває acceptTerms ordering window). Новий `LandingClaimModule` як separation of concerns від `AuthService`. Verify-page-handler resolve-ить `claimState`-discriminator (success / business-failed / account-failed) і робить router.replace на канонічний target.

**Status:** реалізовано (код у `main`). CTA "Зберегти у кабінет" повернуто на новій архітектурі (2 sequential POST + form-recovery), `LandingClaimModule` виділено.

## [11. Deep-link UX-recovery після abandoned magic-link claim](11-deep-link-recovery/README.md)

Phone-юзер відкрив magic-link → backend створив Business+Account і виставив session-credentials, але юзер закрив таб ДО `router.replace` claim-target-у (network drop, accident). Без mitigation на наступному cold-login (день/тиждень пізніше) юзер потрапляє на дефолтний cabinet-root і втрачає inструкцію "Перевірте список банків" (banner `?completed-from=landing` не показується). Sprint 11 додає `User.pendingPostLoginTarget`-stamp на success-claim (LandingClaimService extension); same-device flow clear-ить через verify-page-handler; cold-login flow resume-ить через AuthInitializer. Двошарова open-redirect-protection через shared `validateSameOriginPath`-helper.

**Status:** реалізовано (код у `main`). `User.pendingPostLoginTarget` stamp/consume на success-claim + cold-login resume, open-redirect-protection через `validateSameOriginPath`.

## [12. Orphan-Business cleanup: email-pipeline + cron-deletion](12-orphan-cleanup/README.md)

Phone-юзер міг закрити таб і так не дозаповнити firstName/lastName — orphan-Business+Account накопичуються у БД. Sprint 12 додає cron-сервіс з 3-stage email-pipeline (1-й день: soft-reminder; 6-й день: final-warning; 7-й день: cascade-delete). Prereq-guards гарантують cron-downtime resilience: навіть на multi-day-downtime юзер отримує обидва листи перед deletion. Stamping через `User.profileCompletionReminders`-sub-doc; claim-first-pattern race-protection проти double-fire-paralleled-crons. Email templates на classic-polite tone, multi-business pluralization. Cross-field env-invariant `first < final < deletion`.

**Status:** реалізовано (код у `main`). Cron `OrphanProfileCleanupService` з 3-stage email-pipeline + stamping через `User.profileCompletionReminders`.

## [13. Dependency Inversion](13-dependency-inversion/README.md)

Розв'язуємо дві реальні петлі модульних залежностей (`AuthModule` ↔ `LandingClaimModule` ↔ `UsersModule` і `StorageModule` ↔ `UsersModule` ↔ `AuthModule`) інверсією на рівні класів, а не косметичним `forwardRef`. `AuthService` стає механічним (validate token, find/create user, generate tokens), terms-stamp і landing-claim переїздять у оркестрацію `AuthController`. `StorageService` стає pure file-ops, новий `AvatarService` всередині `UsersModule` володіє оркестрацією аватарки. `LandingClaimResult` виноситься у `packages/types` як shared Zod discriminated union; контракт `POST /auth/magic-link/verify` отримує вкладений `claim` замість плоских claim-полів (breaking change у API-shape, mono-repo міграція атомарно). Першим коміттом закомічується tactical unblocker для docker dev (`forwardRef` у StorageModule), останнім — видаляється разом з імпортом UsersModule.

**Status:** реалізовано (код у `main`). Петлі розв'язано інверсією: `AvatarService` у `UsersModule`, `MagicLinkVerifyController` у `LandingClaimModule`, `LandingClaimResult` у `@finly/types`.

## [14. QR-брендинг](14-qr-branding/README.md)

Робимо два типи QR візуально різними і перетворюємо QR на брендований носій для друку. Зараз обидва типи виходять однаковими, а URL-QR (тип-2) узагалі не показується в UI. НБУ-QR (тип-1) лишається строго нормативним (центр зі знаком гривні недоторканний) і отримує підпис "за стандартами НБУ"; URL-QR отримує Finly-брендинг у центрі і слоган. Колір обох лишається чорно-білим, розрізнення несуть центр і рамки навколо коду. Тип-2 виводиться у видимий UI на всіх трьох рівнях (бізнес, рахунок, інвойс) з новим endpoint на рівні бізнесу. Додається завантаження для друку через параметр розміру на тому самому endpoint. Каркас рендеру параметризований під майбутній клієнтський брендинг (шар C, монетизація) без його реалізації.

**Status:** реалізовано (код у `main`). Два візуально різні типи QR, тип-2 виведено в UI на всіх трьох рівнях, download для друку, параметризований рендер-каркас.

## [15. Редаговувані nested-slug-и](15-editable-nested-slugs/README.md)

Account і Invoice отримують редаговуваний красивий slug, як у Business. Знімаємо immutability, переходимо на case-insensitive унікальність у межах батька (бізнес для рахунку, рахунок для інвойсу) і дзеркалимо Sprint 14: окремі history-collection, public lookup з history-fallback, постійний redirect на канонічний URL і anti-squatting на grace-вікно, щоб надруковані QR і збережені посилання на старий slug не ламались. Редагування доступне власнику і менеджерам; flow створення не змінюється; пресет-нумерація інвойсу при rename лишається недоторканою.

**Status:** реалізовано (код у `main`). Account і Invoice отримали редаговувані vanity-slug-и з history-fallback, 308-redirect і кнопкою "Згенерувати нове посилання".

## [16. Публічна довідка + заземлений AI-чат](16-public-help-docs/README.md)

Публічна сторінка довідки `finly.com.ua/help` для ФОП і бухгалтерів: багаторозділовий help-center з окремими статтями за власними URL. Поверх статичних статей живе публічний AI-чат, заземлений на той самий контент. Архітектурний стрижень, один набір markdown-статей у репозиторії як єдине джерело правди: Web рендерить їх у SEO-сторінки, API згодовує той самий текст AI як базу знань, тому документація не дрейфує від продукту. AI скоупиться строго на "як користуватись Finly" і відмовляє у податкових/юридичних/off-topic питаннях. Гаманець захищений двошарово (per-IP ліміт для аноніма + глобальний денний бюджет-circuit-breaker); статична довідка ніколи не залежить від доступності AI. Anon-чат ефемерний, нічого не пише в БД. Переюз існуючого SSE-стріму і чат-UI з кабінету.

**Status:** реалізовано (код у `main`). Публічний help-center `finly.com.ua/help` + заземлений на ті самі статті AI-чат, sitemap/robots.

## [17. Міграція білінгу на WayForPay](06-billing/README.md)

Замінюємо Stripe на WayForPay, бо Stripe офіційно не працює з українськими ФОП. Білінг обслуговує лише оплату самого сервісу (підписка + разові пакети виконань), прийом платежів клієнтами лишається QR/НБУ. Підписників ще немає, тому це чиста заміна (hard cutover) без двопровайдерного співіснування: Stripe видаляється повністю. Спайк виявив дві моделі рекурентності у WayForPay (нативні Regular payments з провайдерським шедулером проти токенізації recToken+Charge з нашим шедулером), вибір A чи B фіналізується у sandbox. Зовнішній блокер: активація рекурентів/токенізації може потребувати запиту в підтримку WayForPay, подати найпершим; паралельно договір (Дія.Підпис). Каталог планів переїжджає зі Stripe Products у статичний типізований конфіг з інваріантом єдиного джерела істини. Власний кабінет керування підпискою замінює готовий Stripe-портал (скасування, зміна плану, оновлення картки через re-bind, список останніх списань) і це реальний фронт-обсяг, а не косметика. Рекуренти гібридні: розклад веде провайдер (Regular payments), а recToken тримаємо для негайної proration-доплати при апгрейді (активація токенізації, як і рекурентів, блокер дня один). У скоупі також trial 1 місяць, скасування з поверненням за невикористаний період (refund) і нова легка колекція платежів як джерело історії й повернень.

**Status:** заплановано з чистого листа (2026-06-05), не стартував. Дослідження `research-spike.md` + план `README.md` готові. Зовнішній блокер дня один: запит у підтримку WayForPay на активацію рекурентів/токенізації + укладання договору (Дія.Підпис).

## [18. Демонтаж cabinet AI-chat і внутрішньої валюти з UI](18-remove-ai-chat-currency/README.md)

AI стає підкапотним, а монетизація йде через підписку і одноразові продажі без user-facing валюти «виконань». Спринт прибирає cabinet AI-chat (`/ai-chat`) як фічу і ховає внутрішню валюту з усіх екранів, ріжучи по чистому шву: споживання (cabinet-чат плюс резерваційна машинерія) зноситься начисто, а нарахування (білінг через ledger) лишається фізично недоторканим до редизайну у WayForPay-спринті. Публічний help-chat не чіпається і стає самодостатнім (власні типи, контролер, сервіс), AI-модуль розриває залежність від Users-модуля. Колекція історії чату дропається без міграції. Відкрите питання, делеговане у Sprint 17: чим стають одноразові продажі без «пакетів виконань».

**Status:** заплановано (2026-06-07), не стартував.

## [19. Платіжний MVP: каталог по цінності + справжні замки](19-payment-mvp/README.md)

Готова WayForPay-каса нарешті починає щось продавати. Каталог переписується з мертвих «виконань» на цінність: 2 підписки (Свій бренд 49, Бухгалтер 99) + 2 one-off місячні доступи (69, 129), без trial. Уперше причіплюємо справжні замки до наявних фіч через єдиний рівень доступу (none < brand < bookkeeper): редагований slug вимагає brand; безлім власних ТОВ/організацій і 11+ клієнтських бізнесів вимагають bookkeeper (фізособа і ФОП завжди по 1 як інваріант реальності). One-off це орендований доступ з датою, не товар. При втраті доступу спрацьовує реконсиляція в дусі ренти: зайві бізнеси блокуються і їхні публічні QR гаснуть, красиві slug-и злітають у 90-денний холд для перепродажу. Логотип у QR і «QR без бренду Finly» свідомо відкладені в Sprint B.

**Status:** заплановано (2026-06-09), не стартував.

---

## [20. Slug upsell flow: відчути цінність до оплати](20-slug-upsell-flow/README.md)

Доробка UX поверх гейтингу slug із Sprint 19, де поле редагування ховалось за сірою нотою «доступно на тарифі» і нічого не продавало. Перевертаємо логіку: поле видиме всім, безкоштовний користувач вводить бажане ім'я, бачить live-доступність, відчуває цінність, а платіжний бар'єр зустрічає лише на Save. Ім'я неплатнику в базу не пишеться і публічно не активується (нічого не ламається), а на 15 хвилин бронюється за ним зі зворотним відліком, щоб не загубилось поки вирішує платити. Намір переноситься через оплату і застосовується на поверненні з білінгу (webhook недоторканий). Race на ім'я прийнятий свідомо в межах короткої броні: перехопили, поки думав, отримує підписку і обирає інше. Скоуп лише slug-потік на трьох сутностях; апсели на лімітах бізнесів дістають лише чіткішу копію.

**Status:** заплановано (2026-06-13), не стартував.

---

## [21. Кастомний брендинг отримувача](21-qr-custom-branding/README.md)

Отримувач на тарифі «Бренд» ставить власний логотип у обидва QR (центр сторінкового, верхня смуга НБУ замість Finly, знак гривні недоторканний) і на публічні pay-сторінки замість дефолтного Finly. Монетизаційний гачок дзеркалить slug-upsell, але без броні й таймера: free вантажить, бачить живе прев'ю, на «Зберегти» зустрічає пейвол, а pending-логотип авто-застосовується після оплати. Завантаження дзеркалить avatar R2 pipeline без кропа; бренд-марка (логотип плюс опційна назва нашим шрифтом) пекеться один раз на commit. Два стани публічно: свій логотип або Finly. Свідомо звужено: без напису-картинки власним шрифтом, без SVG, без пре-модерації, бренд лише на рівні бізнесу. Дві фази: спочатку QR-рендер і завантаження, потім верстка публічних сторінок.

**Status:** заплановано (2026-06-18), не стартував.

---

## [22. Білінг на monobank під керуванням нашого коду](22-self-managed-billing/README.md)

Міняємо провайдера на monobank «Плата» і перевертаємо модель рекурентності. monobank не має власного рекуренту, тож життєвим циклом підписки повністю керує наш код через cron-обхід бази (billing clock) як єдине джерело правди, а monobank дає лише хостований checkout із захопленням токена, разове списання за токеном і запит статусу транзакції. Знімаємо всю машинерію WayForPay Regular Payments. Скоуп звужено до MVP: 2 підписки, 2 one-off, скасування лише в кінці періоду; збій картки веде в dunning зі збереженням доступу на грейс-вікно (близько 7 днів) і відновленням через дію «оплатити зараз». Зрізано зміну тарифу, окрему зміну картки, негайне скасування з поверненням і refund будь-де в коді. Каталог, рівні доступу і реконсиляція зі Sprint 19 не змінюються. Живих підписок немає, тож чистий старт без міграції.

**Status:** переплановано (2026-06-23), не стартував. Блокер дня один: підтвердити в sandbox контракт monobank на захоплення токена при checkout і на списання за токеном (формат суми, увімкнення збереження токена, підпис вебхука).

---

## [23. SEO: технічний фундамент](23-seo-foundation/README.md)

Перший з трьох SEO-спринтів за результатами аудиту: база виявилась зрілою, блокерів нема, лишилися механічні прогалини в технічному фундаменті. Закриваємо їх одним заходом без нового контенту: web app manifest і повний набір іконок, metadataBase, вузли WebSite і offers у JSON-LD графі головної, растровий логотип для structured data, host-aware robots плюс верифікація публічного API-sitemap, title і явний noindex на auth-сторінках, семантичний заголовок у LandingPartner. Самодостатній, не залежить від даних Search Console.

**Status:** заплановано (2026-06-30), не стартував.

---

## [24. SEO: контент-довіра і перелінкування](24-seo-content-trust/README.md)

Другий SEO-спринт: сигнали довіри до контенту (E-E-A-T) плюс місток лендінг-help. Help-статті отримують іменованого автора (Тетяна Прядко, партнер-бухгалтер з лендінгу, засновниця EasyFin) з видимим byline і Person у structured data, а також дати публікації і оновлення для сигналу свіжості. Додаємо FAQ-секцію на лендінг з FAQPage-розміткою, per-article динамічний OG-банер, і контекстне перелінкування з лендінгу в help плюс пункт Довідка у футері. Залежить від растрового логотипа зі Sprint 23.

**Status:** заплановано (2026-06-30), не стартував.

---

## [25. SEO: семантика і контент-кластер](25-seo-semantic-cluster/README.md)

Третій SEO-спринт і єдиний контентно-важкий: топікал-авторитет під інформаційний намір. Сайт ще не в Search Console, тож спринт починається з підключення вебмастерських інструментів і будує семантику на аналізі видачі і наміру, а не на вигаданих обсягах. Інформаційний контент живе окремим розділом гайдів (третій намір, відмінний від support-help і бренд-лендінгу), pillar плюс хвиля cluster-гайдів, кожен під один намір, з перелінкуванням у продукт і help. Обовʼязковий цикл вимірювання: після накопичення даних звірити гіпотези і скоригувати наступну хвилю. Реалістично виконується хвилями.

**Status:** заплановано (2026-06-30), не стартував.

## [26. Епік «Документи з AI-тегуванням»: загальна архітектура](26-documents-architecture/README.md)

Архітектурний документ епіку Phase 2 (не план одного спринту): сховище документів під Business (документ-папка + незмінні файли + канонічна «ідеальна копія»), AI-конвеєр (тип + поля + теги з глобального курованого словника, чанкування, впевненість), пошук трьох рівнів (фільтри, повнотекст, семантика), переворот білінгу на два незалежні всесвіти («Бренд» = пакети бізнесів, «Документи» = кредити top-up-to-cap) із закриттям «Агенції», запрошення власника у спільний бізнес. Містить попередню карту 7 спринтів епіку; рішення зафіксовані у planning-questions.md.

**Status:** архітектура затверджена (2026-07-07); плани окремих спринтів створюються далі по одному.

## [27. Тарифна платформа: два всесвіти, пакети, кредити](27-tariff-platform/README.md)

Перший спринт епіку документів: білінг перевертається начисто (живих підписок немає) на два незалежні всесвіти. «Бренд» продається пакетами бізнесів з конфігурованою знижковою сіткою і підказкою апгрейду; документний всесвіт отримує повну кредитну механіку (баланс, top-up-to-cap, докупівля, закладена рента сховища) за конфіг-прапором до запуску документів. «Агенція» закривається, ліміти кількості бізнесів знімаються, гейтинг slug/логотипа переїжджає з рівня користувача на прикріплення бізнесу до пакета, залишки «виконань» демонтуються.

**Status:** заплановано (2026-07-07), не стартував.

## [28. Адмінка-конструктор гайдів](28-guides-admin/README.md)

Гайди переїжджають з compile-time константи у MongoDB, а в кабінеті зʼявляється перша адмін-поверхня продукту (роль admin, двоє людей): список гайдів і редактор-конструктор блоків (мета-поля, блоки з картинками через R2 presigned upload, FAQ-редактор, превʼю чернетки). Життєвий цикл чернетка/опубліковано, slug блокується після першої публікації, видалення тільки чернеток. Публічні сторінки /guides не змінюють дизайн: міняється джерело даних плюс перегенерація за подією публікації.

**Status:** заплановано (2026-07-15), не стартував.

## [29. Публічні отримувачі: каталог, запити на публічність, податкова персоналізація](29-state-payees/README.md)

Каталог перевірених отримувачів як нова головна pay-хоста: системні записи, які адмін створює руками (податкова, фонди), плюс отримувачі користувачів, схвалені через «Запит на публічність» (вимога красивих slug робить шлях у каталог преміальним через Brand). Поверх системних сторінок податкова персоналізація: платник вводить РНОКПП і період, QR генерується анонімно з готовим призначенням; стартове наповнення ЄСВ і військовий збір по областях.

**Status:** заплановано (2026-07-20), не стартував.

## Примітки до структури

- **Спринт 5 — кандидат на паралельний запуск зі Спринтом 3.** Research-spike не блокує верстку публічної сторінки (валідно живе на universal-fallback), але блокує маркетингову обіцянку "тицяй свій банк".
- **Спринт 1 свідомо великий** — економимо на майбутніх міграціях (ролі, ownerless-бізнеси, тип бізнесу).
- **Що навмисне НЕ окремий спринт:** vanity-slug squatting policy, модерація логотипів, preview-деталі, перемикання 002↔003 per-bank — підпункти у відповідних спринтах.
- **Phase 1.5 (трекінг оплат, delegated managers, KYC) і Phase 2 (документи + AI)** свідомо поза цим деревом.
