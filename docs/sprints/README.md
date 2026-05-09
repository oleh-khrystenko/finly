# Finly — План спринтів MVP (Phase 1)

> Короткий tree-overview спринтів MVP. Кожен спринт планується далі окремим документом у цій папці.
>
> **Статус:** оновлено 2026-05-05. Sprint 1, 2 закриті; Sprint 3 — функціональний flow закритий, **залишається 1 deliverable + UAT-прогон**; **Sprint 4 — функціональний flow закритий, залишається UAT-прогон INV-1..7**; Sprint 5–7 — заплановані.

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

---

## Примітки до структури

- **Спринт 5 — кандидат на паралельний запуск зі Спринтом 3.** Research-spike не блокує верстку публічної сторінки (валідно живе на universal-fallback), але блокує маркетингову обіцянку "тицяй свій банк".
- **Спринт 1 свідомо великий** — економимо на майбутніх міграціях (ролі, ownerless-бізнеси, тип бізнесу).
- **Що навмисне НЕ окремий спринт:** vanity-slug squatting policy, модерація логотипів, preview-деталі, перемикання 002↔003 per-bank — підпункти у відповідних спринтах.
- **Phase 1.5 (трекінг оплат, delegated managers, KYC) і Phase 2 (документи + AI)** свідомо поза цим деревом.
