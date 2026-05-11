# Sprint 9 — Operational Implementation Plan

> **Призначення:** декомпозиція README.md на 5 окремих епіків, кожен — окремий чат-сесія `/engineer`. Source-of-truth — `README.md` і `planning-questions.md`; цей файл фіксує **порядок виконання**, **gate-критерії** і **state-передачу між чатами**.

## Порядок епіків і залежності

```
9.0 Shared types          (БЛОКЕР №0 — стартує першим, інші чекають)
   └─→ 9.1 Backend        (depends on 9.0 published types)
         └─→ 9.2 Cabinet  (depends on 9.1 endpoints + 9.0 contracts)
         └─→ 9.3 Public   (depends on 9.1 endpoints + 9.0 contracts; парал. з 9.2)
               └─→ 9.4 Docs (finalization після всіх інших)
```

9.2 і 9.3 можна виконувати **паралельно у двох окремих чатах** (різні файли, різні зони відповідальності), але обидва blocked-by 9.1.

## Як стартувати окремий чат

Кожен чат стартує командою `/engineer` з префіксом епіку. У першому повідомленні треба:

1. Дати ID епіку (`9.0`, `9.1`, ...).
2. Дати посилання на цей файл і на `docs/sprints/09-accounts/README.md`.
3. Перерахувати pre-conditions з gate-критеріїв попереднього епіку (нижче).
4. (Для 9.0) — Надати верифіковану таблицю МФО для 11 банків з NBU public registry.

## Передача state між чатами

Після завершення кожного епіку — короткий summary у тілі чату (engineer skill Фаза 5):

- Які файли створено/змінено (file-paths).
- Команди верифікації, що пройшли (`pnpm --filter ... build`, `... test`).
- Свідомо-залишене поза скоупом (якщо є).
- Що користувач має зробити перед стартом наступного епіку (наприклад, `pnpm i` після нових deps).

---

## Епік 9.0 — Shared types (`@finly/types`)

**Чат-промпт-старт:** `/engineer 09-accounts 9.0` + МФО-таблиця.

### Скоуп
- Новий `packages/types/src/entities/account.ts` (`AccountSchema`).
- Новий `packages/types/src/contracts/accounts.ts` (`CreateAccountSchema`, `UpdateAccountSchema`, `PublicAccountListItemSchema`, `PublicAccountViewSchema`, `AccountWithCountsSchema`).
- Новий `packages/types/src/constants/bank-mfo.ts` (`BANK_MFO_MAP`, `bankCodeFromIban`).
- Рефакторинг `entities/business.ts`: видалити `requisites` + `invoiceSlugPresetDefault`, додати top-level `taxId`.
- Рефакторинг `entities/invoice.ts`: додати `accountId`.
- Рефакторинг `contracts/businesses.ts`: видалити `requisites.iban` з 4 variants `CreateBusinessSchema`, flatten `taxId`; видалити `invoiceSlugPresetDefault` з `UpdateBusinessSchema`; переписати `PublicBusinessSchema` (без `nbuLinks`, з `accounts: PublicAccountListItem[]`).
- Рефакторинг `contracts/invoices.ts`: додати `account` у `PublicInvoiceSchema`.
- 6 нових `RESPONSE_CODE`: `ACCOUNT_NOT_FOUND`, `ACCOUNT_HAS_INVOICES`, `ACCOUNT_ACCESS_DENIED`, `ACCOUNT_SLUG_GENERATION_FAILED`, `ACCOUNT_IBAN_DUPLICATE`, `ACCOUNT_CREATE_FAILED`.
- Нові spec-и: `account.spec.ts`, `accounts.spec.ts`, `bank-mfo.spec.ts`. Оновлення існуючих: `business.spec.ts`, `invoice.spec.ts`, `businesses.spec.ts`, `invoices.spec.ts`.

### Pre-conditions
- Верифікована таблиця МФО для 10 банків з NBU public registry (privatbank, monobank, pumb, oschadbank, sense, ukrgazbank, izibank, raiffeisen, abank, credit_dnipro) + 1-2-line-comment джерела і дати перевірки кожного запису. SportBank прибрано з MVP_BANKS: проєкт закрито 06.05.2024 (Таскомбанк припинив розвиток), клієнти переведені у ТАСКОМБАНК; колишній SportBank-IBAN автодетектиться як `izibank` (один МФО 339500 у Таскомбанку на обидва продукти).

### Gate (Definition of Done)
- ✅ `pnpm --filter @finly/types build` зелений.
- ✅ `pnpm --filter @finly/types test` зелений (нові spec-и + regression існуючих).
- ⚠️ Downstream apps (`apps/api`, `apps/web`) НЕ компілюються — це OK, 9.1 catch-up.

---

## Епік 9.1 — Backend (`apps/api`)

**Чат-промпт-старт:** `/engineer 09-accounts 9.1` (після 9.0 merge).

### Скоуп
- Нова `AccountsModule`: schema (`Account`), `AccountsService` (CRUD + cascade-delete), `AccountsController` (cabinet), `PublicAccountsController` (public), `AccountAccessGuard`, `AccountSlugGeneratorService`, `payload-mapper.ts` (`buildPayloadInputFromAccount`).
- Рефакторинг `BusinessesModule`: schema (видалити `requisites`, додати top-level `taxId`), `BusinessesService` (cascade тепер чистить Account + Invoice + InvoiceSlugCounter; `getOwnedAndManagedWithCounts` — нове ім'я з `accountsCount` + `invoicesCount`), `PublicBusinessesController` (повертає `accounts: PublicAccountListItem[]`, QR-endpoints видаляються).
- Рефакторинг `InvoicesModule`: schema (додати `accountId`; нові індекси `(accountId, slug)` unique, `(accountId, scope)` unique для counter, `(accountId, createdAt -1, _id -1)`; **`businessId` лишається** як denormalized), `InvoicesService` (приймає `(business, account, dto)`; touch-account замість touch-business), `InvoicesController` (URL `/businesses/me/:slug/accounts/:accountSlug/invoices`), `PublicInvoicesController` (URL `/businesses/public/:slug/account/:accountSlug/invoices/:invoiceSlug`).
- `InvoiceSlugCounter`: видалити `payload-mapper.ts` Business-version + spec.
- Cascade-tests на `MongoMemoryReplSet`.

### Pre-conditions
- 9.0 merged.
- `pnpm install` пройшов (можливі нові transitive-deps).

### Gate
- ✅ `pnpm --filter api build` зелений.
- ✅ `pnpm --filter api test` зелений (unit + e2e).
- ✅ Cascade-delete-business тест: 2 account × 3 invoices → 0 documents у Account/Invoice/InvoiceSlugCounter collections.
- ✅ Account-delete pre-check тест: invoice-наявність → 409 `ACCOUNT_HAS_INVOICES`.

---

## Епік 9.2 — Frontend cabinet (`apps/web`)

**Чат-промпт-старт:** `/engineer 09-accounts 9.2` (після 9.1; може йти паралельно з 9.3).

### Скоуп
- Вимкнути CTA "Зберегти у кабінет" на лендінгу (`QrLandingResult.tsx`).
- Bump `STORAGE_VERSION 1 → 2` у `qr-landing-draft/store.ts` (defense-in-depth stale claim-intent).
- `/business/[slug]/page.tsx` переписати: 9 секцій → 7 секцій (видалити `InvoicesSection`, `InvoicesSettingsSection`, `QrSection`; додати `AccountsSection`).
- Нові route-сторінки: `/business/[slug]/account/new`, `/business/[slug]/account/[accountSlug]`, `/business/[slug]/account/[accountSlug]/invoice/new`, `/business/[slug]/account/[accountSlug]/invoice/[invoiceSlug]`.
- Видалити старі route-и `/business/[slug]/invoice/new` + `/business/[slug]/invoice/[invoiceSlug]`.
- Нові features: `account-create/`, `account-edit/` (6 секцій + delete-механіка: `pendingAccountDeletesStore`, `scheduleAccountDeleteWithUndo`, `DeleteAccountConfirmDialog`, `AccountsSection`-filter-консумент у `business-edit/`).
- Rekey `pendingInvoiceDeletesStore` на 3-сегментний composite key.
- Видалити `features/invoices/` повністю (компоненти переїжджають у `account-edit/`).
- Рефакторинг `features/business-edit/`: `RequisitesSection` — тільки `taxId` (видалити `iban`); видалити `QrSection.tsx`.
- Рефакторинг `features/business-wizard/`: draft shape (видалити `requisites.iban`, додати top-level `taxId`, видалити `invoiceSlugPresetDefault`); persist version bump `2 → 3` + migration.
- Новий `shared/api/accounts.ts`.

### Pre-conditions
- 9.1 merged.

### Gate
- ✅ `pnpm --filter web build` зелений.
- ✅ `pnpm --filter web test` зелений.
- ✅ Manual UAT smoke (на dev-environment): створити Business → empty-state → додати Account → побачити QR → виставити інвойс.

---

## Епік 9.3 — Frontend public (`apps/web`)

**Чат-промпт-старт:** `/engineer 09-accounts 9.3` (після 9.1; парал. з 9.2).

### Скоуп
- `apps/web/src/middleware.ts`: Branch A2 семантичний flip (invoice-URL → account-URL); новий Branch A3 для 3-сегментного path; Branch A1 додає `Cache-Control: no-store, no-cache, must-revalidate` (defense-in-depth для 307-redirect).
- Server Components: `host-pay/[slug]/page.tsx` (0/1/2+ accounts branching: empty / 307 redirect / list); новий `host-pay/[slug]/[accountSlug]/page.tsx`; перенесення `host-pay/[slug]/[invoiceSlug]/page.tsx` → `host-pay/[slug]/[accountSlug]/[invoiceSlug]/page.tsx`.
- Рефакторинг `features/business-public/PublicBusinessView`: був full-payment view → стає cards-list-view (2+ Account) + empty-state (0).
- Нова `features/account-public/PublicAccountView`: повний payment view (як був Sprint 3 PublicBusinessView, але reads з `PublicAccountSchema`).
- Рефакторинг `features/invoice-public/InvoicePublicView`: heading включає "{account.name}" як sub-info.

### Pre-conditions
- 9.1 merged.

### Gate
- ✅ `pnpm --filter web build` зелений.
- ✅ `pnpm --filter web test` зелений.
- ✅ Middleware spec-и проходять для всіх 3 branches (A1, A2, A3).
- ✅ Server Component spec-и на 0/1/2+ account branching.

---

## Епік 9.4 — Cross-cutting docs

**Чат-промпт-старт:** `/engineer 09-accounts 9.4` (фінальний; після всіх інших).

### Скоуп
- `CLAUDE.md`: Domain Model (нова `Account`-сутність; рефакторинг `Business` + `Invoice`); Module Dependency Map; API Overview; Known Complexities (7 нових пунктів).
- `docs/product/business-flow.md`: §3-§5 — 3-рівнева ієрархія `Business → Account → Invoice`.
- `docs/product/qr-decisions.md`: §1.14 closure-маркер + §1.3 оновлення ієрархії.
- `docs/product/tech-backlog.md`: ticket "Account.providerLink for Phase 1.5 Mono Acquiring API".
- `docs/manual-checks/README.md`: ACC-1..ACC-7 UAT-пункти.
- Root `README.md`: "Sprint 9 deploy-prep" секція з `dropDatabase` instruction.

### Pre-conditions
- 9.0, 9.1, 9.2, 9.3 merged.

### Gate
- ✅ Усі doc-файли оновлені під реальний стан коду.
- ✅ `docs/manual-checks/README.md` має ACC-1..ACC-7.
- ✅ Smoke-test усього sprint flow на staging (per Sprint 9 README §Definition of Done).

---

## Cross-epic risks (зведення з README §Risks)

| Risk | Епік де лікується |
|------|---------------------|
| Точний реєстр МФО (Risk #1) | 9.0 (pre-condition: користувач надає таблицю) |
| Middleware Branch A2 семантичний flip (Risk #2) | 9.3 (test-coverage + dropDatabase на dev) |
| InvoiceSlugCounter cascade orphan (Risk #3) | 9.1 (явні test-кейси для обох cascade-flow) |
| Public-API breaking change (Risk #4) | 9.0 + 9.1 (PublicBusinessSchema переписано) |
| `CreateBusinessSchema` discriminated union (Risk #5) | 9.0 (positive/negative тести на 4 type-variants) |
| `payeeSnapshot.iban` legacy fallback (Risk #6) | 9.1 (production-data немає; на dev — dropDatabase) |
| UX-плутанина 1-рахунок-ФОП (Risk #7) | 9.2 (counter "{N} рахунків" на бізнес-картці) |
| `bankCodeFromIban` edge-cases (Risk #8) | 9.0 (edge-tests на короткий рядок → null) |
| Лендінг без CTA між 9 і 10 (Risk #9) | 9.2 (CTA вимкнено + STORAGE_VERSION bump) |
| Stale `intent='claim-pending'` (Risk #11) | 9.2 (STORAGE_VERSION bump + migration reset) |

Orphan-Business cleanup (Risk #10) — Sprint 12, поза Sprint 9.
