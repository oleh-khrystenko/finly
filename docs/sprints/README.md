# Finly — План спринтів MVP (Phase 1)

> Короткий tree-overview спринтів MVP. Кожен спринт планується далі окремим документом у цій папці.
>
> **Статус:** оновлено 2026-05-11. Sprint 1, 2 закриті; Sprint 3 — функціональний flow закритий, **залишається 1 deliverable + UAT-прогон**; **Sprint 4 — функціональний flow закритий, залишається UAT-прогон INV-1..7**; **Sprint 7 — функціональний flow закритий, UAT pending**; **Sprint 8 — функціональний flow закритий, UAT pending LAND-1..8** (раніше згаданий 8.5 follow-up CTA superseded by Sprint 10 SP-7); Sprint 5 — research-spike заплановано (паралельно з закриттям). **Sprint 9 розщеплено 2026-05-11 на 4 окремі спринти (9, 10, 11, 12)** через надмірний обсяг оригінального плану — деталі у відповідних README.

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

## 5. Per-bank deep links (research-driven)

- [ ] Research-spike по 11 банках (iOS+Android, payload, fallback)
- [ ] Імплементація per-bank кнопок + policy для непокритих банків

## 6. Монетизація + лонч

- [ ] Free vs Paid гейти (ліміт бізнесів)
- [ ] Paid-фічі (vanity slug, custom logo у QR)
- [ ] Preview-режим у кабінеті + onboarding (2 landing)

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

**Status:** заплановано (2026-05-11), не стартував. Передумови — Sprint 1, 3, 4, 7, 8 функціонально закриті.

## [10. Anon-claim refactor під Business + Account модель](10-anon-claim-refactor/README.md)

Sprint 9 schema-change ламає Sprint 8 anon-claim flow на backend-рівні (чинний body `{ requisites.iban }` reject-ається). Sprint 10 повертає CTA "Зберегти у кабінет" з новою архітектурою: 2 sequential POST (Business → Account) з granular state-machine + form-recovery patern на failure; magic-link через Redis-draft sub-поле для cross-device flow з KEEPTTL-overwrite на anti-spam dedup-hit; idempotency-key захист від duplicate-Business на retry-after-tab-close через partial-unique-index; terms-pre-stamp на backend (закриває acceptTerms ordering window). Новий `LandingClaimModule` як separation of concerns від `AuthService`. Verify-page-handler resolve-ить `claimState`-discriminator (success / business-failed / account-failed) і робить router.replace на канонічний target.

**Status:** заплановано (2026-05-11), не стартував. Передумова — Sprint 9 функціонально закритий.

## [11. Deep-link UX-recovery після abandoned magic-link claim](11-deep-link-recovery/README.md)

Phone-юзер відкрив magic-link → backend створив Business+Account і виставив session-credentials, але юзер закрив таб ДО `router.replace` claim-target-у (network drop, accident). Без mitigation на наступному cold-login (день/тиждень пізніше) юзер потрапляє на дефолтний cabinet-root і втрачає inструкцію "Перевірте список банків" (banner `?completed-from=landing` не показується). Sprint 11 додає `User.pendingPostLoginTarget`-stamp на success-claim (LandingClaimService extension); same-device flow clear-ить через verify-page-handler; cold-login flow resume-ить через AuthInitializer. Двошарова open-redirect-protection через shared `validateSameOriginPath`-helper.

**Status:** заплановано (2026-05-11), не стартував. Передумова — Sprint 10 функціонально закритий.

## [12. Orphan-Business cleanup: email-pipeline + cron-deletion](12-orphan-cleanup/README.md)

Phone-юзер міг закрити таб і так не дозаповнити firstName/lastName — orphan-Business+Account накопичуються у БД. Sprint 12 додає cron-сервіс з 3-stage email-pipeline (1-й день: soft-reminder; 6-й день: final-warning; 7-й день: cascade-delete). Prereq-guards гарантують cron-downtime resilience: навіть на multi-day-downtime юзер отримує обидва листи перед deletion. Stamping через `User.profileCompletionReminders`-sub-doc; claim-first-pattern race-protection проти double-fire-paralleled-crons. Email templates на classic-polite tone, multi-business pluralization. Cross-field env-invariant `first < final < deletion`.

**Status:** заплановано (2026-05-11), не стартував. Передумови — Sprint 9, 10, 11 функціонально закриті.

## [13. Dependency Inversion](13-dependency-inversion/README.md)

Розв'язуємо дві реальні петлі модульних залежностей (`AuthModule` ↔ `LandingClaimModule` ↔ `UsersModule` і `StorageModule` ↔ `UsersModule` ↔ `AuthModule`) інверсією на рівні класів, а не косметичним `forwardRef`. `AuthService` стає механічним (validate token, find/create user, generate tokens), terms-stamp і landing-claim переїздять у оркестрацію `AuthController`. `StorageService` стає pure file-ops, новий `AvatarService` всередині `UsersModule` володіє оркестрацією аватарки. `LandingClaimResult` виноситься у `packages/types` як shared Zod discriminated union; контракт `POST /auth/magic-link/verify` отримує вкладений `claim` замість плоских claim-полів (breaking change у API-shape, mono-repo міграція атомарно). Першим коміттом закомічується tactical unblocker для docker dev (`forwardRef` у StorageModule), останнім — видаляється разом з імпортом UsersModule.

**Status:** заплановано (2026-05-15), не стартував. Передумова — Sprint 8 функціонально закритий (петлі утворились саме там).

## [14. QR-брендинг](14-qr-branding/README.md)

Робимо два типи QR візуально різними і перетворюємо QR на брендований носій для друку. Зараз обидва типи виходять однаковими, а URL-QR (тип-2) узагалі не показується в UI. НБУ-QR (тип-1) лишається строго нормативним (центр зі знаком гривні недоторканний) і отримує підпис "за стандартами НБУ"; URL-QR отримує Finly-брендинг у центрі і слоган. Колір обох лишається чорно-білим, розрізнення несуть центр і рамки навколо коду. Тип-2 виводиться у видимий UI на всіх трьох рівнях (бізнес, рахунок, інвойс) з новим endpoint на рівні бізнесу. Додається завантаження для друку через параметр розміру на тому самому endpoint. Каркас рендеру параметризований під майбутній клієнтський брендинг (шар C, монетизація) без його реалізації.

**Status:** заплановано (2026-05-30), не стартував.

## [15. Редаговувані nested-slug-и](15-editable-nested-slugs/README.md)

Account і Invoice отримують редаговуваний красивий slug, як у Business. Знімаємо immutability, переходимо на case-insensitive унікальність у межах батька (бізнес для рахунку, рахунок для інвойсу) і дзеркалимо Sprint 14: окремі history-collection, public lookup з history-fallback, постійний redirect на канонічний URL і anti-squatting на grace-вікно, щоб надруковані QR і збережені посилання на старий slug не ламались. Редагування доступне власнику і менеджерам; flow створення не змінюється; пресет-нумерація інвойсу при rename лишається недоторканою.

**Status:** заплановано (2026-06-03), не стартував.

## [16. Публічна довідка + заземлений AI-чат](16-public-help-docs/README.md)

Публічна сторінка довідки `finly.com.ua/help` для ФОП і бухгалтерів: багаторозділовий help-center з окремими статтями за власними URL. Поверх статичних статей живе публічний AI-чат, заземлений на той самий контент. Архітектурний стрижень, один набір markdown-статей у репозиторії як єдине джерело правди: Web рендерить їх у SEO-сторінки, API згодовує той самий текст AI як базу знань, тому документація не дрейфує від продукту. AI скоупиться строго на "як користуватись Finly" і відмовляє у податкових/юридичних/off-topic питаннях. Гаманець захищений двошарово (per-IP ліміт для аноніма + глобальний денний бюджет-circuit-breaker); статична довідка ніколи не залежить від доступності AI. Anon-чат ефемерний, нічого не пише в БД. Переюз існуючого SSE-стріму і чат-UI з кабінету.

**Status:** заплановано (2026-06-05), не стартував.

---

## Примітки до структури

- **Спринт 5 — кандидат на паралельний запуск зі Спринтом 3.** Research-spike не блокує верстку публічної сторінки (валідно живе на universal-fallback), але блокує маркетингову обіцянку "тицяй свій банк".
- **Спринт 1 свідомо великий** — економимо на майбутніх міграціях (ролі, ownerless-бізнеси, тип бізнесу).
- **Що навмисне НЕ окремий спринт:** vanity-slug squatting policy, модерація логотипів, preview-деталі, перемикання 002↔003 per-bank — підпункти у відповідних спринтах.
- **Phase 1.5 (трекінг оплат, delegated managers, KYC) і Phase 2 (документи + AI)** свідомо поза цим деревом.
