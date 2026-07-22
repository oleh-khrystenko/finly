# Sprint 9 — Планування. Q&A

Робочий простір для обговорення. Питання випишуться upfront, відповіді додаватимуться по ходу діалогу. Вільна форма, не шаблон.

## Що користувач зафіксував у вступному повідомленні

- Поточна модель `Business` плутає юр-особу і банківський рахунок: ФОП з 2 рахунками створює 2 "бізнеси" з однаковим ІПН.
- Розв'язок — 3 сутності замість 2: `Business` (юр-особа: type, name, taxId, taxationSystem, isVatPayer), `Account` (банківський рахунок: iban, paymentPurposeTemplate, acceptedBanks), `Invoice` (рахунок-фактура).
- URL не змінюється: `pay.finly.com.ua/{businessSlug}`. Назва Account в URL не світиться — внутрішня деталь.
- Slug на Business; інвойсний compound-unique `(businessId, slug)` лишається. Invoice додатково `accountId`, щоб знати з якого IBAN робити QR.
- Production-міграція не потрібна — даних ще немає, чисто `dropDatabase`.

## Не вирішено за вступом

- Чи може Business існувати без жодного Account (порожня юр-сутність) vs wizard завжди створює Business + перший Account разом.

## Відкриті питання, які блокують план

Сформулюю всі тут, обговорюватимемо по одному. Деякі — каскадні (відповідь на Q1 змінює Q2 і далі), тому йдемо у строгому порядку.

### Q1. Public-вивіска бізнесу при N рахунках

`pay.finly.com.ua/{businessSlug}` — це сторінка-вивіска, яку ФОП роздає клієнтам без прив'язки до конкретного інвойсу. Зараз показує реквізити одного IBAN (бо в Business один). Якщо у Business 2+ Account — що бачить клієнт?

Варіанти:

- (A) Один Account за замовчуванням (default). Клієнт бачить QR на нього як зараз. Решта рахунків — невидимі публічно.
- (B) Список рахунків з вибором. Клієнт обирає, на який рахунок платити (картки рахунків з іменами / банками).
- (C) На корені — взагалі без QR/реквізитів, тільки заголовок "Платіж на користь {name}" і CTA "Перейти до конкретного рахунку". Реквізити доступні тільки через інвойсний URL.

### Q2. Default-account: як визначається

Якщо обрано варіант (A) для Q1 — як визначається default? Перший створений (за датою) / явно обраний ФОП (поле на Business `defaultAccountId`) / inferred (наприклад "єдиний account → він default")?

### Q3. Account чи може бути взагалі без жодного Account на Business

Користувач сам відмітив це як невирішене. Дві гіпотези:

- (A) Wizard завжди створює Business + перший Account одним flow-ом. Стан "Business без Account" не існує — invariant в БД (ownerless-pattern, що вже є для `managers`).
- (B) Business можна створити без Account як порожню юр-сутність. Account додається пост-onboarding. Між створенням Business і першим Account — public-сторінка показує "ще не налаштовано рахунки".

### Q4. Account має своє ім'я (label) для розпізнавання в кабінеті

ФОП з 2 рахунками — як розрізняє в кабінеті ("Privat бізнес-основний", "Mono ФОП", "Резерв")? Поле:

- (A) Required `name: string` — ФОП мусить дати ім'я кожному account.
- (B) Optional + auto-default з банку IBAN ("ПриватБанк •2580", "Monobank •8104"). ФОП може перейменувати.
- (C) Без імені; в UI показується тільки IBAN-маска і назва банку, виводиться з `iban`-prefix-у.

### Q5. paymentPurposeTemplate — Business-level чи Account-level

Зараз `paymentPurposeTemplate` на Business. Логіка "на що плаття": може бути одне для всього бізнесу ("Оплата за послуги") або різне per-account ("Основний — за послуги", "Резерв — пожертви"). Що ставимо?

- (A) Лишається на Business. Один шаблон на всі рахунки.
- (B) Переїжджає на Account. Per-account шаблон.
- (C) Обидва: default на Business, override на Account (нащаджується).

### Q6. acceptedBanks — Business чи Account

Зараз на Business. Логіка "які банки приймають оплату" може варіюватись per-account (наприклад, для Mono-account показуємо тільки клієнтам з Mono — це дурня; для Privat-account — широкий список). Реальна семантика — це market-positioning бізнесу як цілого, не per-account property.

- (A) Лишається на Business. Один список банків для всіх рахунків.
- (B) Переїжджає на Account. Per-account.
- (C) Default на Business, override на Account.

### Q7. Cascade-delete account: що дозволено

Account має N інвойсів. ФОП тисне "Видалити account":

- (A) Заборонено, поки є інвойси. ФОП мусить видалити інвойси спочатку.
- (B) Дозволено з cascade — інвойси теж видаляються (як зараз для Business).
- (C) Дозволено soft-delete — account ховається з UI, інвойси лишаються addressable за прямим URL.

Окремий sub-case — видалення останнього Account при варіанті Q3-A (Business без Account неможливий): просто заборонено, треба спочатку видалити Business.

### Q8. Account: invoice — обов'язково обирати

ФОП тисне "Виставити рахунок". У бізнесу 2 Account. Як форма поводиться:

- (A) Required dropdown "Рахунок" — ФОП явно обирає на кожен інвойс.
- (B) Default з business.defaultAccountId — pre-filled, але можна змінити.
- (C) Memorize останній використаний у session/localStorage, pre-fill.

### Q9. Wizard: split чи один-flow

Sprint 7 закрив 4-step wizard з 4 типами платників. Тепер додаємо Account. Структурно:

- (A) Один-flow: 4-5 кроків (Type+Name → TaxId → Taxation → Account: IBAN+Banks+Purpose). Не можна стартувати Business без Account. Q3 = (A).
- (B) Split: wizard створює тільки Business (Type+Name+TaxId+Taxation). Перший Account ФОП додає окремою CTA з business-сторінки. Q3 = (B).
- (C) Hybrid: Wizard 1 створює Business; Wizard 2 (continuous flow на success) створює Account; між ними redirect на business-сторінку, де Account-форма preselected. Q3 = (B).

### Q10. Cabinet structure: account як окрема сторінка чи інлайн

Поточна структура: `business/[slug]` — single-scroll з 9 секціями (Sprint 4 §SP-4). Account vs Invoice — як вписуємо:

- (A) Account inline: на сторінці бізнесу секція "Рахунки" з картками; редагування — accordion / inline-edit (як секції зараз). Без окремих route-ів.
- (B) Account окрема сторінка: `/business/[slug]/account/[accountId]`. На бізнес-сторінці — список-CTA. Інвойси теж per-account (URL-вкладений).
- (C) Account inline для редагування, але інвойсний flow знає account через invoice.accountId, не через URL.

### Q11. Invoice list — per-account чи всі разом

Зараз "Рахунки" (інвойси) — одна секція на бізнес-сторінці. При двох Account:

- (A) Один список, кожен інвойс show "→ Account name" як sub-info.
- (B) Список фільтрується dropdown-ом "Рахунок" (Всі / Account-1 / Account-2).
- (C) Список per-account — кожен Account має свою таблицю інвойсів.

### Q12. Account: edit IBAN можна чи immutable

Sprint 7 зробив `Business.type` immutable. Що з Account.iban — чи можна редагувати?

- (A) Immutable. Помилка → видалити Account, створити новий.
- (B) Editable. payeeSnapshot на старих інвойсах все одно frozen (Sprint 4 review fix), тож зміна IBAN не торкає історичних рахунків.
- (C) Editable, але якщо є активні (не expired) інвойси — confirm-warning.

### Q13. Account name (label) в URL чи API

Підтвердив: на public-зоні URL `pay.finly.com.ua/{businessSlug}/{invoiceSlug}` — Account невидимий. Cabinet URL `/business/{slug}/account/{accountId-or-slug}` — як ідентифікуємо account у URL?

- (A) ObjectId (`account/64f...`).
- (B) Account-slug auto-generated 8-char alphanum (як Business).
- (C) Account-slug human-readable (slugified `name` за варіантом Q4).

(Доречно тільки якщо Q10 = B.)

### Q14. Wizard для Sprint 8 anonymous landing — як зачіпається

Sprint 8 закрив anon `POST /qr/preview` без БД. Anon вводить IBAN + ІПН + назва + purpose → отримує QR. Натискає "Зберегти у кабінет" → claim flow. Зараз `claimLandingDraftAsBusiness` створює Business з усіма цими полями + accountFields суміщені.

При новій моделі:

- (A) Claim створює Business (type=individual, taxId, name) + перший Account (iban, paymentPurposeTemplate, acceptedBanks=всі) одним POST.
- (B) Claim створює тільки Business; ФОП окремо додає Account на пост-claim сторінці (UX-збій, бо anon очікує одразу побачити готовий QR у кабінеті).

Реальна відповідь зав'язана на Q9.

### Q15. Account має taxationSystem/isVatPayer? (підтвердження)

Очевидна відповідь — НІ, ці поля живуть на Business (це юр-property платника, не банківського рахунку). Питання для підтвердження: чи погоджуємось?

### Q16. Phase 1.5+ — Account як точка приєднання трекінгу оплат (Модель Б)

`qr-decisions.md` §1.12 фіксує Phase 1.5+ як потенційний crossover у Модель Б ("трекінг оплат через інтеграції з банками"). У Моделі Б точкою інтеграції з банком стає саме Account (Mono-account → Mono Acquiring API), не Business. Чи закладаємо вже зараз архітектурну точку розширення (наприклад, поле `Account.providerLink: { provider, providerAccountId }` як placeholder) — або відкладаємо повністю до Phase 1.5?

Якщо відкладаємо — добре, Account-схема лишається мінімальною. Якщо закладаємо — це нульовий cost у Sprint 9 і знімає одну майбутню міграцію.

---

## Журнал відповідей

### A8 — Sprint 8 anon-claim flow + magic link

**Обрано: 2 sequential POST з form-recovery; Redis-draft для magic link з shared TTL.**

**2 sequential claim:** на "Зберегти у кабінет" web робить 2 послідовних запити: `POST /businesses/me` (Business) → `POST /businesses/me/{slug}/accounts` (Account). Між ними — failover-window. Атомарності навмисно немає, бо стан "Business без Account" валідний (A2).

**Form-recovery patern:**

- Failure першого запиту (Business): нічого не створено → web редіректить на `/business/new` (wizard) з pre-filled даними з draft-у. Помилка показується inline на формі через `mapApiCode`.
- Failure другого запиту (Account): Business створено → web редіректить на `/business/{slug}/account/new` з pre-filled IBAN. Один тап submit — готово. Помилка — inline.
- Draft у localStorage **не видаляється** до моменту, коли і Business, і Account збережені у БД. Чиститься тільки після success обох.

**Magic link через Redis-draft:**

- При `POST /auth/magic-link/send` web додатково передає optional `landingDraft: { iban, taxId, name, purpose }` у тіло.
- Бек зберігає draft **усередині того самого Redis-record-у, що тримає magic-link-token state**: ключ `magic-link:{tokenId}` → JSON з optional sub-полем `landingDraft`. Один Redis-record, один TTL = `AUTH_MAGIC_LINK_TTL_MIN`.
- Magic-link URL у листі — без даних: тільки token-id. IBAN/ІПН не світяться у email-логах, browser-history, referer.
- На `POST /auth/magic-link/verify` бек дістає draft із record-у і виконує той самий 2 sequential claim. На фейл — той самий form-recovery (redirect на /business/new або /business/{slug}/account/new з pre-filled).

**Альтернативи відкинуто:**

- JWT-encoded payload у URL: privacy-leak через email-логи / browser-history; JWT base64-decode-ується без ключа.
- Окремий Redis-key для draft з власним TTL: ризик drift-у двох констант expiration; одна point-of-truth краща.
- Тільки Google OAuth для anon-claim: обмежує користувачів без Google-акаунта.

### A7 — Нумерація інвойсів per-account

**Обрано: окрема нумерація для кожного рахунку.**

- Privat-рахунок має свою послідовність inv-001..N; Mono-рахунок — теж окрему inv-001..M. Колізії немає, бо namespace — account-level.
- **Schema:** Invoice compound-unique `(accountId, slug)` замість поточного `(businessId, slug)`. partial-unique counter-index теж переходить: `(accountId, slugCounterScope, slugCounter)` замість `(businessId, ...)`.
- **`invoiceSlugPresetDefault` переїжджає з Business на Account.** Кожен рахунок має свій default preset (Privat — "З місяцем" для бух-звітності; Mono — "Простий" для особистих).
- **Slug-counter aggregation** ($MAX(N)+1) — фільтр стає `{ accountId, slugCounterScope }` замість `{ businessId, slugCounterScope }`.
- **Public URL інвойсу** — 3-сегментний `pay.finly.com.ua/{businessSlug}/{accountSlug}/{invoiceSlug}`. Матрьошка дзеркало cabinet `/business/{slug}/account/{accountSlug}/invoice/{invoiceSlug}`.
- **Middleware host-aware routing** — додається branch для 3-сегментного path (поряд з існуючими A1 1-segment + A2 2-segment Sprint 4). 2-сегментний `/{businessSlug}/{accountSlug}` лишається — це per-account вивіска.
- **InvoiceSlugGeneratorService** ремайнінг — приймає `accountId`, не `businessId`.

### A6 — Матрьошкова навігація

**Обрано: nested cabinet structure.** Інвойс живе **під рахунком**, не "під бізнесом разом з рахунком".

- `/business/[slug]` — кабінет бізнесу. Список Account-карток. CTA — тільки "Додати рахунок". Жодних згадок про інвойси на цьому рівні.
- `/business/[slug]/account/[accountSlug]` — кабінет рахунку. Список інвойсів цього рахунку. CTA "Виставити рахунок". Налаштування Account (name, видалити).
- `/business/[slug]/account/[accountSlug]/invoice/[invoiceSlug]` — кабінет одного інвойсу.

Наслідки:

- **Sprint 4 §SP-4 структура (9 секцій з "Налаштування рахунків" + "Рахунки" як перелік інвойсів) переписується.** Список інвойсів і `invoiceSlugPresetDefault` переїжджають на account-page. Бізнес-сторінка стає коротшою (тільки юр-секції + список account).
- **Public-зона теж матрьошкова** (1:1 з cabinet, природне дзеркало): кореневий URL → список account → per-account вивіска → invoice. Public URL інвойсу стає 3-сегментним (детально — наступне питання).
- **Compound-unique invoice-slug.** Зараз `(businessId, slug)`. При матрьошці природно стає `(accountId, slug)` — кожен Account має свій namespace для invoice-slug. ФОП у Privat бачить inv-001/inv-002; у Mono — теж inv-001/inv-002 без колізії. Це теж буде наступним питанням.

### A5 — IBAN immutable + delete-Account з 0 інвойсів

**Обрано: IBAN immutable; delete заборонений якщо ≥1 інвойс під рахунком.**

- IBAN не редагується після створення Account. Те саме рішення, що Sprint 7 §SP-8 для `Business.type` (immutable post-creation).
- При помилці у IBAN — ФОП видаляє рахунок (якщо ще немає інвойсів) і створює новий правильний.
- Delete Account: pre-check `Invoice.countDocuments({ accountId })`. Якщо > 0 — `409 ACCOUNT_HAS_INVOICES` з прозорим UA-message ("Цей рахунок має N виставлених інвойсів. Спочатку видаліть їх або видаліть бізнес повністю").
- На відміну від Business cascade-delete (Sprint 4 §SP-5, де всі інвойси видаляються атомарно): для Account cascade свідомо НЕ робимо. Account-delete — точкова операція, ФОП явно вирішує доля інвойсів.
- Cascade Business-delete продовжує працювати як зараз: видаляє всі Account + всі invoices атомарно у одній транзакції. Account не блокує delete бізнесу.

### A4 — Account label

**Обрано: Auto-default + override.**

- На write — `name: string | undefined`. Backend, якщо undefined, генерує `'{BANK_LABEL_BY_PREFIX[mfoFromIban]} •{ibanLast4}'` (наприклад "ПриватБанк •2580").
- На PATCH — ФОП міняє на власне ім'я ("Основний", "Резерв", "Mono ФОП").
- В БД зберігається як string (NOT NULL); auto-default матеріалізований одразу при write, не resolve-ить runtime — щоб клієнтський рендер public-картки не залежав від поточного MFO-mapping-у (та сама logic як payeeSnapshot Sprint 4).
- Sprint 8 anon-claim не вводить name → backend auto-generate. Лендінг лишається з 4 полями.

Залежність: знадобиться **`BANK_LABEL_BY_MFO`-мапа** для всіх 11 банків — статична таблиця у `@finly/types/constants/banks.ts` (MFO → BankCode + display label). Перевірити, чи `MVP_BANKS`-константа вже містить MFO як sub-property (швидкий read-task під час §scoring у плані).

### A2 — Edge cases та Account-без-Business-запитання

**Обрано: 0 Account дозволено · 1 Account 307-redirect на per-account-URL.**

> **Оновлено пост-Q&A** (під час scoring у README §SP-4): redirect-status переключений з 308 на **307 Temporary Redirect** і URL-структура спрощена з `/{businessSlug}/account/{accountSlug}` на матрьошку `/{businessSlug}/{accountSlug}` (без `/account/`-prefix-у — frontend-public-URL дзеркалить cabinet матрьошку, але без segment-роздільника). Rationale переключення на 307 — Chrome агресивно in-memory-кешує 308 на всю сесію навіть з `Cache-Control: no-cache`, що ламає flow "додав 2-й account → redirect-flip" (детально README §SP-4). Архітектурне рішення матрьошкової URL без `/account/`-prefix — у §A6 нижче (cabinet) + §A7 (public 3-сегментний invoice-URL).

Каскадні наслідки:

- **Q3 закрито = (B):** Business може існувати без Account як порожня юр-сутність.
- **Q9 фактично закрито = (B):** Wizard split. Wizard створює Business самостійно (Sprint 7 wizard 3-4 кроки за `type`); Account додається окремою формою на бізнес-сторінці пост-onboarding.
- **Public empty-state на корені:** новий UI — заголовок "Платіж на користь {name}" + блок "Власник ще не налаштував рахунки для прийому оплати". Без QR, без CTA на банк.
- **Public 1-Account redirect:** 307 з `pay.finly.com.ua/{businessSlug}` → `pay.finly.com.ua/{businessSlug}/{accountSlug}` (матрьошка без `/account/`-prefix per §A6/§A7-fix вище). Сам redirect — на host-pay Server Component layer (Next.js `redirect()` helper, що віддає 307; `permanentRedirect()` / 308 свідомо НЕ використовується через Chrome 308 in-memory-кеш-quirk — детально README §SP-4). Browser-кеш 307 без явних cache-directives — undefined-behavior на edge-провайдерах (Cloudflare/Vercel default — не кешується); defense-in-depth `Cache-Control: no-store, no-cache, must-revalidate` ставиться у middleware Branch A1 на rewrite-response для 0-Account і 2+ Account branches (для 1-Account branch-у `redirect()` створює standalone-response без middleware-headers — деталі trade-off у README §SP-4 scope-обмеження).
- **Cascade-delete Account:** видалення останнього дозволено (Business лишається без Account, валідний стан). Окремо обмежень "не видаляй останній" немає.
- **Sprint 8 claim-flow:** anon вводить IBAN+ІПН+name+purpose. На claim — два sequential POST: `POST /businesses/me` (тільки Business: type=individual + name + taxId) → `POST /businesses/me/{slug}/accounts` (тільки Account: iban + purpose + banks). Між ними web-side у claim-hook-у. Атомарності не потребуємо — orphan-Business без Account валідний (empty-state). Failed second-call → залишився Business з empty-state, користувач може дозаповнити вручну.

### A1 — Public-вивіска

**Обрано: (B) Список рахунків — клієнт обирає.**

> **Оновлено пост-Q&A** (фіналізовано у §A6 матрьошка + §A7 invoice-URL 3-сегментний нижче): public-URL per-account живе як **`pay.finly.com.ua/{businessSlug}/{accountSlug}` без `/account/`-prefix-у** (матрьошка дзеркалить cabinet `business/[slug]/account/[accountSlug]`, але public middleware-rewrite-ить 2-сегментний path напряму у `host-pay/[slug]/[accountSlug]/page.tsx` — Branch A2 семантика). Backend endpoint `/businesses/public/:slug/account/:accountSlug` зберігається з `/account/`-prefix-ом — це різні layer-и (frontend public-URL ≠ backend API-route). Invoice-URL **став 3-сегментним** `/{businessSlug}/{accountSlug}/{invoiceSlug}` (раніше тут писалося "без зміни 2-сегментне" — це було помилковим припущенням, переоцінено у §A7 коли стало ясно, що account має бути на public-зоні явно для cascade-семантики).

Наслідки для архітектури:

- Новий URL-сегмент `pay.finly.com.ua/{businessSlug}/{accountSlug}` (без `/account/`-prefix) для per-account-вивіски. На корені бізнесу — лише список карток рахунків з заголовком "Платіж на користь {name}".
- Account мусить мати свій slug/identifier для URL. Користувач у вступі казав "назва рахунку в URL не світиться" — отже identifier ≠ human name; ймовірно random 8-char tail (як Business). Підтверджено у §A7: account-slug — system-generated 8-char alphanum, case-sensitive (модель Sprint 4 invoice-slug §SP-8, не Sprint 3 business-slug — детально README §SP-10).
- Cabinet-зона теж розкладається: `business/[slug]/account/[accountSlug]` — окрема сторінка налаштування рахунку.
- Public-API розширюється: `GET /businesses/public/:slug` повертає список рахунків (whitelist полів — name + bank + IBAN-mask + slug); `GET /businesses/public/:slug/account/:accountSlug` — per-account view (із nbuLinks + QR + ibanMask для null-bankCode-disambiguation per README §SP-9).
- Invoice public-URL **став 3-сегментним** `pay.finly.com.ua/{businessSlug}/{accountSlug}/{invoiceSlug}` (матрьошка з §A7; account-segment явний у URL, не резолвиться через `invoice.accountId` на server-side). Middleware Branch A3 додається для 3-сегментного path.
- `PublicBusinessSchema` whitelist розширюється: `accounts: Array<{name, bankCode, ibanMask, slug}>` замість поточного `nbuLinks`.

Каскадні наслідки на інші питання:

- Q2 (default-account) — стає менш критичним для public (клієнт обирає сам), але ще релевантний для invoice creation (Q8) і Sprint 8 anon-claim (Q14).
- Q4 (account name) — тепер UX-важливе: name видимий клієнту на корені, не тільки ФОП у кабінеті. Required.
