# Sprint 9 — Banking Accounts: розщеплення Business на Business + Account

> **Статус (на 2026-05-11):** заплановано, не стартував.
> **Передумови:** Sprint 1 (схеми Business / Invoice + slug-генератор baseline), Sprint 3 (cabinet flow `/business/[slug]`, `BusinessAccessGuard`, `SlugGeneratorService`, host-aware middleware-rewrite, `PublicBusinessesController`, `EditableField`, `scheduleDeleteWithUndo`, 5s Undo patern), Sprint 4 (інвойсний flow, `InvoiceSlugGeneratorService`, partial-unique counter-index, `payeeSnapshot`, cascade-delete через `withTransaction`, host-aware Branch A2 для 2-сегментного path, replica-set requirement), Sprint 7 (`BUSINESS_TYPES = 4 значення`, `payerTaxIdZod` union, `Business.type` immutable post-creation, type-aware coupled refines), Sprint 8 (anon QR-preview лендінг + claim-flow з Zustand-persist + `useClaimLandingDraft` hook). Усі — функціонально закриті.
> **Що розблокує:** маркетинговий нарратив "ФОП з 2 рахунками не зобовʼязаний дублювати юр-особу", Sprint 5 per-bank deep-links (працює над тим самим payload, тільки IBAN тепер з Account, не Business), Phase 1.5 трекінг оплат (Account як точка інтеграції з Mono Acquiring / Privat API; Sprint 9 НЕ закладає placeholder-поле, але архітектура природно дозволяє додати без ремайнінгу).
> **Що НЕ розблокує (винесено в окремі спринти 2026-05-11):**
> - **Sprint 8 anon-claim flow рефакторинг** (2 sequential POST, magic-link через Redis-draft, idempotency-key, terms-pre-stamp, LandingClaimModule, verify-page claim-state-machine) — окремий [Sprint 10](../10-anon-claim-refactor/README.md). Sprint 9 тимчасово вимикає CTA "Зберегти у кабінет" на лендінгу (deliverable у §Скоуп.Frontend); Sprint 10 повертає її з новою архітектурою.
> - **Deep-link UX-recovery після abandoned claim** (`User.pendingPostLoginTarget` stamp+consume) — [Sprint 11](../11-deep-link-recovery/README.md).
> - **Orphan-Business cleanup-cron + 3-stage email-pipeline** — [Sprint 12](../12-orphan-cleanup/README.md).
> 
> **Контекст рішень:** усі продуктові розв'язки — у [`planning-questions.md`](planning-questions.md) (A1–A8). README не дублює rationale — лише імплементаційну механіку.
> **Production-data:** ще немає. План навмисно не пише міграційний script — `dropDatabase` + чистий старт.

---

## Мета

Виправити доменне забруднення моделі: зараз сутність `Business` плутає **юр-особу** (тип, ІПН, оподаткування) і **банківський рахунок** (IBAN). ФОП з двома рахунками (Privat + Mono) у поточній моделі мусить створювати "два бізнеси" з ідентичним ІПН і назвою — це некоректно семантично, плутає public-вивіску ("який з двох цей сканований QR?"), ламає cabinet-навігацію (списки бізнесів засмічені), і блокує природний use-case "ФОП веде через основний рахунок, на резервний приймає рідко".

Розщеплюємо на 3 сутності:

- **Business** — юр-особа: type, name, taxId, taxationSystem, isVatPayer, paymentPurposeTemplate, acceptedBanks, slug, ownership.
- **Account** — банківський рахунок під бізнесом: iban, name (auto-default з банку), slug. IBAN immutable. Рахунок належить рівно одному банку (resolved автоматично з МФО).
- **Invoice** — одноразова платіжка під рахунком: businessId + **accountId** (новий) + amount/lockMask/validUntil/purpose/slug.

Public URL стає матрьошковим:
- `pay.finly.com.ua/{businessSlug}` — корінь: список Account (2+) / 307-redirect на per-account (1) / empty-state (0).
- `pay.finly.com.ua/{businessSlug}/{accountSlug}` — per-account вивіска (поточна Sprint 3 функціональність — 11 банків, 2 NBU кнопки, 2 QR — переїжджає сюди з кореня).
- `pay.finly.com.ua/{businessSlug}/{accountSlug}/{invoiceSlug}` — інвойс (Sprint 4 функціональність + новий accountSlug сегмент).

Cabinet — симетрична матрьошка: `/business/[slug]` → `/business/[slug]/account/[accountSlug]` → `/business/[slug]/account/[accountSlug]/invoice/[invoiceSlug]`.

---

## Скоуп

### Backend (`apps/api`)

- 🔲 Нова `AccountsModule`: `Account`-схема, `AccountsService` (CRUD), `AccountsController` (cabinet) + `PublicAccountsController` (public), `AccountAccessGuard` (тонкий, читає вже attach-нутий `request.business`, додатково лукапить account за `accountSlug` + перевіряє `account.businessId === business._id`), DTO. `name` поле required у БД, але optional на write — backend auto-generate з МФО+last4 якщо клієнт не передав.
- 🔲 `BusinessSchema` рефакторинг: видалити `requisites: { iban, taxId }` → `iban` переїжджає на Account, `taxId` лишається на Business як top-level поле (зі Sprint 7 type-aware валідатором). Видалити `invoiceSlugPresetDefault` з Business (переїжджає на Account; нумерація інвойсів per-account, A7). **Семантика поля на Account ідентична попередній на Business**: `SlugPreset | null` (default `null` = "не визначено"); форма створення інвойсу fallback-ить на global system default `'simple'` коли `account.invoiceSlugPresetDefault === null`. Жодних змін у nullability чи fallback-ланцюжку — лише переміщення власника поля.
- 🔲 `InvoiceSchema` рефакторинг: додати `accountId: ObjectId` (required). **`businessId` лишається** як denormalized field (set on insert з `account.businessId`, immutable після — Invoice.accountId immutable, Account.businessId immutable, отже Invoice.businessId структурно invariant). Тримаємо для прямого `Invoice.deleteMany({businessId})` у cascade-delete-business-flow і прямих аналітичних запитів "сума інвойсів по бізнесу" без додаткового `$lookup` через accounts. Видалити compound-unique `(businessId, slug)` → новий `(accountId, slug)`. Перебудувати partial-unique counter-index `(accountId, slugCounterScope, slugCounter)`. Index `(businessId, createdAt -1)` лишається для cabinet-аналітики (буде використаний у `getOwnedAndManagedWithCounts` без зайвого `$lookup`). `payeeSnapshot.iban` тепер береться з Account на момент create (recipientName/taxId — далі з Business).
- 🔲 `BusinessesService` рефакторинг: видалити `requisites`-related update-логіку. `update` лишається з coupled VAT-check, taxId-format-check (Sprint 7 patтерн), без `iban`. `delete` cascade-flow розширюється: `withTransaction` тепер видаляє `Account.deleteMany({businessId})` + `Invoice.deleteMany({businessId})` (прямий filter завдяки denormalized `Invoice.businessId`) + `InvoiceSlugCounter.deleteMany({businessId})` + `Business.deleteOne` атомарно. Counter-doc-структура переезжає на per-account namespace (наступний пункт), але cascade-business-delete мусить почистити їх через filter `{businessId}` теж (counter-doc мусить мати denormalized `businessId` — точно як Invoice — для прямого cascade без `$lookup` accounts).
- 🔲 `InvoiceSlugCounter` (counter-doc collection, Sprint 4 §4.1): unique key міняється з `(businessId, slugCounterScope)` на `(accountId, slugCounterScope)`. Якщо counter-doc структура у поточному коді базується на `_id`-pattern — переробити. Cascade-delete account → видалити counter-doc-и того account (нова операція; раніше тільки business cascade чистив).
- 🔲 `InvoicesService.create` рефакторинг: `business` параметр доповнюється `account` параметром (resolved через `AccountAccessGuard`); slug-generator приймає `accountId` замість `businessId`; payeeSnapshot.iban з `account.iban`; touch-business у транзакції тепер touch-account (захист від cascade-delete account, симетрично Sprint 4 review fix). Ремайнінг RESPONSE_CODE-кодів: `BUSINESS_NOT_FOUND` у create-flow стає `ACCOUNT_NOT_FOUND` (Account зник між guard і insert — більш точна помилка).
- 🔲 `InvoicesService.delete` без структурних змін (вже працює через `slug`-lookup), але filter міняється з `{businessId}` на `{accountId}`.
- 🔲 `BusinessesService.delete` валідаційний preflight для cascade-warning: `affectedAccounts` + `affectedInvoices` обидва counter-и у response (frontend toast "Видалено бізнес, N рахунків і M інвойсів"). Атомарність — withTransaction (без змін від Sprint 4 §SP-5 механіки).
- 🔲 `AccountsService.delete` — guard-rule: `Invoice.countDocuments({accountId}) > 0` → `409 ACCOUNT_HAS_INVOICES` з UA-message (template і pluralization-pre-resolve — §Скоуп.Shared §RESPONSE_CODE, single source of truth). Не cascade на Invoice — точкова операція з explicit-консервативністю (A5). **Атомарно у `session.withTransaction`**: countDocuments + `Account.deleteOne` + `InvoiceSlugCounter.deleteMany({accountId})` — race-protection проти concurrent `InvoicesService.create` (touch-account pattern, симетрично до Sprint 4 review fix). Деталі — §9.1 + §SP-3.
- 🔲 `PublicBusinessesController` рефакторинг: `getPublic` повертає **list of accounts** (whitelist `{slug, name, bankCode, ibanMask}` — 4 поля, узгоджено з `PublicAccountListItemSchema` у §Скоуп.Shared / §9.1; `ibanMask` як derivative `"•{last4}"` для disambiguation двох рахунків одного банку), не `nbuLinks` напряму. QR-endpoints (`/qr/business.png`, `/qr/nbu.png`) **видаляються з business-controller-а** — переїжджають на `PublicAccountsController` (бо QR тепер per-account, не per-business).
- 🔲 Новий `PublicAccountsController`: `GET /businesses/public/:slug/account/:accountSlug` (whitelist з business-context: `{slug, name, bankCode, ibanMask, business: {type, name, slug, acceptedBanks, seoIndexEnabled}, nbuLinks: {primary, legacy}}`; **`ibanMask` обовʼязковий** як derivative `"•{last4}"` — server-derived disambiguator, що тримає invariant §SP-9 point 4 rename-resilience: на null-bankCode heading рендерить `(•{last4})` parenthetical, для якого client потребує last4 окремо від bankCode; на non-null bankCode heading рендерить `({BANK_LABEL[bankCode]} •{last4})`. Whitelist збігається з `PublicAccountViewSchema` у §9.0); `GET .../qr/business.png` (QR на public URL `pay.finly.com.ua/{businessSlug}/{accountSlug}`); `GET .../qr/nbu.png?host=primary|legacy` (QR на NBU-payload-link).
- 🔲 `PublicInvoicesController` URL зміна: `GET /businesses/public/:slug/invoices/:invoiceSlug` → `GET /businesses/public/:slug/account/:accountSlug/invoices/:invoiceSlug`. `PublicInvoiceSchema` whitelist розширюється на `account: {slug, name, bankCode, ibanMask}` поряд з `business` (клієнт бачить, через який рахунок іде платіж + 4-цифровий IBAN-tail для disambiguation). `payload-mapper` `buildPayloadInputFromInvoice` приймає `(business, account, invoice)` замість `(business, invoice)`.
- 🔲 **Payload-mapper-и для QR**: новий `apps/api/src/modules/accounts/payload-mapper.ts` з `buildPayloadInputFromAccount(business, account)` для account-level "вивіска без суми" (consumed `PublicAccountsController` QR-endpoints). Старий `apps/api/src/modules/businesses/payload-mapper.ts` (`buildPayloadInputFromBusiness`) + його spec **видаляються**: єдиний callsite був на видалених QR-endpoints `PublicBusinessesController`. Деталі signature і source-mapping — у §9.1.
- 🔲 Новий `BANK_MFO_MAP` у `@finly/types/constants/bank-mfo.ts`: `Record<string, BankCode>` для 11 банків. UA IBAN формат `UA<2-cd><6-digit-MFO><19-digit-account>`; helper `bankCodeFromIban(iban: string): BankCode | null`. Точні МФО (ПриватБанк 305299, monobank-via-Universal 322001, etc.) — verify при імплементації (NBU public registry). На `null` (нерозпізнаний банк, наприклад дрібний регіональний) — auto-name fallback "Банк •last4" замість "{BANK_LABEL[code]} •last4".
- 🔲 `validation/iban.ts` уже існує (Sprint 1 IBAN-checksum) — без змін; новий helper `bankCodeFromIban` живе в окремому файлі.
- 🔲 `BusinessAccessGuard` без змін (резолв за `slugLower` працює як раніше; account-resolution — окремий `AccountAccessGuard`).
- 🔲 `InvoiceAccessGuard` рефакторинг: лукап `Invoice.findOne({accountId, slug})` замість `{businessId, slug}` (compound-unique-index міняється). Передумова — `AccountAccessGuard` уже attach-нув `request.account`; це означає, що InvoiceAccessGuard на route-level живе в guard-ланцюжку **після** AccountAccessGuard. На InvoicesController цей ланцюжок задається класовими guard-ами (`@UseGuards(JwtActiveGuard, BusinessAccessGuard, AccountAccessGuard)` на класі) + route-level InvoiceAccessGuard на конкретних методах.

### Frontend (`apps/web`)

- 🔲 **Вимкнути CTA "Зберегти у кабінет" на лендінгу** (timing: при імплементації Sprint 9, у тому ж патчі що ламає `requisites.iban`-shape backend-side). У `features/qr-landing-preview/QrLandingResult.tsx` приховати або повністю видалити button-element CTA. **Rationale**: чинний Sprint 8 `useClaimLandingDraft` робить `POST /businesses/me` з body, що містить `requisites.iban` через `claimLandingDraftAsBusiness`-helper; після Sprint 9 schema-change цей body backend reject-не на 400 (`requisites` як wrapper більше не існує). Якщо CTA лишити, click на нього перерве UX-flow на error-toast без можливості recover-у. **Sprint 10 повертає CTA з новою архітектурою** (2 sequential POST + form-recovery patern). До Sprint 10 deploy лендінг показує тільки preview-QR без claim-action — це degradation, що абсорбується відсутністю production traffic (вступний контракт `Production-data ще немає`). У cabinet-flow жодних змін; logged-in users створюють бізнес через wizard як зараз. **Helper-functions `claimLandingDraftAsBusiness` НЕ видалений у Sprint 9** — він лишається orphan-callable на час між Sprint 9 і Sprint 10. Sprint 10 §Скоуп.Frontend його видаляє і замінює на дві окремі `createBusinessFromDraft` + `createAccountFromDraft`-функції.
- 🔲 **Bump `STORAGE_VERSION = 1 → 2` у `apps/web/src/entities/qr-landing-draft/store.ts`** (defense-in-depth для stale-intent у браузерах QA/dev-сесій з до-Sprint-9 версії). **Сценарій**: до Sprint 9 deploy QA-користувач натиснув CTA → `intent='claim-pending'` + `formData` (стара shape `requisites.iban`-сумісна) закешовано у localStorage. Sprint 9 deploy → QA логіниться у cabinet → `useClaimLandingDraft` (sibling до AuthGuard у `(protected)/layout.tsx`, лишається активним у Sprint 9) детектить `intent === 'claim-pending'` → fires `claimLandingDraftAsBusiness` → backend `.strict()` reject-не з 400 → застрягне у `claim-failed`. Bump version використовує існуючий `migrate`-handler у `store.ts` (граculь degrade на unknown version → reset на `INITIAL_STATE`); кодом — 1 рядок constant-replace. Sprint 10 при поверненні CTA з новою архітектурою bump-не version ще раз (`2 → 3`) разом з shape-міграцією формData. **Альтернатива no-op-ити hook відкинута**: Sprint 10 і так його повертає, лишній comment-out + uncomment створює зайву рябизну у diff.
- 🔲 **`/business/[slug]/page.tsx`** переписується. Було: 9 секцій (Sprint 4 §SP-4): BasicSection, RequisitesSection, TaxationSection, BanksSection, PublicSection, QrSection, InvoicesSettingsSection, InvoicesSection, DangerSection. Стає: 7 секцій. Видаляються 3:
    - **InvoicesSettingsSection** — preset-default переїжджає на Account (per-account нумерація, §SP-6).
    - **InvoicesSection** — інвойс-список переїжджає на Account (матрьошка §SP-5).
    - **QrSection** — QR-endpoints видаляються з business-controller-а (Скоуп.Backend, рядок про `PublicBusinessesController` рефакторинг). На business-рівні немає більше джерела даних для QR, бо payload потребує IBAN, який тепер живе на Account. QR живе на per-account-сторінці.
  
  Додається 1 нова: **AccountsSection** (картки-Account: name + bank label + IBAN-mask + per-card "Видалити" button + CTA "Додати рахунок"; bank-label-row рендериться лише для `bankCode !== null` — null-fallback rule §SP-9). Cards-list filter-ить через `usePendingAccountDeletesStore.keys.has(makeAccountKey(businessSlug, account.slug))` — optimistic-removal patern, симетрично Sprint 3 `/business/page.tsx` filter-у через `usePendingDeletesStore`. Per-card "Видалити" button-логіка симетрично DangerSection account-page §6: pre-check `invoicesCount > 0` → `toast.error(getApiMessage('ACCOUNT_HAS_INVOICES', 'accounts', { count }))` без timer на `> 0` → `scheduleAccountDeleteWithUndo(...)` на `=== 0`. **Per-card delete не редіректить** (на відміну від DangerSection account-page §6, що redirect-ить з per-account-page на business-cabinet) — list уже на тій самій сторінці; `pendingAccountDeletesStore.add` автоматично ховає картку синхронно, undo-cancel автоматично повертає через store-remove.
  
  Підсумок: 9 - 3 + 1 = 7 секцій (BasicSection, RequisitesSection, TaxationSection, BanksSection, PublicSection, AccountsSection, DangerSection). Жодних згадок про інвойси на цьому рівні (A6 матрьошка).
- 🔲 Нова сторінка **`/business/[slug]/account/new/page.tsx`** — single-form: одне поле `iban` + (optional) `name`. На submit — POST `/businesses/me/{slug}/accounts`. Backend auto-generate `name` з МФО якщо не передано. Redirect на `/business/{slug}/account/{accountSlug}`.
- 🔲 Нова сторінка **`/business/[slug]/account/[accountSlug]/page.tsx`** — кабінет рахунку. Структура: **6 секцій**:
    1. Основне (name inline-edit; bank label readonly з МФО — рендериться лише для `bankCode !== null` per null-fallback rule §SP-9).
    2. IBAN (readonly, immutable; copy-кнопка).
    3. Налаштування інвойсів (`invoiceSlugPresetDefault` dropdown — переїхало з business; SP-1 5 опцій).
    4. Інвойси (paginated list + CTA "Виставити рахунок"; копія Sprint 4 §4.4 patтерну, тільки фільтр за `accountId`).
    5. QR-секція (рівно **2 QR** — NBU primary + NBU legacy, симетрично Sprint 3 `PublicBusinessView` і §9.3 `<PublicAccountView>`-render). Cabinet mirror-ить public 1:1, щоб ФОП бачив той самий image-set, що і його клієнт. **`qr/business.png`-endpoint (третій backend-endpoint, що рендерить QR на public-URL рахунку — symmetric перенесення Sprint 3 `business.png`-endpoint з business-rooting на account-routing) у cabinet НЕ використовується** — він orphan на frontend ще зі Sprint 3 (PublicBusinessView рендерить лише два NBU QR, `business.png` зарезервований для майбутніх use-case-ів типу друку / окремого скачування і не входить у visible UI). Sprint 9 цю semantics зберігає без змін.
    6. Небезпечна зона (`DangerSection` з `features/account-edit/`). Render delete-button → click відкриває `<DeleteAccountConfirmDialog>` (overlay-based-modal, copy Sprint 3 `DeleteBusinessConfirmDialog` patern, без 5s-undo всередині). User confirm → frontend pre-check `invoicesCount > 0` (з вже-fetched `getAccountBySlug`-response shape `AccountWithCounts`, §9.0 deliverable + §9.1 `getBySlug` deliverable). На `> 0` → `toast.error(getApiMessage('ACCOUNT_HAS_INVOICES', 'accounts', { count: invoicesCount }))` **без 5s-timer і без actual delete-call-у** (defense-in-depth: якщо frontend-pre-check помилково пропустить, backend `AccountsService.delete` теж кине 409 `ACCOUNT_HAS_INVOICES`). На `=== 0` → `scheduleAccountDeleteWithUndo(...)` (новий helper у `features/account-edit/`). Optimistic redirect-target — business-cabinet (`/business/{businessSlug}`), де `AccountsSection` через `usePendingAccountDeletesStore.has(...)` приховує видалену картку синхронно. Undo-cancel target — назад на per-account-page.
- 🔲 Нова сторінка **`/business/[slug]/account/[accountSlug]/invoice/new/page.tsx`** — копія поточної `/business/[slug]/invoice/new` (Sprint 4 §4.5), просто переїхала глибше у структуру. Жодних структурних змін форми; backend route переходить з `POST /businesses/me/:slug/invoices` на `POST /businesses/me/:slug/accounts/:accountSlug/invoices`.
- 🔲 Нова сторінка **`/business/[slug]/account/[accountSlug]/invoice/[invoiceSlug]/page.tsx`** — копія Sprint 4 §4.6 кабінет-інвойсу, з додатковою breadcrumb "Бізнес → Account → Invoice".
- 🔲 Видалити старі route-и `/business/[slug]/invoice/new` і `/business/[slug]/invoice/[invoiceSlug]` — вони більше не існують.
- 🔲 **`features/account-create/`** — нова feature: `AccountCreateForm`, RHF + Zod-resolver, single-field IBAN, live-validation `ibanZod`, optional name-input ("за замовчуванням буде підтягнуто з банку").
- 🔲 **`features/account-edit/`** — нова feature. **Section-компоненти**: `BasicSection` (name inline-edit), `IbanSection` (readonly + copy), `InvoiceSettingsSection` (preset dropdown — копія Sprint 4 `InvoicesSettingsSection` з `features/invoices/`, тільки business→account), `InvoicesSection` (paginated list — копія Sprint 4 з `features/invoices/`, тільки `getByAccountId`), **`QrSection` (рівно 2 QR — NBU primary + NBU legacy, symmetric Sprint 3 PublicBusinessView; mirror-ить public-page §9.3 1:1)**, `DangerSection` (render delete-button + render `<DeleteAccountConfirmDialog>`-modal; pre-check логіка — у §9.2 account-page §6 bullet), `DeleteAccountConfirmDialog` (copy Sprint 3 `DeleteBusinessConfirmDialog` patern, без 5s-undo всередині — confirm-modal лише підтверджує намір; 5s-Undo живе у `scheduleAccountDeleteWithUndo`-helper нижче).
    
    **Delete-механіка (4-deliverable-set, copy Sprint 4 invoice-flow patern з `features/invoice-edit/`):**
    - **`pendingAccountDeletesStore.ts`** — Zustand store з композитним key `${businessSlug}/${accountSlug}` (копія `apps/web/src/features/invoice-edit/pendingInvoiceDeletesStore.ts` 1:1 з рефакторингом імен). **Композитний key обовʼязковий**, бо account-slug case-sensitive unique тільки per `(businessId, slug)` (§SP-10) — pure account-slug як store-key колидуватиме між business-ами того самого юзера. Sprint 3 single-key `pendingDeletesStore` (business-slug — глобально-unique через `slugLower`-index) reuse-нути неможливо.
    - **`scheduleAccountDeleteWithUndo.ts`** — helper, копія `apps/web/src/features/invoice-edit/scheduleInvoiceDeleteWithUndo.ts` 1:1 з адаптацією: API-call `deleteAccount(businessSlug, accountSlug)`, toast-копія `«${name}» буде видалено`, `getApiMessage(code, 'accounts')` на failure-mapping. **Архітектурні invariant-и переносяться без змін**: timer ID у closure (НЕ React ref); `pendingAccountDeletesStore.add` синхронно перед `setTimeout`; success НЕ remove-ить key зі store (slug-key лишається до browser-unload); failure → `remove(...)` повертає account у UI + toast.error з mapped code.
    - **`AccountsSection`-filter-консумент** живе у `features/business-edit/` (НЕ `account-edit/`), бо AccountsSection рендериться на business-cabinet-сторінці `/business/[slug]/page.tsx` як одна з 7 секцій. Без цього filter-а optimistic-removal не працює.
    - **`shared/api/accounts.ts` додає `deleteAccount(businessSlug, accountSlug): Promise<void>`** — DELETE `/businesses/me/{businessSlug}/accounts/{accountSlug}` thin wrapper (axios-call + envelope-unwrap; no body, no return-shape). Symmetric до Sprint 3 `deleteBusiness` і Sprint 4 `deleteInvoice` shape-у.
    
    **Доля `features/invoices/`**: після переносу обох секцій + `InvoiceCard.tsx` у `account-edit/` — папка видаляється повністю.
- 🔲 **`features/invoice-edit/pendingInvoiceDeletesStore.ts` rekey на 3-сегментний композитний key**. Поточний key `${businessSlug}/${invoiceSlug}` (Sprint 4 §4.6, `pendingInvoiceDeletesStore.ts:23-28`) виходив з invoice-slug uniqueness `(businessId, slug)` — slug-string був унікальним у межах бізнесу. Sprint 9 §SP-6 переводить uniqueness на `(accountId, slug)` (per-account counter-namespace) + §SP-10 явно дозволяє slug-collision між account-ами одного business-у (Privat-account і Mono-account можуть мати власний `inv-001` через preset `'simple'` counter=1). Без rekey filter `usePendingInvoiceDeletesStore.has(businessSlug, invoiceSlug)` у `InvoicesSection` приховає **обидва** інвойси з UI, коли користувач видалив один з них. **Зміни**: (1) `makeInvoiceKey(businessSlug, accountSlug, invoiceSlug)` — третій arg обовʼязковий; (2) `add` / `remove` / `has`-методи store-у приймають триплет; (3) усі callsite-и (`InvoicesSection`, `scheduleInvoiceDeleteWithUndo`, spec-и) синхронно адаптуються; (4) `pendingInvoiceDeletesStore.spec.ts` додає regression-test "Privat-inv-001 і Mono-inv-001 у одному business-i — `add(b, accPrivat, 'inv-001')` не впливає на `has(b, accMono, 'inv-001')`". **Симетрично rationale §SP-10**: composite-key обовʼязковий завжди, коли slug-string-uniqueness scope-ується глибше за store-key-namespace.
- 🔲 **`features/account-public/`** — нова feature для public-зони: `PublicAccountView` — копія Sprint 3 `PublicBusinessView` (heading + 11 bank-grid + 2 NBU buttons + 2 QR), але reads з PublicAccountSchema.
- 🔲 **`features/business-public/PublicBusinessView`** переписується. Було: full-payment view з QR. Стає: list-view карток-Account ("Оберіть рахунок" + cards). Empty-state ("Власник ще не налаштував рахунки"). 1-Account redirect — на сервер-side у Server Component `host-pay/[slug]/page.tsx`.
- 🔲 **`features/invoice-public/InvoicePublicView`** оновлюється: heading тримає посилання на account-context ("через {account.name}"); payload-build на сервер-side робиться через resolved `(business, account, invoice)` triple.
- 🔲 **`features/business-edit/`** очищається: видаляються `InvoicesSection`, `InvoicesSettingsSection` (переїжджають у `account-edit/`); **видаляється `QrSection.tsx`** (більше нема endpoint-у `/businesses/public/:slug/qr/business.png` після backend-рефакторингу — його єдиний consumer був на business-cabinet-page); `RequisitesSection` спрощується (тільки `taxId`, без `iban`).
- 🔲 **`features/business-wizard/`** — структура wizard-кроків лишається (Sprint 7 §SP-6 named-steps), але **draft shape, mapping і persist version міняються синхронно з §9.0 flatten-ом `taxId`**:
    - **`BusinessWizardDraft` shape**: видаляється `requisites?: { iban?: string; taxId?: string }`, додається top-level `taxId?: string`. Поле `iban` зникає з draft повністю — IBAN тепер живе тільки на Account, тому wizard ним не оперує. **Видаляється також `invoiceSlugPresetDefault?: SlugPreset | null`** — поле фізично існує у Sprint 7 draft-shape, але `buildCreateRequestFromDraft` його не emit-ить, тож з v2-store воно живе як orphan-key.
    - **`Step2Requisites`-форма**: видаляється `iban`-input; лишається тільки `taxId`-input з discriminated `taxIdFieldConfig(type)`.
    - **`buildCreateRequestFromDraft`**: drop `requisites`-wrapper-у; передає `taxId` як top-level field-у `baseFields`. Discriminated dispatch на 4 type-variants (Sprint 7 §SP-3) лишається як є.
    - **Persist version bump `2 → 3`** + новий branch у `migratePersistedState`. Mapping v2 → v3: (a) якщо `state.formData.requisites?.taxId` присутній — переноситься у `state.formData.taxId`; field `requisites` видаляється з shape повністю; (b) `delete state.formData.invoiceSlugPresetDefault` (drop orphan-key).
    - Wizard на success виводить ФОП на `/business/{slug}` (empty-state з CTA "Додати перший рахунок"), не на `/business/{slug}` з рахунком.
- 🔲 **Middleware** `apps/web/src/middleware.ts` host-aware routing розширюється на 3-сегментний path. Branch A1 (1-segment), A2 (2-segment Sprint 4), додається **A3 (3-segment)** для invoice-URL: `/{businessSlug}/{accountSlug}/{invoiceSlug}` → rewrite на `/host-pay/{businessSlug}/{accountSlug}/{invoiceSlug}`. **Branch A2 змінює семантику**: був invoice-URL `/{businessSlug}/{invoiceSlug}` (Sprint 4 §4.7); тепер account-URL `/{businessSlug}/{accountSlug}` → rewrite на `/host-pay/{businessSlug}/{accountSlug}/page.tsx`. Reserved-check тільки на businessSlug (як зараз A1/A2). **Branch A1** додатково ставить `Cache-Control: no-store, no-cache, must-revalidate` на rewrite-response — defense-in-depth для CDN/proxy-шару проти 1→2-Account redirect-flip (семантика 307 — у §SP-4). Branches A2 і A3 cache-header НЕ ставлять — там state стабільний.
- 🔲 Server Components `host-pay/[slug]/page.tsx`, `host-pay/[slug]/[accountSlug]/page.tsx`, `host-pay/[slug]/[accountSlug]/[invoiceSlug]/page.tsx` — defense-in-depth host-check (як Sprint 3 §3.9). 1-Account redirect живе у `host-pay/[slug]/page.tsx`: server-side fetch `/businesses/public/{slug}` → якщо `accounts.length === 1` → `redirect('/{slug}/{accounts[0].slug}')` Next.js helper, що віддає **307 Temporary Redirect** (НЕ `permanentRedirect` / 308 — детально у §SP-4). 0-Account → render empty-state. 2+ → render list.
- 🔲 **`shared/api/businesses.ts`** + новий `shared/api/accounts.ts`: API-helpers для cabinet flow (list, create, get, patch, delete).

### Shared (`@finly/types`)

- 🔲 Новий `entities/account.ts`: `AccountSchema` (Zod entity) — `id`, `businessId`, `iban` (через `ibanZod`), `name` (max 60 chars, NBU-charset як `businessNameSchema`), **`slug: z.string().regex(/^[A-Za-z0-9]{8}$/, 'INVALID_ACCOUNT_SLUG_FORMAT')`** — strict 8-char alphanum-only. **БЕЗ `slugLower`-поля** (account-slug case-sensitive за моделлю Sprint 4 invoice-slug §SP-8 — детально §SP-10), **`bankCode: BankCode | null` (stored field у документі)** — обчислюється через `bankCodeFromIban(iban)` рівно один раз під час `POST /accounts` create і фіксується у Account-документі. Rationale — у §SP-9. **`invoiceSlugPresetDefault: SlugPreset | null`** (default `null` = "не визначено"). `deletedAt`, `createdAt`, `updatedAt`.
- 🔲 Новий `contracts/accounts.ts`: `CreateAccountSchema { iban, name?: string }` (`.strict()`), `UpdateAccountSchema { name?: string, invoiceSlugPresetDefault?: SlugPreset | null }` (`.strict()`, **обидва поля редаговані**; `iban` / `slug` / `businessId` / `bankCode` immutable і навмисно відсутні у shape), `PublicAccountListItemSchema { slug, name, bankCode, ibanMask }` (whitelist для root-page list — `ibanMask` = `"•{last4}"` рядок), `PublicAccountViewSchema { slug, name, bankCode, ibanMask, business: {…}, nbuLinks }` (whitelist для per-account-page). **`ibanMask` не leak-ає сам IBAN** — це 5-символьний рядок типу `"•2580"`. **`AccountWithCountsSchema = AccountSchema.extend({ invoicesCount: z.number().int().nonneg() })`** — окрема cabinet-only read-shape для `AccountsService.getBySlug`-response і `AccountsService.getByBusinessId({ withInvoicesCount: true })`-per-item-shape (cabinet-list). `invoicesCount` — derived counter (real-time `Invoice.countDocuments({accountId})` per-request).
- 🔲 `entities/business.ts` рефакторинг:
    - Видалити `requisites: BusinessRequisitesSchema`.
    - Додати top-level `taxId: payerTaxIdZod` (зі Sprint 7 union).
    - Видалити `invoiceSlugPresetDefault` (переїжджає на Account).
    - Refine `taxId-формат за type` (Sprint 7 §SP-4) лишається, тільки path змінюється з `['requisites', 'taxId']` на `['taxId']`.
- 🔲 `entities/invoice.ts` рефакторинг:
    - Додати `accountId: objectIdSchema` (required).
    - `payeeSnapshot.iban` — без зміни структурно (snapshot все ще містить iban string), але джерело при create — Account, не Business.
- 🔲 `contracts/businesses.ts` рефакторинг:
    - `CreateBusinessSchema` (discriminated union 4 variants) — видалити `requisites.iban` з кожного variant-у; `taxId` стає top-level (рекомендую — спрощує structure-ремайнінг).
    - `UpdateBusinessSchema` — те саме.
    - `PublicBusinessSchema` — переписується: `{ type, name, slug, acceptedBanks, seoIndexEnabled, accounts: PublicAccountListItemSchema[] }`. Видалити `nbuLinks` з business-level (переїжджає на account-level).
- 🔲 `contracts/invoices.ts`:
    - `CreateInvoiceSchema` — без структурних змін у тіло (slug-input + amount + ...), але endpoint URL міняється; контракт може лишитися identical.
    - `PublicInvoiceSchema` whitelist розширюється на `account: { slug, name, bankCode, ibanMask }`.
- 🔲 Новий `constants/bank-mfo.ts`: `BANK_MFO_MAP: Record<MfoString, BankCode>` для 11 MVP-банків. Helper `bankCodeFromIban(iban: string): BankCode | null` (parse МФО з позицій 5-10 UA IBAN).
- 🔲 `RESPONSE_CODE` додає рівно 6 нових кодів — повний authoritative-list:
    - `ACCOUNT_NOT_FOUND` (404; `AccountAccessGuard` lookup miss).
    - `ACCOUNT_HAS_INVOICES` (409; `AccountsService.delete` preflight `Invoice.countDocuments({accountId}) > 0` — §SP-3). **UA-message-template** (через `mapApiCode` `accounts`-namespace, **pluralization-neutral**): `"Цей рахунок має {invoicesPhrase}. Спочатку видаліть їх або весь бізнес"`. **`{invoicesPhrase}`-плейсхолдер обовʼязковий**: caller (frontend toast.error + backend exception) **pre-resolves** plural-form через `pluralizeUa(count, 'виставлений інвойс', 'виставлені інвойси', 'виставлених інвойсів')` (helper уже існує у `apps/web/src/shared/lib/intl.ts` — конвенція проєкту, mirror-pattern Sprint 12 §3 multi-business pluralization). Backend сторона додає симетричний `pluralizeUa`-helper у `apps/api/src/common` (single source перегортається у `@finly/types/utils` за потреби) і резолвить рядок прямо в `AccountsService.delete` перед throw. **Без pre-resolve** на count=2..4 шаблон з singular/plural-only-formою дасть граматично некоректний UI.
    - `ACCOUNT_ACCESS_DENIED` (403; `AccountAccessGuard` ownership-check fail).
    - `ACCOUNT_SLUG_GENERATION_FAILED` (500; **домен-isolated від Sprint 3 `SLUG_GENERATION_FAILED`** — той зарезервований за business-slug-генератором, новий код для account-domain-у).
    - `ACCOUNT_IBAN_DUPLICATE` (409; anti-duplicate IBAN під одним business-ом — §SP-2; post-insert 11000 на `(businessId, iban)` compound-unique).
    - `ACCOUNT_CREATE_FAILED` (500; **safety-net для unknown 11000-кейсів** у `AccountsService.create`).
    
    `mapApiCode` (web) додає UA-message для кожного з кодів.

### Migrations

- 🔲 **Жодного DB-migration script-а Sprint 9 не пише.** Вступний контракт користувача: production-data ще немає, `dropDatabase` + чистий старт.
- 🔲 Документується у root `README.md` "Sprint 9 deploy-prep" секція: "Перед deploy виконати dropDatabase на staging/production. Доменна модель змінилася не сумісно з Sprint 1-8."

### Infrastructure

- 🔲 **MongoDB replica-set** — обов'язкова умова з Sprint 4 §4.0; Sprint 9 не міняє цей invariant. `BusinessesService.delete` cascade тепер видаляє +Account-collection (нова), решта transactional-механіки — без змін.
- 🔲 **Redis** — без додаткових ключів. Sprint 10 (anon-claim refactor) додасть landingDraft sub-поле у `magic:${token}`-record-у; Sprint 9 цього не торкається.

---

## НЕ-скоуп

- ❌ **Sprint 8 anon-claim flow refactor** — переїхав у [Sprint 10](../10-anon-claim-refactor/README.md). Sprint 9 тимчасово вимикає CTA "Зберегти у кабінет" на лендінгу (deliverable у §Скоуп.Frontend). Sprint 10 повертає CTA з 2 sequential POST + form-recovery + magic-link Redis-draft + idempotency-key + terms-pre-stamp.
- ❌ **Deep-link UX-recovery (`User.pendingPostLoginTarget`)** — переїхав у [Sprint 11](../11-deep-link-recovery/README.md).
- ❌ **Orphan-Business cleanup-cron + email-pipeline** — переїхав у [Sprint 12](../12-orphan-cleanup/README.md).
- ❌ **Production-міграція з Sprint 1-8 моделі.** `dropDatabase` + чистий старт (вступний контракт).
- ❌ **`Account.providerLink` placeholder для Phase 1.5 (Mono Acquiring API і подібні трекінг-інтеграції).** YAGNI — точна форма інтеграції з банками ще не визначена; nullable-add у майбутньому non-breaking. Sprint 9 фокусується на чистій моделі без forward-compatibility-полів.
- ❌ **Account як точка delegation для bookkeeper-режиму.** Поточний bookkeeper-режим (Sprint 3 E5) фільтрує бізнеси за ownership; Sprint 9 не змінює цю логіку.
- ❌ **Account vanity-slug** (Paid-фіча). За аналогією з business-slug Sprint 6 — тільки random 8-char tail у MVP.
- ❌ **Account custom-logo у QR.** Sprint 6 patтерн для Business — той самий argument. Sprint 9 рендерить нормативний знак гривні в центрі QR (як зараз).
- ❌ **Cross-account invoice-move** ("перенести інвойс з Privat на Mono"). Інвойс immutable з `accountId` — як і `payeeSnapshot.iban`.
- ❌ **Multi-business shared account** ("один IBAN використовується двома бізнесами"). Account належить рівно одному businessId через FK.
- ❌ **Per-bank deep-links на account-сторінці (Sprint 5 функціонал).** Sprint 9 рендерить як зараз: 11 неактивних логотипів + 2 активні NBU-кнопки.
- ❌ **Free vs Paid гейти на кількість Account на бізнес.** Sprint 6 (Free vs Paid) ревізує. Sprint 9 — нелімітований.

---

## Закриті продуктові рішення (discharge-list)

> Кожне рішення з rationale у [`planning-questions.md`](planning-questions.md). README не дублює міркування — фіксує закриття.

### SP-1. Account як окрема сутність з мінімальною площиною

**Рішення:** Account має поля `iban`, `name`, `slug`, `businessId`, `bankCode` (stored derived з IBAN — деталі §SP-9), `invoiceSlugPresetDefault` (`SlugPreset | null`, з тією самою system-default-fallback-семантикою, що мав на Business до Sprint 9), `deletedAt`. Все інше (paymentPurposeTemplate, acceptedBanks, type, taxId, taxation) — лишається на Business.

**`deletedAt` навмисно невикористане у Sprint 9** (mirror-pattern Business.deletedAt): §SP-3 фіксує hard-delete (`Account.deleteOne` усередині `withTransaction`), не soft-delete. Поле залишається у схемі для forward-compat з потенційним soft-delete-pattern-ом (Sprint 13+). **Service-layer-lookup-и НЕ додають `deletedAt: null`-фільтри** — це б створило ілюзію soft-delete-rail-у.

**Закриває:** A1 + плутанина початкової інтерпретації "переносимо purpose+banks на account" (планувалось було, але після уточнення з користувачем — ні). `acceptedBanks` — це політика бізнесу, не атрибут IBAN. `paymentPurposeTemplate` — теж бізнес-level.

### SP-2. IBAN immutable post-creation + unique per business

**Рішення (immutability):** `iban` фіксується при `POST .../accounts`, далі ніколи не змінюється. `UpdateAccountSchema` навмисно не містить `iban`. ФОП помилився — видаляє account (якщо ще немає інвойсів) і створює новий.

**Рішення (uniqueness): compound-unique-index `(businessId, iban)` на `Account`-колекції** — два account-документи з однаковим IBAN під одним бізнесом заборонені на DB-рівні. Без цього invariant-у ФОП-typo при manual-IBAN-input або повторний submit account-форми тихо створили б два документи з ідентичним `•{last4}`. Mongo на 11000-error → `AccountsService.create` ловить, мапить на `409 ACCOUNT_IBAN_DUPLICATE`. Cross-business-duplicate **дозволений**: один і той самий IBAN може фігурувати на двох різних business-документах (наприклад, ФОП і його ТОВ ділять рахунок).

**Закриває:** A5. Той самий патерн immutability, що Sprint 7 §SP-8 для `Business.type`.

### SP-3. Account delete: 0 інвойсів — обов'язкова передумова

**Рішення:** `AccountsService.delete` робить `Invoice.countDocuments({accountId})` pre-check **усередині `session.withTransaction`** разом із `Account.deleteOne` + `InvoiceSlugCounter.deleteMany`. > 0 → `409 ACCOUNT_HAS_INVOICES` з прозорим UA-message. Без cascade на Invoice.

**Атомарність як race-protection (НЕ просто for-aesthetics):** `InvoicesService.create` пише touch-account у власній tx (Sprint 4 review fix-патерн, перенесений з Business на Account). Без `withTransaction` навколо delete-flow MongoDB не серіалізує count-then-delete з паралельним create — race "count=0 → конкурентний create-invoice → deleteOne" створив би orphan-Invoice з `accountId` на видалений Account.

**Two-line-of-defense pre-check (frontend + backend узгоджені через single mapApiCode-source):**
- **Frontend first line** — UX-shortcut: DangerSection account-page + per-card AccountsSection читають `invoicesCount` з вже-fetched `AccountWithCounts`-shape і викликають `toast.error` БЕЗ network-call-у на > 0.
- **Backend second line** — race-protection: frontend-pre-check читає `invoicesCount` з cache на момент cabinet-page-render-у; за 5+ секунд між mount і delete-confirm concurrent `InvoicesService.create` може повернути `count` від 0 до 1+. Backend `AccountsService.delete` на пер-server-tick перевіряє countDocuments всередині того самого `withTransaction`.

**UA-message pluralization (обидва callsite-и):** `ACCOUNT_HAS_INVOICES`-template містить `{invoicesPhrase}`-плейсхолдер (§Скоуп.Shared). Frontend toast.error pre-resolves через `pluralizeUa(invoicesCount, 'виставлений інвойс', 'виставлені інвойси', 'виставлених інвойсів')` (helper з `apps/web/src/shared/lib/intl.ts`); backend exception pre-resolves через симетричний `pluralizeUa`-helper у `apps/api/src/common`. Шаблон з hardcoded singular/plural-only-формою на count=2..4 дав би граматично некоректний UI ("має 2 виставлений інвойс" / "має 1 виставлених інвойсів") — конвенція проєкту вимагає caller-pre-resolve, mirror-pattern Sprint 12 §3.

**Закриває:** A5. На відміну від Business cascade-delete (Sprint 4 §SP-5 — атомарно видаляє все), Account-delete консервативніший: ФОП явно вирішує доля інвойсів.

### SP-4. Public-вивіска: list-view at root, redirect-at-1, empty-at-0

**Рішення:**
- 0 Account → empty-state на корені ("Власник ще не налаштував рахунки").
- 1 Account → **307 Temporary Redirect** з `/{businessSlug}` на `/{businessSlug}/{accountSlug}`.
- 2+ Account → список карток ("Оберіть рахунок: 💳 ПриватБанк •2580 / 💳 monobank •8104"). Tap → перехід на `/{businessSlug}/{accountSlug}`.

Redirect живе на Server Component (`host-pay/[slug]/page.tsx`) через Next.js `redirect()` helper (НЕ `permanentRedirect()`).

**Чому 307, а не 308**: redirect-семантика умовно завязана на стан "у бізнесу рівно 1 Account", який може змінитися (ФОП додасть 2-й рахунок). 308 за специфікацією HTTP — постійний; Chrome агресивно кешує його in-memory на всю сесію навіть з `Cache-Control: no-cache`. Користувач, який вперше відкрив `pay.finly.com.ua/{biz}` коли був 1 Account, після додавання 2-го застряг би на старій per-account-вивісці. 307 такої агресивної in-memory-фіксації не має.

`Cache-Control: no-cache` як defense-in-depth для CDN/proxy-шару — **технічна реалізація через middleware**, не Server Component. Next.js `redirect()` усередині Server Component кидає `NEXT_REDIRECT` без прямого контролю над response-headers, тому ставити header у `host-pay/[slug]/page.tsx` неможливо. Натомість `apps/web/src/middleware.ts` (Branch A1) додатково ставить `response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')` на rewrite-response.

**Закриває:** A1 + A2.

### SP-5. Cabinet-навігація: матрьошка через 4 рівні

**Рішення:** business → account → invoice — три nested-рівні URL, кожен зі своєю list-view і single-detail-view:

- `/business/[slug]` — список account, без згадок про інвойси.
- `/business/[slug]/account/[accountSlug]` — список інвойсів цього account, без згадок про інші account.
- `/business/[slug]/account/[accountSlug]/invoice/[invoiceSlug]` — кабінет одного інвойсу.

**Закриває:** A6. Sprint 4 §SP-4 структура (9 секцій з invoice-list) переписується.

### SP-6. Інвойсна нумерація per-account

**Рішення:** compound-unique invoice-slug міняється з `(businessId, slug)` на `(accountId, slug)`. Counter-allocation для preset-режимів — атомарний `$inc` на `InvoiceSlugCounter`-document-і; lazy-bootstrap-крок виконується **один раз** при першому create-у нового scope-у. Sprint 9 тільки міняє namespace counter-doc-у з `businessId` на `accountId`. `invoiceSlugPresetDefault` переїжджає з Business на Account. Public-URL інвойсу стає 3-сегментним.

**Закриває:** A7. Природна семантика "інвойс живе під account-ом". Privat має inv-001..N; Mono — inv-001..M, незалежно.

### SP-9. Account.bankCode як stored derived value (не runtime computed-on-read)

**Контекст:** під час планування виникла розвилка — `bankCode` обчислюється через `bankCodeFromIban(iban)` на write, але куди його класти? Варіант A — stored у документі Account; варіант B — runtime-computed на кожному read.

**Рішення:** stored field. `AccountsService.create` обчислює `bankCode` через `bankCodeFromIban(iban)` **один раз** і пишеться у Account-документ як persistent поле. Read-path серіалізує його як є.

**Чому stored, а не runtime:**

1. **IBAN immutable (§SP-2)** — банк-кореспонденція також структурно immutable. Stored value не може дрейфувати з IBAN.
2. **Read-path спрощується.** Public-controller-и віддають десятки тисяч request-ів на день; runtime-парсинг IBAN на кожному read — зайва робота.
3. **`BANK_MFO_MAP` як snapshot, не live mapping.** Якщо банк-А змінює МФО (рідкісна подія), історичні Account-документи відображають "що було коли клієнт створив рахунок" — це коректна семантика. Якщо знадобиться синхронізувати з новим МФО — це **явна одноразова міграція**, а не silent runtime-drift.
4. **Захист від IBAN-leak.** Якщо `bankCode` був би derived на read — кожен серіалізатор мусив би тримати IBAN у dto-shape лише для `bankCodeFromIban` step-у. Stored bankCode прибирає IBAN з read-path-у повністю.

**Null-bankCode UI-rule (single source of truth для frontend-рендерингу).** На `bankCode === null` (нерозпізнаний МФО) **bank-label-елемент ховається повністю**, не fallback-ить на текст "Невідомий банк". Це консистентний rule для всіх **4 UI-точок**:

1. **Cabinet `AccountsSection` cards** на `/business/[slug]`: кожна картка — `name + (bankCode ? bank-label-row : нічого) + IBAN-mask`.
2. **Cabinet `BasicSection`** на `/business/[slug]/account/[accountSlug]`: `name inline-edit + (bankCode ? bank-label-row readonly з МФО : нічого)`. Сам блок "Основне" рендериться завжди.
3. **Public `PublicBusinessView` cards** на `pay.finly.com.ua/{businessSlug}` (2+ Account варіант): кожна картка списку — symmetric до cabinet AccountsSection cards. Дані прийдуть з `PublicAccountListItemSchema`.
4. **Public `PublicAccountView` heading** на `pay.finly.com.ua/{businessSlug}/{accountSlug}`: heading завжди містить parenthetical з last4-tail як **server-derived disambiguator незалежно від name-state-у**: на bankCode не-null — "Платіж на користь {business.name} через {account.name} ({BANK_LABEL[bankCode]} •{last4})"; на bankCode-null — "Платіж на користь {business.name} через {account.name} (•{last4})" (BANK_LABEL-prefix дроп-ається, `•{last4}`-postfix лишається). **Чому last4-postfix unconditional**: heading — єдина точка на per-account-public-page, де клієнт бачить рахунок-disambiguator; якщо ФОП перейменував account з auto-generated "Банк •{last4}" на "Основний", `•{last4}` у parenthesis залишається server-derived з самого IBAN-документа.

Cabinet-точки (1, 2) і public-list-точка (3) уже мають IBAN-mask `•{last4}` як окреме UI-поле, тому disambiguation там не залежить від name-stat-у.

**Закриває:** архітектурне питання, що виникло після Q&A-фази (не у списку A1..A8).

### SP-10. Account-slug case-sensitive (модель invoice-slug, не business-slug)

**Контекст:** під час планування виникла розвилка — Account-slug має slugLower-поле з case-insensitive uniqueness чи case-sensitive?

**Рішення:** модель invoice-slug — **case-sensitive** lookup, compound-unique `(businessId, slug)` без `slugLower`-поля. Account-slug system-generated 8-char tail (random `A-Za-z0-9`). Без `slugLower`-derivative-поля у Mongoose-схемі і без related Zod-refine. Без canonical-case-redirect на public-сторінці account-у.

**Чому invoice-модель, а не business-модель:**

1. **Slug-генератор діапазон.** Business-slug у Sprint 3 — vanity-target Twitter-style, 3-30 chars з displayName-derive (`fop-petrenko`); user сприймає його як власне ім'я. Account-slug — random 8-char tail, який ніколи не вводиться вручну.
2. **Vanity-value нульовий.** Sprint 6 закладе vanity-slug для business, але НЕ для account. 8-char tail назавжди random.
3. **Симетрія з invoice-slug.** Invoice-slug case-sensitive за тим самим аргументом (Sprint 4 §SP-8). Account-slug — той самий клас "system-generated identifier у URL глибше root-у бізнесу".
4. **Простіша Mongoose-схема.** Без `slugLower`-prop, без `pre('save')`-hook для derive-у.

**Trade-off проти business-моделі:** теоретичний edge — два account-и з slug-tail-ами `abc12345` і `Abc12345` — у БД unique-index пройде (case-sensitive), але клієнт, який скопіював посилання з email і випадково капіталізував першу літеру, отримає 404. На практиці: 8-char random A-Za-z0-9 простір ~218 трлн комбінацій, шанс генерації astronomically low; клієнт копіює URL one-click.

**Frontend store-key invariant** (cascading consequence): pending-delete Zustand-store-и тримають композитний key, що повинен дорівнювати uniqueness-scope-у БД. Account-store ⇒ `${businessSlug}/${accountSlug}` (бо account-uniqueness `(businessId, slug)`). **Invoice-store** після §SP-6 ⇒ `${businessSlug}/${accountSlug}/${invoiceSlug}` — це rekey існуючого Sprint 4 `pendingInvoiceDeletesStore` (deliverable у §Скоуп.Frontend), бо інвойсна uniqueness переїхала з `(businessId, slug)` на `(accountId, slug)` і два account-и одного business-у дозволено мати інвойс з однаковим slug-string-ом (per-account counter-namespace §SP-6). 2-сегментний key `${businessSlug}/${invoiceSlug}` колидуватиме між account-ами і приховає не той інвойс з UI.

**Закриває:** архітектурне питання, що виникло після Q&A-фази (не у списку A1..A8).

---

## Епіки

### 9.0 Shared types — нова Account-сутність + рефакторинг Business / Invoice (БЛОКЕР №0)

**⚠ Передумова перед стартом епіку — research-задача "11 МФО для BANK_MFO_MAP"**. `BANK_MFO_MAP` — це fundamental input для всього Sprint 9: без 11 валідних МФО helper `bankCodeFromIban` фейлить-bank-resolution для кожного IBAN, що каскадно ламає `AccountsService.create` (auto-name fallback на "Банк •last4" для всіх 11 банків — UX-degraded), `bankCode`-stored-field (всі stored values = null — null-fallback UI-rule §SP-9 спрацьовує всюди), і всі 4 UI-точок рендерять без bank-label-row. **Owner**: backend-implementer Sprint 9 на kickoff. **Source**: NBU public registry банків (https://bank.gov.ua/ua/statistic/supervision-statist). **Output**: PR з literal-table значень у `bank-mfo.ts` + 1-2-line-comment поряд з кожним записом — джерело + дата перевірки.

Виконується першим. Усі інші епіки read-from-це.

- 🔲 `packages/types/src/entities/account.ts`: `AccountSchema` — повний Zod-entity без `slugLower`-поля і без related рефайну (case-sensitive модель — §SP-10).
- 🔲 `packages/types/src/contracts/accounts.ts`: `CreateAccountSchema`, `UpdateAccountSchema`, `PublicAccountListItemSchema`, `PublicAccountViewSchema`, `AccountWithCountsSchema`.
- 🔲 `packages/types/src/entities/business.ts` рефакторинг: видалити `requisites`-sub-схему; додати top-level `taxId: payerTaxIdZod`; видалити `invoiceSlugPresetDefault`; оновити refine `TAX_ID_FORMAT_MISMATCH_TYPE` path на `['taxId']`.
- 🔲 `packages/types/src/entities/invoice.ts` рефакторинг: додати `accountId: objectIdSchema`; оновити Zod doc-block (snapshot.iban тепер з Account).
- 🔲 `packages/types/src/contracts/businesses.ts` рефакторинг: усі 4 variant-и `CreateBusinessSchema` без `requisites.iban`; flatten `requisites.taxId` → top-level `taxId`. `UpdateBusinessSchema` — те саме. `PublicBusinessSchema` — переписати з `nbuLinks` → `accounts: PublicAccountListItemSchema[]`.
- 🔲 `packages/types/src/contracts/invoices.ts`: `PublicInvoiceSchema` додати `account` поле.
- 🔲 `packages/types/src/constants/bank-mfo.ts`: `BANK_MFO_MAP` для 11 банків + helper `bankCodeFromIban`.
- 🔲 `RESPONSE_CODE` нові коди (6).
- 🔲 Tests: нові spec-и для `account.spec.ts` (entity), `accounts.spec.ts` (contracts), `bank-mfo.spec.ts` (helper розбирає UA IBAN коректно для 11 банків + nullable для unknown МФО).
- 🔲 **Acceptance:** `pnpm --filter @finly/types build` зелений; `pnpm --filter @finly/types test` зелений; downstream apps НЕ компілюються — це OK, наступні епіки доганяють.

### 9.1 Backend — Mongoose schemas + AccountsModule + ремайнінг BusinessesModule / InvoicesModule

- 🔲 `apps/api/src/modules/accounts/schemas/account.schema.ts`: Mongoose-схема, indexes — `(businessId, slug)` compound-unique **case-sensitive** (§SP-10), `(businessId, iban)` compound-unique (§SP-2), `(businessId, createdAt)` для list-sort. БЕЗ `slugLower`-поля.
- 🔲 `apps/api/src/modules/businesses/schemas/business.schema.ts` рефакторинг: видалити `requisites`-subdoc-class; додати `@Prop({ required: true, trim: true }) taxId!: string`; видалити `invoiceSlugPresetDefault`-prop. Migration не потрібна — dropDatabase.
- 🔲 `apps/api/src/modules/invoices/schemas/invoice.schema.ts` рефакторинг: додати `@Prop({ required: true, type: Types.ObjectId }) accountId!: Types.ObjectId`. **`businessId` лишається** як denormalized field (set on insert з `account.businessId`, immutable). Видалити compound-unique index `(businessId, slug)` + partial-unique `(businessId, slugCounterScope, slugCounter)`. Створити `(accountId, slug)` unique + `(accountId, createdAt -1, _id -1)` + partial-unique `(accountId, slugCounterScope, slugCounter)`. **Залишити** non-unique `(businessId, createdAt -1)` для прямих cabinet-аналітичних запитів і cascade-delete-business filter-у.
- 🔲 `apps/api/src/modules/invoices/schemas/invoice-slug-counter.schema.ts` рефакторинг: додати `@Prop({ required: true, type: Types.ObjectId }) accountId!: Types.ObjectId`. **`businessId` лишається** як denormalized field — для прямого `InvoiceSlugCounter.deleteMany({businessId})` у cascade-business-delete без `$lookup` через accounts. **Field-name на цій колекції — `scope` (не `slugCounterScope`)**: чинна схема використовує `scope`-prop. Видалити existing unique-index `(businessId, scope)` → новий unique `(accountId, scope)`. Залишити non-unique `(businessId)` для cascade-business-delete filter-у. **Service-методи у `apps/api/src/modules/invoices/invoice-slug-generator.service.ts` приймають `account: AccountDocument` замість `businessId: ObjectId`**. Privat і Mono account-и того самого business мають незалежні counter-namespace-и (§SP-6 per-account нумерація). Migration не потрібна — dropDatabase.
- 🔲 `apps/api/src/modules/accounts/accounts.module.ts` — реєструє `AccountsService`, `AccountsController`, `PublicAccountsController`, `AccountAccessGuard`, **`AccountSlugGeneratorService`** (новий). **`MongooseModule.forFeature([Account, Invoice, InvoiceSlugCounter])`** — три моделі реєструються разом, бо `AccountsService.delete` робить cascade `Invoice.countDocuments({accountId}) + Account.deleteOne + InvoiceSlugCounter.deleteMany({accountId})` усередині `withTransaction` і потребує всіх трьох інжекcій.
- 🔲 **Новий `apps/api/src/modules/accounts/account-slug-generator.service.ts`** — окремий `Injectable`-сервіс, що інкапсулює rejection-sampling generator для Account-slug-у. Reuse `generateRandomTail()` (вже free-function helper з `apps/api/src/modules/businesses/slug-generator.service.ts:36-51`). Алгоритм: до 10 attempts; перевірка `accountModel.exists({ businessId, slug: candidate })`; reserved-slug-check НЕ потрібен (account-slug не світиться у URL верхнього рівня). На 11-й спробі — `500 ACCOUNT_SLUG_GENERATION_FAILED`.
- 🔲 `apps/api/src/modules/accounts/accounts.service.ts`:
    - `create(business, dto)` — validates IBAN через `ibanZod`; resolve `bankCode` через `bankCodeFromIban(iban)` і **записує у документ як stored field** (§SP-9); auto-generate `name = "{BANK_LABEL[bankCode]} •{ibanLast4}"` якщо `dto.name === undefined` (на `bankCode === null` — fallback `"Банк •{last4}"`); slug — `await accountSlugGenerator.generateUnique(business._id)`. **Дві окремі error-mapping-гілки на 11000**:
        - Collision на `(businessId, slug)` → throw `500 ACCOUNT_SLUG_GENERATION_FAILED`.
        - Collision на `(businessId, iban)` → throw `409 ACCOUNT_IBAN_DUPLICATE`.
        - Якщо обидва pattern-и не матчать — throw `500 ACCOUNT_CREATE_FAILED`.
    - `getByBusinessId(businessId, { sort, withInvoicesCount })` — list usage у cabinet root + public root (різна whitelist на serialize). **Sort-параметр обовʼязковий, дві стабільні стратегії**:
        - `{ createdAt: -1 }` (desc) для cabinet-list (`AccountsController.list`).
        - `{ createdAt: 1 }` (asc) для public-list (`PublicBusinessesController.getPublic` accounts-array) — customer-perspective "перший-створений = основний-рахунок зверху".
        Index `(businessId, createdAt)` без direction — Mongo-індекс однаково обслуговує обидві сторони `sort`. **Per-item `invoicesCount` через option `{ withInvoicesCount: true }`**: cabinet-list-callsite передає `true`; public-list — default `false`. При `withInvoicesCount: true` — single aggregation pipeline з `$lookup`.
    - `getBySlug(business, accountSlug)` — case-sensitive lookup (як invoice slug Sprint 4 §SP-8). **Response shape `AccountWithCounts = { ...account, invoicesCount }`** (§9.0 contract).
    - `update(account, dto)` — partial update name (єдине editable). `iban`/`businessId` immutable через `.strict()` write-DTO.
    - `delete(account)` — **атомарно у `session.withTransaction`**: `Invoice.countDocuments({accountId: account._id}, { session })` → `> 0` ⇒ throw `409 ACCOUNT_HAS_INVOICES` (abort tx); інакше `Account.deleteOne({ _id }, { session })` + `InvoiceSlugCounter.deleteMany({ accountId }, { session })` → commit. **Race-protection rationale** (симетрично Sprint 4 review fix touch-business pattern): `InvoicesService.create` робить touch-account через `Account.updateOne({ _id: account._id }, { $currentDate: { updatedAt: true } }, { session })` у власній tx. **Replica-set requirement** — без змін; standalone Mongo дає той самий 500 `CASCADE_DELETE_REQUIRES_REPLICA_SET`.
- 🔲 `apps/api/src/modules/accounts/accounts.controller.ts` (cabinet): GET list `/businesses/me/:slug/accounts` (через BusinessAccessGuard); POST create; GET getBySlug; PATCH update; DELETE delete (через AccountAccessGuard на 3 останні).
- 🔲 `apps/api/src/modules/accounts/account-access.guard.ts`: case-sensitive lookup `account.businessId === request.business._id` + attach `request.account` для `@CurrentAccount()`.
- 🔲 `apps/api/src/modules/accounts/public-accounts.controller.ts`: GET `/businesses/public/:slug/account/:accountSlug` (whitelist), GET .../qr/business.png, GET .../qr/nbu.png?host. Той самий `@SkipThrottle({ default: true }) + @Throttle({ 'public-payment': ... })` patern як `PublicBusinessesController` Sprint 3.
- 🔲 Новий `apps/api/src/modules/accounts/payload-mapper.ts`: `buildPayloadInputFromAccount(business: BusinessDocument, account: AccountDocument): PayloadInput`. Source-mapping: `receiverName = business.name`, `iban = account.iban`, `receiverTaxId = business.taxId`, `amountKopecks = null`, `purpose = business.paymentPurposeTemplate`. Consumed `PublicAccountsController` QR-endpoints. Spec покриває 4 type-варіанти бізнесу × 2 формати (002/003) round-trip через `jsqr`.
- 🔲 **Видалити** `apps/api/src/modules/businesses/payload-mapper.ts` + `payload-mapper.spec.ts`. Єдиний callsite (`buildPayloadInputFromBusiness` у `PublicBusinessesController` QR-endpoints) видалено разом з QR-endpoints.
- 🔲 `apps/api/src/modules/businesses/businesses.module.ts` рефакторинг — **`MongooseModule.forFeature` розширюється з `[Business, Invoice, InvoiceSlugCounter]` на `[Business, Account, Invoice, InvoiceSlugCounter]`**.
- 🔲 `apps/api/src/modules/businesses/businesses.service.ts` рефакторинг:
    - `create` — без `iban`/`requisites`-mapping; зберігає top-level `taxId`.
    - `update` — coupled VAT-check лишається. `taxId` лишається editable з coupled-перевіркою формату; field-path міняється з `requisites.taxId` на top-level `taxId`. Sprint 7 §SP-8 immutable стосувалось тільки `type`, не `taxId`.
    - `delete` — cascade розширюється на Account.deleteMany + InvoiceSlugCounter.deleteMany; response містить `affectedAccounts` + `affectedInvoices`.
    - `getOwnedAndManagedWithInvoicesCount` — переименовується на `getOwnedAndManagedWithCounts`; aggregation pipeline розширюється: `$lookup` на `accounts` collection з nested `$count` для `accountsCount` + **окремий `$lookup` на `invoices` напряму через `businessId`** для `invoicesCount`. Response shape `{ ...business, accountsCount, invoicesCount }`. **Synchronously-required test-updates**:
        - `apps/api/src/modules/businesses/businesses.service.spec.ts` — rename + updated assertions.
        - `apps/api/src/modules/businesses/businesses.controller.spec.ts` — getMy-controller-test з новим method.
        - `apps/api/test/businesses.e2e-spec.ts` — `GET /businesses/me` response-assertion перевіряє `accountsCount` поряд з `invoicesCount`.
        - Web-сторона: `apps/web/src/features/businesses-list/BusinessCard.tsx` (або еквівалент) отримує новий `accountsCount`-prop і рендерить "{accountsCount} рахунків / {invoicesCount} інвойсів".
- 🔲 `apps/api/src/modules/businesses/public-businesses.controller.ts` рефакторинг:
    - `getPublic` — повертає `{ type, name, slug, acceptedBanks, seoIndexEnabled, accounts: PublicAccountListItem[] }`. Без `nbuLinks`. Кожен `PublicAccountListItem` обчислюється на serialize: `ibanMask = "•" + account.iban.slice(-4)`. **Sort-стратегія**: `accounts`-array відсортований через `AccountsService.getByBusinessId(businessId, { sort: { createdAt: 1 } })` — asc-by-createdAt.
    - QR-endpoints видаляються (переїжджають на public-account-controller).
- 🔲 `apps/api/src/modules/invoices/invoices.service.ts` рефакторинг:
    - `create(business, account, dto)` — touch-account у транзакції замість touch-business. Slug-generator приймає `accountId`. `payeeSnapshot.iban` з `account.iban`.
    - `getByAccountId` (новий) замість `getByBusinessId`.
    - `getBySlug(account, invoiceSlug)` — lookup через `(accountId, slug)`.
    - `delete(account, invoiceSlug)` — фільтр через `accountId`.
- 🔲 `apps/api/src/modules/invoices/invoices.controller.ts` URL-ремайнінг: всі endpoints отримують `accountSlug` route-param. `/businesses/me/:slug/accounts/:accountSlug/invoices` + nested CRUD. **Class-level guards: `JwtActiveGuard` + `BusinessAccessGuard` + `AccountAccessGuard`**. **Route-level `InvoiceAccessGuard`** на read/update/delete.
- 🔲 `apps/api/src/modules/invoices/public-invoices.controller.ts` URL-ремайнінг: `/businesses/public/:slug/account/:accountSlug/invoices/:invoiceSlug`.
- 🔲 `apps/api/src/modules/invoices/payload-mapper.ts`: `buildPayloadInputFromInvoice(business, account, invoice)` — приймає 3 параметри замість 2.
- 🔲 `apps/api/src/modules/invoices/invoice-slug-generator.service.ts`: input `accountId` замість `businessId`; aggregation filter відповідно.
- 🔲 Cascade-tests на `MongoMemoryReplSet`: створити business + 2 account + 5 invoices під кожним → delete business → перевірити 0 documents у всіх 3 collections + 0 counter-doc-ів.

### 9.2 Frontend cabinet — нова матрьошкова навігація

- 🔲 **Вимкнути CTA "Зберегти у кабінет" на лендінгу** — детально у §Скоуп.Frontend перший bullet. У `features/qr-landing-preview/QrLandingResult.tsx` приховати button (Sprint 10 поверне її).
- 🔲 **Bump `STORAGE_VERSION = 1 → 2`** у `apps/web/src/entities/qr-landing-draft/store.ts` — детально у §Скоуп.Frontend другий bullet (defense-in-depth для stale `intent='claim-pending'` у браузерах до-Sprint-9 QA-сесій). Існуючий `migrate`-handler reset-ить state на `INITIAL_STATE` для unknown version. Spec-update у `store.spec.ts`: regression-test, що persisted v1-payload з `intent='claim-pending'` після rehydrate віддає `INITIAL_STATE` (intent='idle', formData={}).
- 🔲 `apps/web/src/app/(protected)/business/[slug]/page.tsx` переписується: видалити **3 секції** (`InvoicesSection`, `InvoicesSettingsSection`, `QrSection`) — деталі і обґрунтування у §Скоуп.Frontend; додати нову `AccountsSection` (cards-list з name + bank label + IBAN-mask + "Видалити" кнопка; bank-label-row conditional на `bankCode !== null` — null-fallback rule §SP-9) + CTA "Додати рахунок". Підсумок: 9 − 3 + 1 = 7 секцій (BasicSection, RequisitesSection, TaxationSection, BanksSection, PublicSection, AccountsSection, DangerSection).
- 🔲 Нова `apps/web/src/app/(protected)/business/[slug]/account/new/page.tsx` — single-form з RHF + Zod.
- 🔲 Нова `apps/web/src/app/(protected)/business/[slug]/account/[accountSlug]/page.tsx` — кабінет account з 6 секціями (BasicSection name + IbanReadonlySection + InvoiceSettingsSection + InvoicesSection + QrSection + DangerSection).
- 🔲 Нова `apps/web/src/app/(protected)/business/[slug]/account/[accountSlug]/invoice/new/page.tsx` — копія Sprint 4 §4.5 form, з backend route ремайнінгом.
- 🔲 Нова `apps/web/src/app/(protected)/business/[slug]/account/[accountSlug]/invoice/[invoiceSlug]/page.tsx` — копія Sprint 4 §4.6 кабінету з breadcrumb.
- 🔲 Видалити старі route-и `/business/[slug]/invoice/new` + `/business/[slug]/invoice/[invoiceSlug]`. Next.js 404.
- 🔲 `features/account-create/` — нова feature з `AccountCreateForm`.
- 🔲 `features/account-edit/` — нова feature з 6 секціями + delete-механіка (детально у Скоуп.Frontend).
- 🔲 `features/business-edit/` — `RequisitesSection` спрощується (тільки taxId, видалити iban). Додатково `business-edit/` отримує `AccountsSection`-filter-консумента (на business-cabinet-page, optimistic-removal patern).
- 🔲 `features/invoices/` — **папка повністю видаляється**: всі компоненти move-аються у `features/account-edit/` (з адаптацією `getByBusinessId` → `getByAccountId`).
- 🔲 `features/business-wizard/` — draft shape + mapping + persist version міняються синхронно (детально §Скоуп.Frontend).
- 🔲 `shared/api/accounts.ts` — typed-helpers для cabinet API.
- 🔲 Tests: spec-и на форму account-create (validation), account-page (render всіх 6 секцій), business-page без інвойсів (regression test).

### 9.3 Frontend public — list-view, per-account, інвойс під account

- 🔲 `apps/web/src/app/host-pay/[slug]/page.tsx` Server Component переписується: fetch public-business-view → switch on `accounts.length`:
    - 0 → render empty-state component.
    - 1 → `redirect('/{slug}/{accounts[0].slug}')` (Next.js helper, що віддає **307 Temporary**; §SP-4 чому навмисно НЕ 308).
    - 2+ → render `<PublicAccountListView />` (cards).
- 🔲 Новий `apps/web/src/app/host-pay/[slug]/[accountSlug]/page.tsx` — Server Component для per-account вивіски. Defense-in-depth host-check + canonical-slug-redirect (308 для business-slug case-mismatch). Fetch public-account-view → render `<PublicAccountView>`.
- 🔲 Перенесення `apps/web/src/app/host-pay/[slug]/[invoiceSlug]/page.tsx` → `apps/web/src/app/host-pay/[slug]/[accountSlug]/[invoiceSlug]/page.tsx`. Fetch public-invoice-view (тепер містить `account` context) → render `<InvoicePublicView>`.
- 🔲 `apps/web/src/middleware.ts` рефакторинг:
    - Branch A2 семантика змінюється: був invoice-URL; стає account-URL.
    - Новий Branch A3 для 3-segment path.
    - Reserved-check тільки на businessSlug у обох branch-ах.
    - **Branch A1** додатково ставить `Cache-Control: no-store, no-cache, must-revalidate` (defense-in-depth для CDN/proxy-шару проти 1→2-Account redirect-flip).
- 🔲 `features/business-public/PublicBusinessView` переписується: був full-payment view; стає cards-list-view (для 2+ account) + empty-state (для 0).
- 🔲 Новий `features/account-public/` — `PublicAccountView` (повний payment view як був Sprint 3, але reads з `PublicAccountSchema`), `loadPublicAccountView` helper.
- 🔲 `features/invoice-public/InvoicePublicView` оновлюється: heading включає "{account.name}" як sub-info.
- 🔲 Tests: middleware spec-и на 1/2/3-segment routing. Server Component spec-и на 0/1/2+ account branching у `host-pay/[slug]/page.tsx`. Public-API spec-и на whitelist-полів (regression на leak).

### 9.4 Cross-cutting docs

- 🔲 `CLAUDE.md`:
    - Domain Model — додати `Account` як третю сутність; описати поля.
    - Domain Model — `Business` рефакторинг: видалити `requisites`, додати top-level `taxId`, видалити `invoiceSlugPresetDefault`.
    - Domain Model — `Invoice` рефакторинг: додати `accountId`; нова compound-unique `(accountId, slug)`.
    - Module Dependency Map — додати `AccountsModule` як новий peer.
    - API Overview — нова таблиця для `AccountsController` + `PublicAccountsController`; оновити Invoice URL-и (3-сегментний public).
    - Known Complexities — нові пункти: "Account.iban immutable", "Account.bankCode stored derived value (§SP-9)", "Account-slug case-sensitive як invoice-slug (§SP-10)", "Invoice.businessId denormalized для прямого cascade-delete-business + аналітики", "Account delete консервативний (0 invoices preflight)", "Invoice nested під account: compound-unique (accountId, slug)", "Public matрьошкова URL-структура з 307 redirect-at-1 (§SP-4)".
- 🔲 `docs/product/business-flow.md`:
    - §3 (сутність "Бізнес") — додати схематичний скелет `Business → Account[] → Invoice[]`.
    - §4 (унікальна сторінка бізнесу) — переписати: тепер бізнес має корінь зі списком account; vanity-slug тільки для business-slug.
    - §5 (публічна сторінка для клієнта) — оновити: клієнт обирає рахунок зі списку (для 2+) або одразу бачить per-account (для 1).
- 🔲 `docs/product/qr-decisions.md`:
    - Новий §1.14 "Banking Accounts — закрито у Sprint 9" з посиланням на цей README.
    - §1.3 (ієрархія) — оновити: тепер 3-рівнева (Business → Account → Invoice), не 2-рівнева.
- 🔲 `docs/product/tech-backlog.md` — додати ticket "Account.providerLink для Phase 1.5 Mono Acquiring API integration" (low priority).
- 🔲 `docs/manual-checks/README.md` — нові пункти для UAT:
    - **ACC-1 — Створення першого Account.** ФОП після створення Business потрапляє на `/business/{slug}` з empty-state. Тиснe "Додати рахунок" → форма з одним полем IBAN. Вводить валідний IBAN → submit → потрапляє на `/business/{slug}/account/{accountSlug}` з QR-картинкою. Перевірка: name auto-generated коректно з МФО (наприклад "ПриватБанк •2580").
    - **ACC-2 — Public root з 1 Account + кеш-семантика.** Відкрити `pay.finly.com.ua/{businessSlug}` у incognito → URL у браузері змінюється (**307 Temporary Redirect**) на `/{businessSlug}/{accountSlug}`. QR і кнопки видимі. Після цього у тій самій сесії браузера (БЕЗ закриття вкладки) додати в кабінеті 2-й рахунок → знову відкрити `pay.finly.com.ua/{businessSlug}` → побачити **список з 2 карток** (а не застряти на старій per-account-вивісці). Це валідація проти браузерного 308-кешу quirk-у.
    - **ACC-3 — Public root з 2+ Account + sort-порядок.** Створити business з 3 account-ами у порядку: Privat (першим), Mono (другим), Sense (третім). Відкрити `pay.finly.com.ua/{businessSlug}` → бачимо список з 3 карток у порядку Privat → Mono → Sense (asc-by-createdAt). Tap картки → перехід на per-account з QR. Перевірка стабільності: додати 4-й account → знову відкрити public-root → Privat-Mono-Sense зверху лишилися на тих самих позиціях.
    - **ACC-4 — Account delete заборона.** Створити account, виставити 1 invoice, спробувати видалити account → побачити повідомлення "Цей рахунок має 1 виставлений інвойс. Спочатку видаліть його або весь бізнес".
    - **ACC-5 — Cascade-delete business.** Бізнес з 2 account, на кожному 3 invoices → delete business → toast "Видалено бізнес, 2 рахунки і 6 інвойсів". Перевірка: на staging-БД 0 документів у Account / Invoice / InvoiceSlugCounter колекціях для цього businessId.
    - **ACC-6 — Інвойс per-account нумерація.** Бізнес з Privat і Mono. Виставити 3 інвойси через Privat (preset simple) → побачити inv-001, inv-002, inv-003. Виставити 2 через Mono → побачити inv-001, inv-002. Перевірка: counter не shared між account-ами.
    - **ACC-7 — Null-bankCode UI-fallback (§SP-9 4-точковий invariant).** Створити Account з валідним UA-IBAN, у якого МФО **відсутній у `BANK_MFO_MAP`** (наприклад, дрібний регіональний банк або тестовий валідний-за-checksum IBAN з МФО, навмисно не доданим у мапу). Очікування у **4 UI-точках**: (1) **cabinet `AccountsSection` card** на `/business/{slug}` — картка показує `name + IBAN-mask` **без bank-label-row**; auto-default name = `"Банк •{last4}"`. (2) **cabinet `BasicSection`** на `/business/{slug}/account/{accountSlug}` — name inline-edit + IBAN-mask **без bank-label-row** під ним. (3) **public list-card** на `pay.finly.com.ua/{businessSlug}` (з 2+ Account, де хоча б один — null-bankCode) — картка симетрично cabinet-у: `name + IBAN-mask`, **без bank-label**. (4) **public per-account heading** на `pay.finly.com.ua/{businessSlug}/{accountSlug}` — `"Платіж на користь {business.name} через {account.name} (•{last4})"` — `{BANK_LABEL[bankCode]}`-prefix дроп-нутий, `•{last4}`-postfix unconditional. Перевірка через DevTools: жодний `<img>` чи `<span>` з bank-логотипом/label-ом не присутній у DOM (а не схований CSS-ом).

---

## Risks / Known Complexities

- **Ризик 1 — точний реєстр МФО для 10 банків.** МФО може мінятись (банк змінив корпоративну структуру). Mitigation: усі 10 МФО verified 2026-05-11 через bank.gov.ua + minfin + офіційні сайти банків (closure-нота у `bank-mfo.ts`). На unknown МФО — graceful fallback "Банк •last4" (не throw). Tech-backlog ticket "Quarterly NBU MFO registry sync". **SportBank прибрано** з MVP_BANKS у тому ж комміті, що верифікація — проєкт закрито 06.05.2024 (Таскомбанк припинив розвиток); клієнти переведені у ТАСКОМБАНК; колишній SportBank-IBAN тепер автодетектиться як `izibank` (один МФО 339500 на обидва Таскомбанк-продукти).
- **Ризик 2 — middleware Branch A2 семантичний flip.** Sprint 4 §4.7 інтерпретував `/{biz}/{inv}` як invoice-URL. Sprint 9 інтерпретує той самий path як account-URL. Якщо у dev-environment-i у когось є старі тестові інвойсні посилання — вони "вкажуть" на account, не на invoice. На staging — 404. Не блокер для prod. Mitigation: `dropDatabase` на dev перед тестуванням Sprint 9.
- **Ризик 3 — InvoiceSlugCounter cascade при delete-account.** Sprint 4 заклав `InvoiceSlugCounter` collection per-(businessId, scope). Sprint 9 ремайнить на per-(accountId, scope). Cascade-delete account мусить чистити counter-doc-и того account; cascade-delete business — counter-doc-и всіх account-ів цього business. Якщо забути — counter-doc-и orphan'ять у БД. Mitigation: явні test-кейси для обох cascade-flow.
- **Ризик 4 — Public-API breaking change.** `GET /businesses/public/:slug` повертає інший shape (без `nbuLinks`, з `accounts: []`). Якщо у Sprint 8 anon-flow або у third-party integration хтось залежить від старого shape — зламається. Перевірити — у Sprint 8 anon-flow `publicFetchJson` так не робить (лендінг не fetch-ає public-business). Третіх-партійних поки немає. Безпечно.
- **Ризик 5 — discriminated-union у `CreateBusinessSchema` після видалення `iban`.** Sprint 7 §SP-3 закладено per-variant `requisites` shape з різним taxId-валідатором. Sprint 9 робить рефакторинг: `requisites` зникає, `taxId` стає top-level. Mitigation: явні positive/negative тести на 4 type-variants × valid/invalid taxId.
- **Ризик 6 — `payeeSnapshot.iban` legacy fallback.** Sprint 4 review fix додав legacy-fallback на live business для invoice-ів без snapshot. Sprint 9 змінює: тепер snapshot.iban — з Account, fallback — на live Account через invoice.accountId. Legacy invoices без snapshot — теоретично можливі у dev-environment-i. Mitigation: фіксуємо як non-issue (production-data немає; на dev — dropDatabase).
- **Ризик 7 — UX-плутанина для ФОП з 1 рахунком.** ФОП заходить у кабінет → бачить тільки список account-ів, не інвойсів напряму. Один зайвий тап перш ніж потрапити до інвойсів. Це навмисний design (A6 матрьошка), але треба переконатися: counter "{N} рахунків" + "{M} інвойсів усього" на бізнес-картці у `/business`-list — щоб ФОП розумів обсяг навіть без drill-down.
- **Ризик 8 — `bankCodeFromIban` regex/parse неправильно для нестандартних IBAN.** UA IBAN має 29 символів; helper парсить 5-10 символи як МФО. Якщо хтось вводить EU-IBAN (нашій формі неможливо — `ibanZod` Sprint 1 валідує тільки UA-prefix) — нестрашно. Edge-case: дуже короткий рядок до парсингу — повертати null safely (не throw). Tests purpose-built на edge cases.
- **Ризик 9 — Лендінг без CTA "Зберегти у кабінет" між Sprint 9 і Sprint 10 deploy.** Detali у §НЕ-скоуп. Якщо production traffic зʼявиться у це window — user-facing-регресія. Mitigation: production traffic відсутній на момент планування (вступний контракт `Production-data ще немає`). Sprint 10 — direct follow-up без затримок.
- **Ризик 10 — Orphan-Business у БД після abandoned magic-link claim** — поточний Sprint 8 уже має цей edge-case, але Sprint 9 не змінює його scope. Closed-by-design у Sprint 11 (deep-link recovery) + Sprint 12 (cron-cleanup). Sprint 9 створює інфраструктуру (Account-сутність), яку Sprint 11+12 використовують.
- **Ризик 11 — Stale `intent='claim-pending'` у localStorage браузерів до-Sprint-9 версії.** `useClaimLandingDraft` (sibling до AuthGuard у `(protected)/layout.tsx`, Sprint 8 §8.4) лишається активним у Sprint 9 і fires автоматично за наявності persisted intent. Без mitigation QA-користувач, що до Sprint 9 deploy натиснув CTA → закешував `intent='claim-pending'` + `formData` (старий shape, що проходив `requisites.iban`-Zod) → після Sprint 9 deploy логиниться у cabinet → hook викликає `claimLandingDraftAsBusiness` з пере-`requisites.iban`-body → backend `.strict()` reject-не з 400 → застрягне у `claim-failed` + toast.error на cabinet-land. Production traffic відсутній, але QA/dev-сесії реальні. Mitigation: bump `STORAGE_VERSION = 1 → 2` у `qr-landing-draft/store.ts` (deliverable §9.2 + §Скоуп.Frontend) — існуючий `migrate`-handler reset-ить state на initial для unknown version.

---

## Definition of Done

- ✅ Усі епіки 9.0..9.4 закриті.
- ✅ `pnpm test` зелений по всіх workspace-ах:
    - `@finly/types` — нові spec-и для `account.spec.ts`, `accounts.spec.ts`, `bank-mfo.spec.ts`; усі existing проходять.
    - `apps/api` — нові unit + e2e (AccountsService, AccountAccessGuard, public-accounts-controller, ремайнінг invoices/businesses тестів, cascade-delete розширений на 3 collections).
    - `apps/web` — нові spec-и на account-create / account-edit / account-public / nested cabinet-pages / middleware A2-A3 routing.
- ✅ `pnpm lint` без нових warnings (Sprint 1 baseline 86 існуючих лишається).
- ✅ `pnpm build` всіх workspace-ів success.
- ✅ Smoke-test на staging:
    - Створити Business (тип individual/fop/tov/organization × 4) → empty-state coreня → додати Account → побачити QR → виставити інвойс → public-сторінка інвойсу.
    - Бізнес з 2 Account → public-root показує список → tap картку → per-account з QR.
    - Cascade-delete business з 2 account, 6 invoices → 0 documents усіх 3 collections.
    - Лендінг показує preview-QR без CTA "Зберегти у кабінет" (Sprint 10 поверне).
- ✅ UAT manual-checks ACC-1..6 — статус ⬜ → ✅ або документований negative-result з ticket-ом.
- ✅ `CLAUDE.md` оновлений (Domain Model + Module Map + API Overview + Project Structure + Known Complexities).
- ✅ `docs/product/business-flow.md` оновлений (§3-§5 з 3-рівневою ієрархією).
- ✅ `docs/product/qr-decisions.md` має §1.14 closure-маркер.
- ✅ `docs/product/tech-backlog.md` має low-priority ticket "Account.providerLink for Phase 1.5".
- ✅ `dropDatabase` виконано на staging перед smoke-test (документовано у deployment-нотатках).
