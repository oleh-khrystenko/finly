# Sprint 4 — Інвойси під бізнесом

> **Статус (на 2026-05-04):** заплановано, **не стартував**.
> **Передумови:** Sprint 1 (схема `Invoice` + slug-preset enum + Mongo-індекси), Sprint 2 (QR-payload-builder приймає `amountKopecks`, `fieldLockMask`, `validUntil`), Sprint 3 (cabinet flow, `BusinessAccessGuard`, `SlugGeneratorService`, host-aware routing, `PublicBusinessesController`, `EditableField`, `scheduleDeleteWithUndo`) — **повністю закриті**, окрім UAT-прогону. UAT-блокером для Sprint 4 не є — він про регресію live-банків, не про backend-контракти.
> **Що розблокує:** Sprint 5 (per-bank deep-links на public-сторінці інвойсу — на готовому payload з фіксованою сумою/lock-mask), Sprint 6 (Free vs Paid гейти; зокрема — потенційний ліміт на кількість активних інвойсів і paid-фічі типу masовий експорт).
> **Контекст рішень:** усі продуктові розв'язки виросли з [`docs/product/qr-decisions.md`](../../product/qr-decisions.md) §1.3, §1.4, §1.5, §1.6, §1.12, §4.1, §4.3, §4.3.1, §4.3.1.1, §4.3.2, §4.3.3, §4.6 і Sprint 1 §1.3. README не дублює rationale — лише імплементаційну механіку і **закриває** open-questions §2.3 / §4.3.2 / §4.3.3 / §4.6 явно.

---

## Мета

Закрити продуктовий цикл "ФОП виставляє рахунок клієнту":

1. **ФОП із кабінету бізнесу натискає «Виставити рахунок» → форма (3-4 поля) → отримує URL `pay.finly.com.ua/{business-slug}/{invoice-slug}` + QR.**
2. **Клієнт відкриває посилання → бачить **інвойсну вивіску** (та сама сітка 11 банків + 2 кнопки + 2 QR, що Sprint 3, але payload містить суму, lock-mask і термін дії).**
3. **ФОП у кабінеті інвойсу редагує суму / призначення / термін дії, видаляє з 5s-Undo, бачить статус «прострочено» якщо `validUntil < now`.**

Sprint 4 НЕ закладає трекінг оплат (Модель А, qr-decisions §1.12 — це Phase 1.5+). Sprint 4 — це **«Sprint 3 для інвойсу»**: повторний flow, повторні primitive (slug-генератор, BusinessAccessGuard, EditableField, scheduleDeleteWithUndo), новий payload + новий route-сегмент.

---

## Скоуп

### Backend (`apps/api`)

- 🔲 `InvoicesModule` отримує controller + service + DTO + invoice-slug-генератор + `InvoiceAccessGuard` (тонкий guard, що **читає вже attach-нутий до request `business`** — без повторного lookup-у).
- 🔲 Cabinet endpoints під префіксом `/businesses/me/:slug/invoices/:invoiceSlug` (CRUD: list, create, get, patch, delete). **Route-param бізнесу — навмисно `:slug`** (а не `:businessSlug`) — консистентність з Sprint 3 `BusinessAccessGuard` (`apps/api/src/modules/businesses/business-access.guard.ts:54`), що читає `request.params.slug` hardcoded. Перейменування route-param-у обов'язково потребувало б configurable factory-guard заради одного call-site — overkill. Invoice slug — `:invoiceSlug` (різний name от business slug-у — щоб NestJS не плутав і `InvoiceAccessGuard` мав окремий ключ для read-у). Slug — primary route-param обом сегментам, без `:id`.
- 🔲 Public endpoints у новому `PublicInvoicesController` (`/businesses/public/:slug/invoices/:invoiceSlug` + `/qr/business.png` + `/qr/nbu.png?host=primary|legacy`). Та сама причина для `:slug` (а не `:businessSlug`) — Sprint 3 `PublicBusinessesController` уже використовує `:slug` як business-slug param.
- 🔲 Розширення `BusinessesService.delete` на cascade hard-delete інвойсів **виключно у Mongo `withTransaction`-сесії** (atomic-or-nothing). На середовищі без replica-set операція **fail-fast 500 `CASCADE_DELETE_REQUIRES_REPLICA_SET`** — жодного delete не виконуємо, ніяких orphan-invoices не дозволяємо (детально — рішення SP-5 нижче).
- 🔲 Розширення `BusinessesController.delete` confirm-payload-у: response повинна містити `affectedInvoices: number` (counter перед видаленням), щоб frontend міг показати warning у toast («Видалено бізнес і 3 рахунки»).
- 🔲 Payload-mapper для інвойсу: окремий helper `buildPayloadInputFromInvoice(business, invoice)` у `apps/api/src/modules/invoices/payload-mapper.ts`. Маппить:
    - `receiverName, iban, receiverTaxId` ← з `business`.
    - `purpose` ← `effectiveInvoicePurpose(invoice, business)` (з нового `apps/api/src/modules/invoices/purpose-resolver.ts`). **Той самий resolver** використовує `InvoiceSlugGeneratorService` для `with-purpose`-пресета — щоб NBU payload і slug ніколи не розходились на inheritance-rule "якщо `invoice.paymentPurpose === null` → `business.paymentPurposeTemplate`".
    - `amountKopecks` ← `invoice.amount` (`null` валідно — клієнт сам введе суму у банку, режим qr-decisions §1.4 «вивіска у межах інвойсу»).
    - `fieldLockMask` ← `invoice.amountLocked ? 'FFFF' : 'FEFF'` (норматив: FEFF дозволяє правити лише поле 8 «Сума»; FFFF — все заборонено; всі інші біти 1–5, 11, 14–17 завжди locked — `PayloadInputSchema` enforce-ить).
    - `validUntil` ← `invoice.validUntil` сконвертований у `YYMMDDHHmmss` через спільний util `formatYymmddhhmmss` у `packages/types/src/qr/datetime.ts` (новий файл; const-time deterministic, без timezone-conversions — тримаємо локальний український час як-є, бо норматив не уточнює tz і всі ринкові додатки інтерпретують саме так).
- 🔲 Cron-аспект (опційно, поза critical path) — placeholder для майбутнього "expired invoices cleanup" **не пишемо**. Sprint 1 виставив `{ validUntil: 1, sparse: true }` index — Phase 1.5+ підбере, у Sprint 4 не використовується.

### Frontend (`apps/web`)

- 🔲 На сторінці бізнесу `/business/[slug]` (Sprint 3 §3.8) — нова **секція "Рахунки"** з overview-списком інвойсів (картки з amount/status/createdAt) + CTA "Виставити рахунок" (рішення Q4.6 нижче).
- 🔲 На тій же сторінці бізнесу — **секція "Налаштування рахунків"** (нова `business-edit/InvoicesSettingsSection.tsx`) з одним полем — dropdown "Дефолт для нових рахунків" (мапить на `Business.invoiceSlugPresetDefault`). Inline-edit per Sprint 3 patern через існуючий `EditableField`. **5 опцій dropdown-у** (`null` + 4 пресети — навмисно без `'random'`-варіанту; якщо ФОП хоче random URL — обирає його вручну у form-dropdown-у при створенні інвойсу): "Не визначено (за замовчуванням — простий номер)" → `null`, "Простий номер" → `simple`, "З місяцем" → `with-month`, "З роком" → `with-year`, "З призначення" → `with-purpose` (**вибір цієї опції тригерить ту саму `useSlugPresetWarningStore` confirmation-модалку**, що §4.5; raison-d'être один — privacy-risk незалежний від UI-місця, де ФОП обирає пресет). Збереження → PATCH `/businesses/me/{slug} { invoiceSlugPresetDefault: ... }` через існуючий update-flow. Підпис нижче "Цей варіант буде обраний за замовчуванням, коли ви натискатимете «Виставити рахунок»". **Семантика `null`**: "не визначено / використати глобальний дефолт системи". Глобальний дефолт = `simple` (єдине джерело правди — fallback `?? 'simple'` у формі створення §4.5). Бізнес-level "запам'ятати random як дефолт" свідомо out-of-MVP (рідкий UX-кейс; розширення `SLUG_PRESETS` на `'random'` зламає Sprint 1 `Invoice.slugPreset` analytics-семантику, де `null` означає "генератор не використав пресет" — overengineering для рідкого кейсу).
- 🔲 Окрема cabinet route `business/[slug]/invoice/new` — single-form (рішення SP-9: 4–5 полів природно групуються на одному екрані без wizard-а; деталі — §4.5).
- 🔲 Окрема cabinet route `business/[slug]/invoice/[invoiceSlug]` — кабінет інвойсу: картки-секції з inline-edit (як Sprint 3), preview-toggle публічного вигляду, кнопка "Видалити" з 5s Undo, посилання на `pay.finly.com.ua/{businessSlug}/{invoiceSlug}` (copy + open-tab), QR-картинки (3 — postійна на public-URL інвойсу + 2 NBU primary/legacy).
- 🔲 Public-сторінка `pay.finly.com.ua/{businessSlug}/{invoiceSlug}` — Server Component під internal route `host-pay/[slug]/[invoiceSlug]/page.tsx`, host-aware middleware-rewrite розширюється на 2-сегментний path. Layout — той самий компонент `PublicBusinessView` з Sprint 3 + invoice-overlay (заголовок "Рахунок №… на 1500 грн", блок "Сума, Призначення, Термін дії", same 11-bank grid + 2 buttons + 2 QR, але з payload-ом інвойсу замість бізнесу).
- 🔲 Cascade-delete warning у Sprint 3 confirm-dialog: **один рядок** "У бізнесу N активних рахунків — вони теж зникнуть" якщо `affectedInvoices > 0` (additive до текущого dialog-у).
- 🔲 Адаптивність mobile-first (`responsive.md`).

### Shared (`@finly/types`)

- 🔲 **Розширення `UpdateBusinessSchema`** (у `packages/types/src/contracts/businesses.ts`) на поле `invoiceSlugPresetDefault: slugPresetSchema.nullable()` (як partial-optional за існуючим `.partial()` modifier). Без цього розширення SP-1 рішення про business-level дефолт пресету (Q §2.3 #2 closure) — dead config. `.strict()` modifier Sprint 3 не блокує — нове поле явно у схемі. Service-layer (`BusinessesService.update`) не потребує coupled-check, бо поле незалежне (без crossfield-rules). Frontend RHF-resolver автоматично підхоплює.
- 🔲 Розширення Zod-контрактів у новому `packages/types/src/contracts/invoices.ts`:
    - `CreateInvoiceSchema` — повний payload із форми створення. **Slug-input як discriminated union** з трьома взаємовиключними варіантами (рішення SP-1). Поля написання:
        - `amount: number | null` (копійки), `amountLocked: boolean`, `paymentPurpose: string | null`, `validUntil: Date | null` — 4 бізнес-поля.
        - `slugInput`: discriminated union (`{ kind: 'explicit', humanPart: string }` | `{ kind: 'preset', preset: SlugPreset }` | `{ kind: 'random' }`). Backend **сам** генерує фінальний slug (з 8-char tail) і записує `slugPreset`. Клієнт **ніколи** не передає фінальний slug чи tail — це serverside concern.
        - **Сирий `slug` поле у write-schema відсутнє** — щоб контракт write-side і read-side (entity Sprint 1) не плутались і ніхто не міг "прокинути" pre-built slug із tail-ом в обхід генератора.
    - `UpdateInvoiceSchema` — partial по edit-allowed підмножині (amount, amountLocked, paymentPurpose, validUntil) з `.strict()`. **`slug`/`slugPreset`/`businessId` навмисно виключено** — slug immutable після створення (як slug бізнесу у Sprint 3; vanity-edit для інвойсу — не передбачений у роадмапі взагалі, бо інвойс — одноразова сутність). `slugPreset` теж immutable — він аналітичне поле "який пресет згенерував", post-factum зміна не має сенсу.
    - `PublicInvoiceSchema` — view-схема public endpoint: whitelist `{ amount, amountLocked, paymentPurpose, validUntil, slug, business: { type, name, slug, acceptedBanks }, nbuLinks: { primary, legacy } }`. **Реквізити (IBAN, ІПН) знову не у JSON-полях** — leak-vector тільки через `nbuLinks` Base64URL payload (той самий інваріант що Sprint 3: дані доступні тільки через формат, який банк читає як платіжну команду).
- 🔲 Slug-схеми **— окремі для трьох ролей**, без перевантаження одного regex:
    - **`invoiceSlugSchema`** (Sprint 1, у `packages/types/src/entities/invoice.ts`) — валідовує **збережений фінальний slug** з обов'язковим 8-char tail (`{людська-частина}-{8-char}` АБО голий `{8-char}`). **Не змінюється.** Інваріант entity-time: будь-який invoice-документ у БД має валідний фінальний slug.
    - **`humanSlugPartSchema`** (новий, у `packages/types/src/contracts/invoices.ts`) — валідовує **тільки людську частину** input-у з форми (рівень 1 SP-1). Lowercase + kebab-case, без tail-вимоги. Min 1 char, max 60 chars (бо backend додасть `-{8-char-tail}` = 9 chars overhead, а entity max — 128). Без leading/trailing dash, без послідовних dash. Це **окрема схема**, не subset/refine `invoiceSlugSchema` — щоб live-validation на UI не вимагала від користувача знати про серверний tail.
    - Frontend `CreateInvoiceForm` live-валідовує **`humanSlugPartSchema`** (саме її, не `invoiceSlugSchema`). Backend після генерації запише `humanPart + '-' + tail` і збереження проходить через entity-`invoiceSlugSchema` — round-trip гарантує consistency.
    - `simple`/`with-month`/`with-year`/`with-purpose` пресети — **внутрішня деталь backend slug-генератора**, не доходить до Zod-схеми як user-facing input. Output генератора валідовується entity-схемою як normal write.
- 🔲 Util `formatYymmddhhmmss(date)` у `packages/types/src/qr/datetime.ts` — pure, без tz-conversions, рідний UTF-16 string.
- 🔲 Reserved-slug check для `business-slug`/`invoice-slug` НЕ розширюється — invoice-slug живе під business-slug, не на корені public-домена.

---

## НЕ-скоуп

- ❌ **Трекінг оплат** (Модель А, qr-decisions §1.12). `paidAt`, `transactions[]`, `paymentStatus` — Phase 1.5+. Жодних webhook-ів від банків. Sprint 4 — чистий генератор payload-ів з валідним `validUntil` для майбутнього cron-cleanup.
- ❌ **Cron expired-invoices cleanup** — Sprint 1 виставив index `{ validUntil: 1, sparse: true }` саме під цей cron, але сам cron не пишемо. UI-позначка "Прострочено" у списку — single source of truth у Sprint 4 (`new Date() > invoice.validUntil`).
- ❌ **Per-bank deep-links на public-сторінці інвойсу** — Sprint 5. Та сама сітка 11 неактивних логотипів + 2 NBU кнопки/QR.
- ❌ **Custom-slug for invoice (vanity)** — на відміну від бізнесу, для інвойсу vanity не передбачений ніколи. Інвойс — одноразова сутність; «красивий» slug дає або преcет, або явна людська частина при створенні. Edit slug post-creation **не існує як flow** (qr-decisions §4.3.1: "slug, раз згенерований, ніколи не змінюється" — навіть при зміні пресету за бізнесом).
- ❌ **Soft-delete UI / restore-флоу** — повторно hard-delete + 5s frontend-Undo (Sprint 3 §3.8 рішення). Поле `deletedAt` Sprint 1 ввів у Mongoose-схему — лишається невикористаним як опція на майбутнє, нульова вартість.
- ❌ **Free vs Paid гейти на інвойси** — qr-decisions §4.1 фіксує: lock-сума, термін дії, custom-призначення — все Free. Sprint 6 ревізує тільки якщо feedback з реальних платних юзерів покаже, що монетизація стоїть на ліміті кількості інвойсів (поки що — нелімітовано).
- ❌ **Invoice as standalone entity без business** — інвойс **завжди** належить бізнесу (`businessId required`). Sprint 1 закріпив compound-unique `(businessId, slug)`; cross-business slug-collision дозволені. Стан "інвойс без бізнесу" неможливий за схемою.
- ❌ **Bulk-операції** (масове створення, експорт CSV, копіювання інвойсу) — поза MVP. Phase 1.5+ при появі реального запиту від платних юзерів.
- ❌ **Шаблони інвойсу** (зберегти "стандартний рахунок" як reusable preset з amount/purpose/lock) — поза MVP. Якщо ФОП щодня виставляє схожі — в Sprint 6 окрема дискусія.
- ❌ **Список активних інвойсів на публічній сторінці бізнесу** (qr-decisions §4.3.3) — **відкидаємо назавжди як privacy-risk**. Клієнт відкриває `pay.finly.com.ua/{slug}` — бачить тільки вивіску бізнесу (Sprint 3); список інвойсів видимий лише ФОП у кабінеті.

---

## Закриті open-questions (продуктові рішення)

> Ця секція — discharge-list для qr-decisions §2.3 / §4.3.2 / §4.3.3 / §4.6. Кожне рішення має мати rationale; не закриваємо «бо так хочеться».

### SP-1. Slug — три рівні поведінки (qr-decisions §4.3.1) і дефолтний пресет (Q §2.3 #1)

**Контракт `CreateInvoiceSchema.slugInput` — discriminated union на полі `kind`:**

- **Рівень 1 — явний.** Клієнт надсилає `slugInput: { kind: 'explicit', humanPart: '<рядок>' }`. `humanPart` валідовується **`humanSlugPartSchema`** (lowercase, kebab-case, 1..60 chars, без leading/trailing/consecutive dash). Backend складає фінальний slug = `humanPart + '-' + <8-char-tail>`, записує `slugPreset = null` (явний режим = "користувач сам обрав ім'я", без preset-метаданих). Output служить через **entity-схему `invoiceSlugSchema`** як invariant-check before save.
- **Рівень 2 — пресет.** Клієнт надсилає `slugInput: { kind: 'preset', preset: SlugPreset }`. Backend генерує згідно правил пресету (див. counter-логіку нижче) + 8-char tail, записує `slugPreset = <обраний>`.
- **Рівень 3 — дефолт.** Клієнт надсилає `slugInput: { kind: 'random' }`. Backend кидає 8-char tail без префікса, записує `slugPreset = null`.

**Чому discriminated union, а не nullable string + nullable preset.** Полегшує компілятор-driven exhaustiveness у service: `switch (input.slugInput.kind)` дає TS-warning при додаванні нового kind у Sprint 6+ (наприклад, vanity-flow для інвойсу). Альтернатива (nullable string `slug` + nullable `slugPreset`) дозволяла би невалідний кросс-стан "обидва виставлені" або "обидва null = третій режим" — як вже бачили в попередній ітерації плану, це й заплутало. Discriminated union — single representation для kind-input-у, без перетинів.

**Дефолтний пресет, якщо ФОП обрав "автоматично" але не вибрав конкретний** — `simple` (`inv-001-aB3xQ9k7`). Чому: (а) zero-leak — нічого не виносить у URL крім порядкового номера; (б) zero-state-drift — `with-year`/`with-month` потребують часу для лічильника, який ще не існує на момент першого інвойсу; (в) нейтральний UX — "inv-001" зрозумілий усім без пояснень. UI dropdown трактує "автоматично" → `kind: 'preset', preset: 'simple'` — backend дефолт ніколи не активується, але safety-net лишається.

**Counter behavior на пресет (Q §2.3 #4 — "що з лічильником при зміні пресету посеред року").** Лічильник — **per-business + per-preset, monotonic, без reset**. Зміна пресету посеред року не рекалькулює вже згенеровані slug-и (immutable за qr-decisions §4.3.1) і не reset-ить лічильник нового пресету. Наступний номер — з фактичного `MAX(номер) + 1` серед існуючих інвойсів цього бізнесу для цього пресету.

Реалізація — без окремого counter-поля у БД (зайве і дрейфує); single-aggregation lookup у service-методі `generateInvoiceSlug`: фільтр `{ businessId, slugPreset: <currentPreset> }` (двокомпонентний — і `businessId`, і `slugPreset`-поле, не тільки regex по slug-string), parse номер з matched документів, max+1. **Двокомпонентний filter критичний для коректності**: explicit-mode записує `slugPreset = null`, тож explicit-slug `inv-999-aB3xQ9k7` (humanPart `"inv-999"`, regex-збіжний з `simple`-pattern) не потрапить у `simple`-counter aggregation. Якщо б filter був тільки за regex — `MAX(N)+1` для `simple` після такого explicit-інвойсу стрибнув би на 1000, ламаючи monotonic per-preset-namespace invariant. Compound-index `(businessId, slugPreset)` — не додаємо у Sprint 4 (`{ businessId, createdAt }` Sprint 1 уже існує, query за `slugPreset` на topspecific бізнес — O(N) по invoice-ах одного business-а, що на MVP-масштабі (десятки) акуратний).

Costs: O(1) при 1-2 active invoices одного пресету, O(log N) при 100+. На MVP-масштабі невидимо.

**Override slug-ом для конкретного інвойсу (Q §2.3 #3).** Можливий через рівень 1 (`kind: 'explicit'`). Це і є override; окремого "override existing-preset"-механізму нема. ФОП обирає на формі — або явний рядок, або пресет, або рандом.

**Налаштування на рівні бізнесу чи акаунту (Q §2.3 #2).** Зберігаємо **бізнес-level**, у новому полі `Business.invoiceSlugPresetDefault: SlugPreset | null` (default `null = "не визначено"`, **не "рандом"** — fallback на global system default `simple` у формі створення §4.5). Чому: різні бізнеси одного ФОП можуть мати різну логіку нумерації (один — "Замовлення №147", інший — "2026-05-001"); акаунт-level був би крихким при додаванні другого бізнесу. Це + `invoiceSlugPresetDefault` — мінорне розширення схеми (Sprint 4 додає одне поле, без міграції — `null` дефолт сумісний з усіма Sprint-3-доками). Бізнес-level "запам'ятати random як дефолт" — out-of-MVP (рідкий UX-кейс; розширення `SLUG_PRESETS` на `'random'` зламає Sprint 1 `Invoice.slugPreset` analytics-семантику).

**UI-варіанти form-dropdown-у — детально у §4.5** (6 опцій: explicit + 4 пресети + random; default опція читається з `business.invoiceSlugPresetDefault ?? 'simple'`). SP-1 не дублює перерахування, щоб не виник drift; §4.5 — single source of truth для UI-mapping.

### SP-2. Preview-режим інвойсу (Q §4.3.2)

Той самий патерн, що Sprint 3 §3.8 для бізнесу — toggle "Кабінет / Перегляд як клієнт" вгорі сторінки `business/[slug]/invoice/[invoiceSlug]` + кнопка "Відкрити в новій вкладці" → `pay.finly.com.ua/{businessSlug}/{invoiceSlug}`. Iframe-варіант відкидаємо знову (cross-domain, неконсистентно зі Sprint 3). Public view prefetch-иться при mount-і (як Sprint 3) — toggle дає instant render.

### SP-3. Що бачить клієнт на корені бізнесу (Q §4.3.3) — закрито

Sprint 3 уже відповів: на `pay.finly.com.ua/{slug}` (без шляху до інвойсу) — **тільки постійна вивіска** (11 банків + 2 кнопки + 2 QR на business-payload без суми/lock). Sprint 4 **не змінює** цю поведінку. Список активних інвойсів на public-зоні — відкинуто як privacy-risk (НЕ-скоуп вище).

### SP-4. UI кабінету: як співіснують "Загальний QR" і "Разовий рахунок" (Q §4.6)

**Одна сторінка `business/[slug]`, **дві нові секції** на додачу до 7 існуючих Sprint 3** (без вкладок, без перемикання режимів). Повний vertical-stack після Sprint 4 — **9 секцій у фіксованому порядку**:

1. Основне (Sprint 3).
2. Реквізити (Sprint 3).
3. Оподаткування (Sprint 3).
4. Призначення і банки (Sprint 3).
5. Публічна сторінка (Sprint 3).
6. QR-картинка (Sprint 3).
7. **Налаштування рахунків** (Sprint 4 — нова, configuration-блок). Один dropdown — `invoiceSlugPresetDefault`. Деталі — Скоуп.Frontend / §4.4. Стоїть **перед** "Рахунки" як патерн "settings before content" — узгоджено з тим, що "Публічна сторінка" (configuration: SEO toggle, slug copy) стоїть **перед** "QR-картинка" (output) у Sprint 3.
8. **Рахунки** (Sprint 4 — нова, content-блок). CTA "Виставити рахунок" + paginated list. Між "Налаштування рахунків" і "Небезпечна зона". Зміст:
    - Заголовок + CTA "Виставити рахунок" → `/business/{slug}/invoice/new`.
    - Список карток (paginated 10 на сторінку, sort by `createdAt desc`): `amount` (форматований як гривня з копійок), `paymentPurpose | businessTemplate fallback` (truncate-2-line), `validUntil` (з badge "Прострочено" якщо `< now`), `slug`, copy-link, "Відкрити" → cabinet-route інвойсу.
    - Empty-state: "Поки немає виставлених рахунків. Натисніть «Виставити рахунок» — клієнт отримає посилання з сумою і призначенням, готове для оплати" + та сама CTA.
9. Небезпечна зона (Sprint 3, лишається в кінці — destructive actions завжди last).

**Чому "Налаштування рахунків" не sub-section всередині "Рахунки".** Sub-section створив би два independent edit-states у одній картці (settings dropdown + invoice list), що ламає inline-edit-pattern Sprint 3 (`EditableField` очікує per-section single-edit-handle). Окрема секція дає чистий ownership: dropdown-edit живе у `InvoicesSettingsSection`, list — у `InvoicesSection`, без коупінгу. Vertical-spacing у layout достатньо для розрізнення; counter активних інвойсів у списку візуально розшаровує дві секції без потреби явного divider-у.

Чому **не вкладки** (відкинутий варіант): вкладки роблять "Загальний QR" і "Рахунки" рівноцінними розділами кабінету — створюється враження, що бізнес — це "просто папка для двох речей". Натомість публічна вивіска бізнесу — **первинна** (вона ж — fallback для всіх інвойсів, що ще не створені); рахунок — **похідне** від бізнесу. Вертикальний скрол із секцією «Рахунки» внизу зберігає цю ієрархію в UI.

**Onboarding для другого CTA** (qr-decisions §1.8 — продукт = і вивіска, і рахунки): на головній списку бізнесів (`/business`) кожна картка показує counter активних інвойсів (`5 активних рахунків`), що при кліку розгортає бізнес-сторінку зі скрол-target на секцію "Рахунки". Це достатньо, щоб ФОП-онбординг не потребував окремої CTA "Виставити перший рахунок" на кореневій `/business`.

### SP-5. Cascade delete бізнесу — atomic-or-nothing через Mongo transaction

При `DELETE /businesses/me/{slug}` сервер виконує **cascade hard-delete у єдиній `withTransaction`-сесії**:

1. Counts existing invoices через `Invoice.countDocuments({ businessId: business._id })` (single round-trip — поза транзакцією, бо чисто інформативно для response).
2. **`session.withTransaction(async () => { Invoice.deleteMany({businessId}, {session}); Business.deleteOne({_id}, {session}); })`** — обидві операції в одній session. Mongo автоматично abort-ить весь scope при будь-якій failure всередині callback-а; orphan-state неможливий. `withTransaction` сам ретраїть на TransientTransactionError і UnknownTransactionCommitResult (документована Mongo-семантика) — без власного wrapper-а.
3. Response: `{ data: { affectedInvoices: number } }` — frontend toast після 5s "Видалено бізнес «{name}» і {N} рахунків".

**Fail-fast при відсутності replica-set.** `withTransaction` **вимагає replica-set** (Mongo-обмеження): на standalone mongod операція кидає `MongoServerError: Transaction numbers are only allowed on a replica set member or mongos`. Sprint 4 трактує це як **infrastructure-level fail**, не runtime-fallback:

- **Production (Atlas):** replica-set за замовчуванням. Працює.
- **Dev test env:** перехід з `MongoMemoryServer` на `MongoMemoryReplSet` для всіх api-tests, що торкаються delete-flow. Це **обов'язкова precondition** для Sprint 4 §4.2 e2e-тестів cascade-delete; виконується у §4.0 (новий cleanup-епік нижче). Бібліотека `mongodb-memory-server` уже dependency репо — replica-set варіант доступний без додаткових пакетів.
- **Dev local Mongo:** `docker-compose.dev.yml` Mongo **не запускає** (поточний compose-файл містить тільки `redis`/`api`/`web`; API отримує `MONGODB_URI` ззовні через env). Sprint 4 **навмисно НЕ додає** Mongo service у dev compose — production-parity з Atlas (replica-set ззовні) і zero-overhead для developer-ів, що вже мають Atlas dev cluster або local mongod. Замість цього §4.0 документує **три явні шляхи отримати replica-set MONGODB_URI**, з яких developer обирає один (детально — §4.0 нижче).
- **Runtime fail-handling.** Якщо `withTransaction` все ж падає з error.codeName/message що вказує на transactionальну несумісність — service ловить, логує `error` рівнем і кидає `InternalServerErrorException({ code: 'CASCADE_DELETE_REQUIRES_REPLICA_SET', message: '...' })` → 500 з clear machine-code. **Жодного delete не виконано.** ФОП бачить toast "Не вдалося видалити бізнес. Зверніться в підтримку" (mapApiCode UA-message), команда отримує alert. Це failure-mode для misconfigured infra, не runtime-fallback для нормальної операції.

**Чому fail-fast, а не graceful 2-sequential-deletes.** Попередня версія плану дозволяла "2 sequential deletes без транзакції з risk-window orphan invoices". Це некоректно для destructive flow: orphan invoices без батька — це data-corruption-state, що "manual cleanup тривіально" приймає як норму у production. Atomic-or-nothing — єдиний правильний контракт для cascade-delete; обмеження "потрібен replica-set" просувається на infra-layer, де воно належить.

4. Confirm-dialog (`useDeleteBusinessConfirmStore`): додаємо warning рядок, якщо `affectedInvoicesCount > 0`. Frontend робить окремий counter-fetch **перед** confirm (через розширений `GET /businesses/me/{slug}` response — `invoicesCount: number`, cheap single aggregate). Користувач знає цифру **до** натискання "Видалити", не після.

**Альтернатива (відкинута):** заборона delete поки є інвойси (UX як qr-decisions §1.10 для bookkeeper-account-у). Відкинуто, бо ФОП у кабінеті може мати 50 старих інвойсів, які не хочеться вручну прибирати; "видалити бізнес = вийти з продукту з конкретного бізнесу" має бути one-click з clear warning.

### SP-6. Lock-mask семантика на UI

ФОП у формі бачить `UiSwitch` "Дозволити клієнту правити суму". Default `false` (швидкий шлях — фіксована сума, як у класичному інвойсі). Коли OFF — `amountLocked = true` → `fieldLockMask = FFFF`. Коли ON — `amountLocked = false` → `fieldLockMask = FEFF`.

Coupled-rule зі Sprint 1 Zod-refine (`amount === null && amountLocked === true` → `AMOUNT_LOCKED_REQUIRES_AMOUNT`) — на UI-рівні: switch disabled (`opacity-50 + cursor-not-allowed`), якщо `amount === null` (з підказкою "Заблокувати редагування можна лише при заданій сумі"). При зміні `amount=number → null`: `amountLocked` автоматично ставиться у `false` без додаткового кліку (з RHF watch-callback-ом).

### SP-7. validUntil семантика

UI-поле "Термін дії" з варіантами: "без терміну" (default — `null`) / "до конкретної дати" (date-picker, без часу — час фіксуємо `23:59:59` локальний; для УКР-ринку у Sprint 4 timezone не питаємо — конvergent з Sprint 3 single-locale). При `validUntil < now` — публічна сторінка показує банер "Термін рахунку минув. Зверніться до отримувача" і ховає кнопки/QR оплати (sanity check, бо банк-додаток сам це robustly не валідує).

---

## Епіки

### 4.0 Infra-prep — Mongo replica-set для cascade-delete (БЛОКЕР №0)

Виконується **перед** §4.2. Без replica-set `BusinessesService.delete` cascade-flow не може працювати ні у тестах, ні у production (рішення SP-5 — fail-fast, без runtime-fallback).

**Стан інфра-baseline (станом на Sprint 4):**

- `docker-compose.dev.yml` містить **тільки `redis` + `api` + `web` services**; Mongo туди **не входить** (API отримує `MONGODB_URI` ззовні через env). CLAUDE.md "Common Commands" описує цей dev compose як "Redis only".
- Production deploy використовує external Mongo через `MONGODB_URI`; Atlas-кластер за замовчуванням — replica-set.
- Test-сьюти використовують `MongoMemoryServer` (standalone — без replica-set).

**Sprint 4 НЕ додає Mongo service у `docker-compose.dev.yml`.** Чому: production-parity (prod теж зовнішній Mongo), нульовий yaml-overhead, і developer-и, що вже мають Atlas dev cluster чи local mongod з replica-set, не змушені перемикатись на containerized Mongo. Замість цього §4.0 фіксує три явні шляхи (developer обирає один) і єдиний test-suite invariant.

**Єдина мінорна compose-зміна — `extra_hosts` alias** для Linux-developer-ів, що обирають варіант (б)/(в) у Режимі C (API через compose + Mongo на host-machine): додаємо `extra_hosts: ["host.docker.internal:host-gateway"]` до `api`-блоку `docker-compose.dev.yml` (2 рядки yaml, без додавання services). Це не порушує production-parity — `extra_hosts` діє лише у dev compose і ігнорується production deploy.yml-ом. Detail у варіанті (б) нижче.

- 🔲 **Test env:** заміна `MongoMemoryServer` → `MongoMemoryReplSet` для api-test-сетапу, який торкається transactional flow (мінімум — нові invoice-tests і extension business-delete-test). Не глобальний swap всіх existing tests — ті, що проходять і без replica-set, лишаються на `MongoMemoryServer` для швидкості старту. Окремий helper `apps/api/src/test-setup.ts` отримує два `setupMongo` варіанти; tests opt-in через імпорт. Бібліотека `mongodb-memory-server` уже dependency репо — `MongoMemoryReplSet` доступний без додаткових пакетів.
- 🔲 **Dev local Mongo — три варіанти, developer обирає один.** Compose-changes у Sprint 4 — **мінімальні і точкові**: жодного нового service не додаємо (Mongo лишається external для production-parity), єдина зміна — `extra_hosts` alias у `api`-блоці для Linux-developer-ів у Режимі C (детально нижче). Це не "розширення compose до повної infra-orchestration", а tactical-host-alias-aдиція на 2 рядки yaml.

    **Передумова — два workflow-режими запуску API**, від яких залежить connection-string:
    - **Режим H ("API на host-machine"):** developer запускає `pnpm --filter api dev` без Docker (стандартний Node.js workflow). API-процес бачить host-network безпосередньо.
    - **Режим C ("API у dev compose"):** developer запускає `docker compose -f docker-compose.dev.yml up`. API-контейнер ізольований у compose-network, `localhost` всередині нього = сам API-контейнер, **не** host-machine. Це підступне місце: copy-paste `mongodb://localhost:...` URI з варіантів (б)/(в) працюватиме лише у Режим H, а у Режим C дасть мовчазний `MongoServerSelectionError` на старті.

    Рекомендації по варіантах:
    - **(а) Atlas dev cluster** (рекомендований для команди, що вже працює з Atlas; **єдиний варіант, що працює одразу для обох Режимів H і C** без host-networking-ремаркувань) — replica-set за замовчуванням, public DNS-host у URI (`mongodb+srv://...`), що однаково резолвиться з host-machine і з compose-контейнера. Рекомендований default для нових developer-ів.
    - **(б) Standalone Docker container на host-machine з replica-set.** Два підступні нюанси, які треба адресувати разом:
        1. **`rs.initiate()` без аргументів** реєструє member-host як container hostname (типово ID контейнера) — driver у hello-response отримує адресу, що не резолзиться → `MongoServerSelectionError`. Recipe нижче явно фіксує member-host у config-у.
        2. **Linux і `host.docker.internal` для Режим C.** На macOS/Windows alias built-in у Docker Desktop. На Linux — `host.docker.internal` НЕ резолзиться **ні в API-контейнері, ні всередині standalone Mongo container-а**, поки кожен з них не отримав `host-gateway`-alias явно. Без alias всередині Mongo container — replica-set self-discovery (heartbeat, `rs.status()`) деградує ще до того, як API спробує приконектитись. Тому на Linux додаємо alias у **двох** місцях: `--add-host` у `docker run` для Mongo, `extra_hosts` у compose для API.

        Recipe:
        - `docker run -d --name finly-mongo-dev -p 27017:27017 \`
          \ `--add-host host.docker.internal:host-gateway \` ← на Linux обов'язково для Режим C; на macOS/Windows безпечний noop (Docker resolve-ить alias і так).
          \ `mongo:7 --replSet rs0 --bind_ip_all`
        - Readiness-check: `until docker exec finly-mongo-dev mongosh --quiet --eval 'db.runCommand({ping:1}).ok' >/dev/null 2>&1; do sleep 1; done`.
        - Init (idempotent — `AlreadyInitialized` ignored на повторі):
            - **Для Режим H** (API на host): `docker exec finly-mongo-dev mongosh --quiet --eval 'rs.initiate({_id:"rs0", members:[{_id:0, host:"localhost:27017"}]})'`. Member-host = `localhost:27017`, бо driver з host-machine resolve-ить його напряму. На Linux Mongo container з host-network reach (через `127.0.0.1` mapping) теж може resolve `localhost` всередині себе — heartbeat ОК.
            - **Для Режим C** (API у compose): `docker exec finly-mongo-dev mongosh --quiet --eval 'rs.initiate({_id:"rs0", members:[{_id:0, host:"host.docker.internal:27017"}]})'`. Member-host = `host.docker.internal:27017`. На Linux **обов'язково**: `--add-host` у docker run (вище) + `extra_hosts: ["host.docker.internal:host-gateway"]` у `api`-блоці `docker-compose.dev.yml` (Sprint 4 додає ці 2 рядки до compose — єдина compose-зміна, без додавання services). На macOS/Windows обидва alias вже є built-in.
        - **`MONGODB_URI` залежно від режиму** (різний host у `.env`):
            - Режим H: `MONGODB_URI=mongodb://localhost:27017/finly_dev?replicaSet=rs0`
            - Режим C: `MONGODB_URI=mongodb://host.docker.internal:27017/finly_dev?replicaSet=rs0`
        - **`directConnection`-параметр явно НЕ додаємо** — Node driver default `directConnection=false` (per [MongoDB Node driver docs](https://www.mongodb.com/docs/drivers/node/current/fundamentals/connection/connection-options/)), що активує SDAM (Server Discovery and Monitoring) і replica-set discovery через `replicaSet=rs0` query-param. Це саме те, що потрібно для transactions. **Не вмикайте `directConnection=true`** — driver тоді bypass-ить SDAM, не виконує replica-set discovery, і `withTransaction` падає з `IllegalOperation`. (MongoDB docs у певних single-node test-сценаріях радять `directConnection=true` як zero-discovery shortcut, але це специфічно для standalone-mongod-без-replica-set; наш кейс — replica-set з transactions, default-behavior підходить.)
        - **Verification recipe**:
            - Режим H (з host-machine): `mongosh "mongodb://localhost:27017/?replicaSet=rs0" --eval "rs.status().ok"` має повернути `1`.
            - Режим C: те саме, але з `api`-контейнера: `docker compose -f docker-compose.dev.yml exec api sh -c 'mongosh "mongodb://host.docker.internal:27017/?replicaSet=rs0" --eval "rs.status().ok"'`. Якщо timeout — на Linux перевірити, чи `--add-host` був у docker-run-команді **і** `extra_hosts` додано до compose (обидва місця, не одне); на macOS/Windows — рестартнути Docker Desktop (host.docker.internal іноді stale після сну).
            - Окремо для Linux у Режим C: `docker exec finly-mongo-dev mongosh --quiet --eval 'rs.status().members[0].health'` — має повернути `1`. Якщо `0` — Mongo container не може resolve member-host (відсутній `--add-host`).
        - **Не змішувати режими.** Якщо ініціалізували replica-set з `host:"localhost:27017"` (для Режим H) і потім запустили API через compose — driver не зможе resolve-ити `localhost:27017` з контейнера. Reset: `docker exec finly-mongo-dev mongosh --eval 'rs.reconfig({_id:"rs0", members:[{_id:0, host:"host.docker.internal:27017"}]}, {force:true})'`.

    - **(в) Local mongod на host-machine з replica-set config — тільки для Режим H** (`pnpm --filter api dev` на host без Docker). `mongod --replSet rs0 --bind_ip 127.0.0.1` локально + `mongosh --eval 'rs.initiate({_id:"rs0", members:[{_id:0, host:"localhost:27017"}]})'`. `MONGODB_URI=mongodb://localhost:27017/finly_dev?replicaSet=rs0`. **Не рекомендується для Режим C на Linux** — local mongod сам себе як member знає за `localhost:27017`/`host.docker.internal:27017`, але heartbeat-перевірка з самого host-у (а не з Docker container-а) не зможе резолвити `host.docker.internal` без manual `/etc/hosts` edit, що ввесь setup робить крихким. Якщо потрібен Режим C без Atlas — використовуй (б) standalone Docker Mongo, не local mongod.

    **Дефолтна рекомендація у root `README.md` onboarding-секції:** Atlas dev cluster (а) — як zero-friction шлях, що покриває обидва workflow-режими без host-networking-tax. (б)/(в) — тільки якщо developer навмисно хоче offline / containerized stack і готовий тримати в голові режим H vs C.

- 🔲 **Документація** у root `README.md` (нова секція "Mongo replica-set для local dev") — три варіанти вище зі сніпетами команд, recipe як перевірити що replica-set ОК (`mongosh --eval "rs.status().ok"` має повернути `1`). Без `pnpm dev:db:init` script — він мав би сенс лише якби Mongo був усередині dev compose (не наш кейс).
- 🔲 **Production / `.env.example`:** додаємо коментар-документацію над `MONGODB_URI` — "Must point at a Mongo replica-set; standalone mongod is unsupported (cascade-delete requires transactions)". Backend startup міг би валідувати `replicaSet` connection-string param як fail-fast invariant — **відкидаємо** як зайвий: connection-string параметр ≠ runtime topology check, false-positive ризик; `BusinessesService.delete` сам кидає `CASCADE_DELETE_REQUIRES_REPLICA_SET` при першій спробі — operational signal приходить вчасно.
- 🔲 **Тести:** smoke `cascade-delete.spec.ts` на `MongoMemoryReplSet` — створення бізнесу + 3 інвойси + delete → і бізнес, і всі 3 інвойси зникли в одній транзакції; mid-transaction simulated failure → нічого не видалено (rollback працює).

**DoD §4.0:** existing test-suite (390+ api tests) проходить без regress; `cascade-delete.spec.ts` зеленіє на `MongoMemoryReplSet`; root `README.md` документує три dev-варіанти з copy-paste-готовими сніпетами; `.env.example` має коментар про replica-set requirement.

**Ризик.** На відміну від попередньої версії плану (де compose мав додатково запускати Mongo service з ініціалізацією replica-set через init-script), infra-yaml у Sprint 4 змінюємо **точково й мінімально** — тільки `extra_hosts: ["host.docker.internal:host-gateway"]` у `api`-блоці. Mongo service у compose не додається (production-parity лишається). Головний ризик переноситься на **DX-onboarding**: новий developer без replica-set Mongo дає 500 на `cascade-delete` і не одразу зрозуміє, що infra потребує налаштування. **Mitigation:** (а) чітке UA-message у toast "Не вдалося видалити бізнес. Зверніться в підтримку" + clear server-log message з recipe ("MONGODB_URI must be replica-set; see README"); (б) onboarding section у root `README.md` показує всі три варіанти ще до першого `pnpm dev`; (в) optional CI-step (post-Sprint 4) — startup-check `db.admin().command({ replSetGetStatus: 1 })` як warning-log, не fail-fast.

---

### 4.1 Schema розширення `Business` + invoice slug-генератор

Sprint 1 закрив `Invoice` schema-only. Sprint 4 додає **одне** поле у `Business` (`invoiceSlugPresetDefault`) і **новий primitive** `InvoiceSlugGeneratorService`.

- 🔲 `Business.invoiceSlugPresetDefault: SlugPreset | null` (default `null = "не визначено"` — fallback на global system default `simple` у формі створення §4.5; **не "random"**, див. SP-1 + §4.4 "Налаштування рахунків" для повної семантики). Mongoose `enum: SLUG_PRESETS, default: null`. Zod entity-схема — додати поле як `slugPresetSchema.nullable()`. Migration — **не потрібна**: `null` дефолт сумісний зі всіма існуючими бізнес-документами без backfill.
- 🔲 `InvoiceSlugGeneratorService` — окремий сервіс у `apps/api/src/modules/invoices/`. Single public method:
    - **Контракт:** `generateInvoiceSlug(input: GenerateInvoiceSlugInput): Promise<{ slug: string; slugPreset: SlugPreset | null }>`.
    - **`GenerateInvoiceSlugInput`** — explicit-fields contract, **усі залежності пресет-логіки передаються параметрами** (без implicit lookup-у через інші services або скрите читання form-state):
        - `businessId: ObjectId` — namespace для counter-aggregation і compound-unique check.
        - `slugInput`: discriminated union (SP-1 + §"Скоуп.Shared"): `{ kind: 'explicit', humanPart: string }` | `{ kind: 'preset', preset: SlugPreset }` | `{ kind: 'random' }`.
        - `paymentPurpose: string | null` — explicit-purpose з форми (з invoice-DTO `paymentPurpose`). `null` = "ФОП не задав → inheritance з бізнесу".
        - `businessPaymentPurposeTemplate: string` — required-fallback для inheritance логіки. Sprint 1 entity-Zod гарантує non-empty (`paymentPurposeTemplate.min(1)`), тож generator може покладатись на наявність bottom-string.
    - Effective purpose для `with-purpose`-пресета: `paymentPurpose ?? businessPaymentPurposeTemplate`. Цей же inheritance-шлях — у `payload-mapper.ts` (`buildPayloadInputFromInvoice`) для коректного NBU payload-у; обидва місця використовують **single helper** `effectiveInvoicePurpose(invoice, business)` у `apps/api/src/modules/invoices/purpose-resolver.ts` (новий файл, pure-function), щоб slug-генерація і payload-генерація не розходились на одному й тому ж resolution-rule.
    - Внутрішня механіка для `preset`-варіантів:
        - `simple`: format `inv-{zlpadded-3}-{8-char-tail}`. Counter — `MAX(N)+1` over `Invoice.find({ businessId, slugPreset: 'simple' })`-документів (двокомпонентний filter, не regex-only — детальніше у SP-1 "Counter behavior", це блокує забруднення explicit-mode-slug-ом, що випадково матчить `simple`-regex).
        - `with-month`: format `{YYYY}-{MM}-{zlpadded-3}-{tail}`. Counter — per-(business, year, month) з filter `{ businessId, slugPreset: 'with-month', slug: { $regex: '^{YYYY}-{MM}-' } }` — двокомпонент `slugPreset` плюс year/month substring (бо within-preset counter все одно має reset-итись на новий місяць).
        - `with-year`: format `{YYYY}-{zlpadded-3}-{tail}`. Counter — `{ businessId, slugPreset: 'with-year', slug: { $regex: '^{YYYY}-' } }`.
        - `with-purpose`: format `{slugifiedPurpose}-{tail}`, де `slugifiedPurpose` — transliteration `effectivePurpose` UA → latin (через `cyrillic-to-translit-js` або власна таблиця, **обираємо при імплементації**) + lowercase + kebab-case + truncate до 60 chars. **Без counter-логіки** (purpose сам unique-вистачає; на повторно ідентичний `effectivePurpose` різні tails гарантують unique slug).
        - **Edge-case fallback `with-purpose` → empty:** якщо після transliteration + slugify результат empty (purpose з самих emoji / non-cyrillic-non-ascii / лише пробіли — теоретично можливо тільки у explicit `paymentPurpose`, бо `businessPaymentPurposeTemplate` non-empty за Sprint 1 invariant) — generator повертає **рівень 3 result** (`{ slug: <8-char-tail>, slugPreset: null }`). Service записує `slugPreset = null`, не `'with-purpose'` — інакше analytics-counter був би засмічений empty-prefix-варіантами. Frontend warning (qr-decisions §4.3.1.1) на формі вже showcas-ив risk; degradation на рівень 3 acceptable і не вимагає окремого user-error message.
    - Tail — повторне використання rejection-sampling логіки з `SlugGeneratorService` Sprint 3 (8 chars, A-Za-z0-9, crypto.randomBytes). DRY: спільний util `generateRandomTail()` у `apps/api/src/modules/businesses/slug-generator.service.ts` (export).
    - Collision-перевірка — на `(businessId, slug)` (compound-unique). 10 retries; на 11-ту — `INVOICE_SLUG_GENERATION_FAILED` 500. Сценарій нереальний: tail + per-business namespace дає 218T комбінацій × кожен бізнес.
- 🔲 Тести (api): `InvoiceSlugGeneratorService.spec.ts`:
    - 4 пресети × happy-path → правильна `{ slug, slugPreset }`-shape.
    - Monotonic counter для `simple`/`with-month`/`with-year` через 10 послідовних інвойсів того ж пресету.
    - **Counter-isolation invariant** (нова): explicit-mode інвойс з humanPart `"inv-999"` (slug `inv-999-aB3xQ9k7`, slugPreset=null) **не впливає** на наступний `simple`-counter — `MAX(N)+1` ігнорує цю document, бо filter `slugPreset === 'simple'` його виключає. Без цього тесту regression попадає у production.
    - `with-purpose` × `paymentPurpose` not null → slug містить slugified explicit-purpose.
    - `with-purpose` × `paymentPurpose === null` → slug містить slugified `businessPaymentPurposeTemplate` (inheritance shortcut).
    - `with-purpose` × empty-after-slugify → fallback на рівень 3 (`{ slug: <8-char-tail>, slugPreset: null }`) — НЕ throw.
    - Transliteration edge cases (apostrof `’`, числа, пробіли, лише emoji в `paymentPurpose`).
    - Collision-retry: mocked `Invoice.exists` повертає true 2× → 3-я спроба passes.
- 🔲 Тести (api): `purpose-resolver.spec.ts` (новий, ~5 кейсів) — pure-function `effectiveInvoicePurpose`: `invoice.paymentPurpose != null` → returns it; `=== null` → returns `business.paymentPurposeTemplate`. Без DI / mocks.
- 🔲 Тести (api): міграційний smoke (на `MongoMemoryServer`) — створення бізнесу без `invoiceSlugPresetDefault` → читання → поле `null`; update на конкретний пресет → читання повертає його.

**DoD:** `Business` приймає нове поле `invoiceSlugPresetDefault` (Mongoose, entity-Zod, **`UpdateBusinessSchema`** — без write-path Sprint-3 ФОП не зміг би його змінити); всі 4 пресети генерують валідний slug проти `invoiceSlugSchema` Sprint 1; counter monotonic для `simple`/`with-month`/`with-year` через 10 послідовних інвойсів **і** counter-isolation тест на explicit-slug-collision; `with-purpose` коректно резолвить purpose з обох гілок (`paymentPurpose != null` і `=== null` → inheritance) через спільний `effectiveInvoicePurpose`-helper, з graceful fallback на рівень 3 при empty-after-slugify; transliteration дає зрозумілі ASCII-вивіски без UTF-8 chars у URL; PATCH `/businesses/me/{slug} { invoiceSlugPresetDefault: 'simple' }` зберігає поле і `getBySlug` повертає його (e2e-cycle).

---

### 4.2 Backend — Invoice CRUD (cabinet zone)

Файли: `apps/api/src/modules/invoices/invoices.service.ts`, `invoices.controller.ts`, `invoice-access.guard.ts`, `dto/`, `payload-mapper.ts`.

- 🔲 `InvoicesService` — методи:
    - `create(business, dto): Promise<InvoiceDocument>` — приймає **resolved business document** (не businessId-string) з `BusinessAccessGuard`-attach-у; викликає `InvoiceSlugGeneratorService.generateInvoiceSlug({ businessId: business._id, slugInput: dto.slugInput, paymentPurpose: dto.paymentPurpose, businessPaymentPurposeTemplate: business.paymentPurposeTemplate })`; `model.create({ businessId, slug, slugPreset, amount, amountLocked, paymentPurpose: dto.paymentPurpose, validUntil })`. Зверни увагу: `paymentPurpose` зберігається у БД **як прийшов** (`null = inheritance` за Sprint 1 invariant), тоді як generator отримує **резолвлений** ефективний purpose окремим параметром — це навмисний separation: persistence-shape незалежний від preset-mode-у.
    - `getByBusinessId(businessId, pagination): Promise<{ items, total }>` — list з sort `createdAt desc` + offset/limit (default limit 10).
    - `countByBusinessId(businessId): Promise<number>` — для cabinet GET `/businesses/me/{slug}` extension і delete-confirm warning.
    - `getBySlug(businessId, invoiceSlug): Promise<InvoiceDocument | null>` — compound-keyed lookup; case-sensitivity slug-у — see SP-8 below.
    - `update(businessId, invoiceSlug, dto): Promise<InvoiceDocument>` — `findOneAndUpdate` + `runValidators`. coupled-rule `amount=null + amountLocked=true` blocks save через mongoose (тут на rescue від drift Zod-схеми).
    - `delete(businessId, invoiceSlug): Promise<void>` — hard-delete; 5s frontend-Undo (повторне використання `scheduleDeleteWithUndo` Sprint 3).
- 🔲 `InvoiceAccessGuard` — стає у chain ПІСЛЯ `JwtActiveGuard` + `BusinessAccessGuard`. **Не робить повторного lookup-у бізнесу** — читає `request.business` (already attached `BusinessAccessGuard`-ом). Витягує `:invoiceSlug` з route-params, лукапить інвойс через `InvoicesService.getBySlug(request.business._id, invoiceSlug)`, attach до `request.invoice`. На fail — 404 (`INVOICE_NOT_FOUND`). Жодних ownership-перевірок (owner-bit живе на business; якщо `BusinessAccessGuard` пройшов — інвойс під ним за визначенням accessible). Programmer-error guard: якщо `request.business` undefined — кидаємо `Error('InvoiceAccessGuard requires BusinessAccessGuard before it')` (як Sprint 3 §3.2 patern для `JwtActiveGuard`-pre-check).
- 🔲 `InvoicesController` (cabinet, prefix `/businesses/me/:slug/invoices`). **Route-param бізнесу — `:slug`, не `:businessSlug`** (детально — рішення §"Скоуп" вище):
  | Метод | Шлях | Guards | Опис |
  |---|---|---|---|
  | GET | `/businesses/me/:slug/invoices` | `JwtActive` + `BusinessAccess` | List (paginated; `?page=&limit=`) |
  | POST | `/businesses/me/:slug/invoices` | `JwtActive` + `BusinessAccess` | Create |
  | GET | `/businesses/me/:slug/invoices/:invoiceSlug` | `JwtActive` + `BusinessAccess` + `InvoiceAccess` | Read |
  | PATCH | `/businesses/me/:slug/invoices/:invoiceSlug` | `JwtActive` + `BusinessAccess` + `InvoiceAccess` | Update |
  | DELETE | `/businesses/me/:slug/invoices/:invoiceSlug` | `JwtActive` + `BusinessAccess` + `InvoiceAccess` | Delete |
- 🔲 Розширення `BusinessesController.getBySlug` response на `{ data: { ...business, invoicesCount: number } }` — Sprint 4 add-on; cheap single aggregate, кешу не потребує.
- 🔲 Розширення `BusinessesController.delete` response на `{ data: { affectedInvoices: number } }`.
- 🔲 Cascade-delete у `BusinessesService.delete` (рішення SP-5 — atomic-or-nothing через `withTransaction`):
    - `Invoice.countDocuments({businessId})` → `count` (поза транзакцією, для response).
    - `session.withTransaction(async () => { Invoice.deleteMany({businessId}, {session}); Business.deleteOne({_id}, {session}); })` — atomic. Помилка → весь scope abort, нічого не видалено.
    - Catch-handler на `MongoServerError` з error message/codeName що вказує на transactional-incompatibility → throw `InternalServerErrorException({ code: CASCADE_DELETE_REQUIRES_REPLICA_SET })`. Жодного fallback на 2 sequential deletes.
    - Повертаємо `count`.
- 🔲 DTO через `createZodDto` (`CreateInvoiceDto`, `UpdateInvoiceDto`).
- 🔲 Нові `RESPONSE_CODE` entries: `INVOICE_NOT_FOUND` (404), `INVOICE_SLUG_GENERATION_FAILED` (500), `INVOICE_AMOUNT_LOCKED_REQUIRES_AMOUNT` (400 — окремий код для UX-friendly toast), `CASCADE_DELETE_REQUIRES_REPLICA_SET` (500 — infra-failure, не business-error). Додати до `mapApiCode.ts` notification-словника. Останній код у user-facing формі — нейтральне "Не вдалося видалити бізнес. Зверніться в підтримку"; справжню причину видно тільки у server-логах.

**DoD:** усі 5 endpoints віддають правильний envelope; `InvoiceAccessGuard` повертає 404 для неіснуючого; `BusinessesController.getBySlug` повертає `invoicesCount`; cascade-delete у транзакції видаляє і бізнес, і всі інвойси; розширений Sprint 3 confirm-dialog показує counter якщо > 0.

#### SP-8. Slug-case на інвойсі

Інвойс-slug — **case-sensitive** lookup, на відміну від business-slug (case-insensitive за рішенням Sprint 3 §E1). Чому асиметрія:

- Business-slug — vanity-target (Twitter-style), користувач **роздає** URL і має зберігати читабельність незалежно від регістру.
- Invoice-slug — system-generated у 99% кейсів (3 з 4 пресетів — без user-input case). Phantom value у "case-insensitive lookup для system-generated rаніше зробленого slug-у" дорівнює нулю.
- Альтернатива (теж case-insensitive) — додатково подвоюємо БД-поля (`invoiceSlugLower`), 308-redirect logic, manual-checks UAT — все за нульову UX-користь.

Compound-unique `(businessId, slug)` з Sprint 1 — лишається case-sensitive, як було.

---

### 4.3 Backend — Public Invoices Controller

Окремий controller `PublicInvoicesController` у тому ж модулі. Чому окремий від `PublicBusinessesController`: різні route-сегменти, різні DTO, різні cache-keys; класи обидва маленькі.

- 🔲 GET `/businesses/public/:slug/invoices/:invoiceSlug`:
    - Без guards. `@SkipThrottle()` НЕ ставимо (стандартний 60req/min достатній).
    - Lookup business case-insensitively → lookup invoice (case-sensitive, в межах business.\_id) → 404 на будь-якому з двох.
    - Response — whitelist через `PublicInvoiceSchema.parse` (повертає 7 полів — invoice fields + nested business view + nbuLinks).
    - `Cache-Control: public, max-age=3600, stale-while-revalidate=86400` (як Sprint 3).
- 🔲 GET `/businesses/public/:slug/invoices/:invoiceSlug/qr/business.png` — QR на public-URL інвойсу (`pay.finly.com.ua/{businessSlug}/{invoiceSlug}`). Знак гривні в центрі.
- 🔲 GET `/businesses/public/:slug/invoices/:invoiceSlug/qr/nbu.png?host=primary|legacy` — QR з NBU-payload-link (формат 003) на одну з двох allowed-host адрес. **Payload містить amount + lock-mask + validUntil** через `buildPayloadInputFromInvoice(business, invoice)`.

**DoD:** public endpoint віддає рівно 7 полів (whitelist invariant з `not.toHaveProperty` на leak-кандидати: `business.requisites`, `business.taxationSystem`, `business.isVatPayer`, `business.paymentPurposeTemplate`, `business.ownerId`, `business.managers`); 404 при неіснуючому business або invoice; обидва QR-endpoint-и віддають valid PNG; jsqr round-trip декодує payload з очікуваним amount/lock-mask/validUntil; `Cache-Control` присутні.

---

### 4.4 Frontend — Cabinet секція "Рахунки" на сторінці бізнесу

Розширюємо існуючу `apps/web/src/app/(protected)/business/[slug]/page.tsx`. Без структурних змін до Sprint 3 layout-у — додаємо секцію + counter у card.

- 🔲 Окремий React-компонент `apps/web/src/features/invoices/InvoicesSection.tsx`:
    - Fetch на mount: `GET /businesses/me/{slug}/invoices?page=1&limit=10`.
    - Empty-state з CTA "Виставити рахунок" → `/business/{slug}/invoice/new`.
    - List of `InvoiceCard.tsx` (sub-компонент) з amount (формат `1 500,00 ₴`, окремий util `formatKopecksAsHryvnia`), purpose (truncate 2 lines), status badge (`Активний` / `Прострочено` залежно від `validUntil`), copy-button з public URL.
    - Pagination через "Завантажити ще" infinite-scroll-trigger button (на MVP-масштабі — простіше за номерну пагінацію).
- 🔲 У existing `BusinessSlugPage` — інжект `<InvoicesSection businessSlug={business.slug} />` між `QrSection` і Danger zone.
- 🔲 На головній сторінці `/business` (список бізнесів, Sprint 3 §3.6) — на `BusinessCard` додати рядок counter "{N} активних рахунків" якщо `> 0`. Дані приходять з вже існуючого `GET /businesses/me` — потребує розширення list-response на `invoicesCount` (одне поле в кожній item-картці; cheap aggregation-pipeline на серверній стороні через `$lookup` + `$size` або окремий aggregate).

**DoD:** секція "Рахунки" рендериться на 320/768/1440px, empty/filled states, CTA працює, infinite-scroll протестований; список бізнесів показує counter; clicking на business-card з counter-ом → `business/{slug}` зі скрол-target. Секція "Налаштування рахунків" — інлайн-edit dropdown зберігає `invoiceSlugPresetDefault` через існуючий PATCH-flow (тест: смоук-cycle "обрати `with-month` → reload сторінки → опція збережена"); вибір `with-purpose` тригерить shared confirmation-модалку.

---

### 4.5 Frontend — Створення інвойсу (form-flow)

Новий route `apps/web/src/app/(protected)/business/[slug]/invoice/new/page.tsx`. **Без 4-step wizard** Sprint 3-style — інвойс має 4-5 полів, форма поміщається на одному екрані з логічним grouping-ом (рішення SP-9 нижче).

#### SP-9. Wizard vs single-form для інвойсу — single-form

Відкинутий варіант — multi-step wizard за прикладом Sprint 3 wizard бізнесу. Чому: бізнес мав 8+ полів з coupled-валідацією і вимагав психологічного "розбити простирадло" — інвойс має 4-5 полів, які природно групуються в один екран. Multi-step тут створив би more-clicks-than-fields anti-pattern. Step-pattern Sprint 3 (`StepNavigator`, `BusinessWizardForm`) залишається повторно-використовуваним для майбутніх форм з 6+ полями.

- 🔲 `apps/web/src/features/invoice-create/CreateInvoiceForm.tsx` — RHF + Zod resolver на `CreateInvoiceSchema`.
    - **Поле "Сума"** (`UiInput type="number"`, label "Сума, ₴", placeholder "1500,00", inputMode `decimal`). Підпис нижче "Залиште порожнім, щоб клієнт сам ввів суму у банку" — це режим qr-decisions §1.4.
    - **Switch "Дозволити клієнту правити суму"** (default ON якщо amount=null, OFF якщо amount=number). Disabled якщо amount=null + with hint про SP-6 coupled-rule.
    - **Поле "Призначення платежу"** (`UiTextarea`, default empty → backend null = inheritance from business). Лічильник символів. Placeholder показує `business.paymentPurposeTemplate` як preview "Якщо порожньо — використано: «...»".
    - **Поле "Термін дії"** (`UiSelect` "без терміну" / "до конкретної дати" → conditional `UiInput type="date"`).
    - **Dropdown "Як назвати рахунок"** — **6 опцій**, кожна 1:1 мапить на `slugInput.kind` (SP-1, qr-decisions §4.3.1 три рівні). Жодних unselected-state-ів, dead-branch-ів і опційних варіантів — повне покриття контракту:
        - "Ввести самому" → `kind: 'explicit'` + conditional `UiInput` для `humanPart` з **live-валідацією через `humanSlugPartSchema`** (lowercase, kebab-case, 1..60 chars, без leading/trailing/consecutive dash). Validation покриває **тільки людську частину**, не фінальний slug — UI ніколи не вимагає від користувача знати/набирати 8-char tail (це serverside concern). Підпис нижче "Сервер додасть унікальний хвіст автоматично" + preview результату ("Буде: `<вашHumanPart>-aB3xQ9k7` (хвіст згенерується)").
        - "Автоматично — простий номер" → `kind: 'preset', preset: 'simple'`.
        - "Автоматично — з місяцем" → `kind: 'preset', preset: 'with-month'`.
        - "Автоматично — з роком" → `kind: 'preset', preset: 'with-year'`.
        - "Автоматично — з призначення" → `kind: 'preset', preset: 'with-purpose'`. **Перед першим вибором** — confirmation-modal "Якщо в призначенні написано 'Оплата за роботу з Петренко' — у URL потрапить ім'я Петренка" (qr-decisions §4.3.1.1) з кнопкою "Розумію, обираю" (через `useSlugPresetWarningStore`).
        - "Випадковий код" → `kind: 'random'` (qr-decisions §4.3.1 рівень 3 — "нічого не зроблено, просто хвіст"). Підпис нижче "Найкоротший варіант — лише унікальний код типу `aB3xQ9k7`. Без префікса, без номера. Підходить, коли URL-вид не важливий".
    - **Дефолтна опція dropdown-у — `business.invoiceSlugPresetDefault ?? 'simple'`** (читається з prefetch-нутого `business`-документа). Якщо ФОП у "Налаштуваннях рахунків" обрав `with-month` — форма стартує з `with-month` без додаткового кліку. Якщо `null` (не налаштовано) → `simple` як hardcoded fallback. Чому `simple` як global fallback, а не unselected-state з заблокованим submit: (а) ФОП-онбординг — швидкий шлях ("створити рахунок за 30 сек") дорожчий за конфігурованість; (б) дефолт-`simple` — найбільш нейтральний з усіх (zero-leak, zero-state-drift, інтуїтивно зрозуміла нумерація `inv-001`); (в) повторне натискання "Виставити рахунок" одного й того ж бізнесу не вимагає кожного разу клацати dropdown — продуктивність UX. Проміжний шлях "unselected → submit blocked" відкинутий, бо створює tax на швидкі workflow-и. **Edge case**: якщо бізнес-default = `with-purpose` і це **перший** інвойс ФОП-а на цьому бізнесі — warning-modal (qr-decisions §4.3.1.1) не показується автоматично (модалка тригериться тільки на manual change через dropdown, не на page-load default-і). Це свідомо: `with-purpose` як бізнес-level default має бути obvious-явний вибір ФОП-а у "Налаштуваннях рахунків", де warning теж показується раз на switch-action.
    - Кнопка "Створити рахунок". На submit — POST `/businesses/me/{slug}/invoices` із `slugInput` discriminated payload → redirect `/business/{slug}/invoice/{invoiceSlug}` (canonical slug — з response).
- 🔲 Тести `CreateInvoiceForm.spec.tsx`:
    - Усі варіанти `slugInput.kind` × happy-path → правильний POST payload-shape.
    - `humanSlugPartSchema` live-validation: invalid input (uppercase, дефіс на краях, послідовні дефіси, > 60 chars) → submit blocked; valid input → submit unblocked.
    - Coupled `amount=null + amountLocked` UI lock.
    - Required fields validation.
    - `with-purpose` warning-modal flow (показ при першому виборі, не показ при повторному до перезавантаження сторінки).

**DoD:** форма поміщається на 320px без horizontal-scroll; **усі 6 dropdown-опцій** (explicit + 4 пресети + random) дають valid POST з правильним `slugInput.kind` discriminator-ом; `with-purpose` modal blocks без acknowledge; **default-опція dropdown-у на mount читається з `business.invoiceSlugPresetDefault ?? 'simple'`** і відповідає бізнес-level налаштуванню. Test-cycle покриває обидві гілки `??` без hardcoded-`simple`-assertions:

- (а) бізнес з `invoiceSlugPresetDefault === null` → form mount з `simple` активним;
- (б) бізнес з `invoiceSlugPresetDefault === 'with-month'` → form mount з `with-month` активним;
- (в) бізнес з `invoiceSlugPresetDefault === 'with-purpose'` → form mount з `with-purpose` активним і **без** автоматичного тригеру warning-modal-у (модалка тільки на manual change через dropdown — edge case з §4.5);
- (г) submit без додаткового кліку у dropdown-у дає правильний `slugInput.kind`/`preset` для всіх трьох варіантів вище.

---

### 4.6 Frontend — Кабінет інвойсу `/business/{slug}/invoice/{invoiceSlug}`

Повторне використання Sprint 3 patterns — `EditableField`, `scheduleDeleteWithUndo`, preview-toggle.

- 🔲 Client Component `apps/web/src/app/(protected)/business/[slug]/invoice/[invoiceSlug]/page.tsx` (`'use client'`). Next.js dynamic-folder-параметри: outer `[slug]` — business slug (повторне використання Sprint 3 cabinet shell), inner `[invoiceSlug]` — invoice slug.
    - Client-side fetch обох — `GET /businesses/me/{slug}` + `GET /businesses/me/{slug}/invoices/{invoiceSlug}` (паралельно через `Promise.all`).
    - Top toolbar: back-link до `/business/{slug}`, заголовок "Рахунок №… — {amount-formatted}", preview-toggle, "Відкрити в новій вкладці" → `pay.finly.com.ua/{slug}/{invoiceSlug}`.
- 🔲 Картки-секції (повторно-використовуючи `EditableField` + Sprint 3 design tokens):
    1. **"Сума і блокування"**: amount (editable), amountLocked (coupled SP-6).
    2. **"Призначення"**: paymentPurpose (editable, з показом fallback на business.paymentPurposeTemplate, якщо null).
    3. **"Термін дії"**: validUntil (editable date-picker; "без терміну" як NULL-state).
    4. **"Slug"**: readonly display (immutable post-creation), copy-button, прев'ю pacing на public-URL.
    5. **"QR-картинка"**: рендер `/api/businesses/public/{businessSlug}/invoices/{invoiceSlug}/qr/business.png` (canonical-URL QR) як `<img>` + кнопка "Завантажити".
    6. **"Небезпечна зона"**: видалення з 5s-Undo (повторне використання `scheduleDeleteWithUndo`).
- 🔲 Preview-toggle (SP-2): inline-render `InvoicePublicView` (новий компонент у `apps/web/src/features/invoice-public/`).
- 🔲 Тести: `InvoiceCabinetPage.spec.tsx` smoke + `EditableField` повторне покриття вже є.

**DoD:** усі 6 карток рендеряться, inline-edit працює per field, preview-toggle, undo 5s; status banner "Прострочено" якщо validUntil < now (тільки візуально, без disable redirect-у).

---

### 4.7 Frontend — Public-сторінка інвойсу

Розширення Sprint 3 host-aware routing-у на 2-сегментний path.

- 🔲 **Middleware `apps/web/src/middleware.ts` Branch A розширення.** Поточна regex `/^\/([^/]+)$/` ловить тільки root-slug. Sprint 4 додає випадок `/^\/([^/]+)\/([^/]+)$/` — match на business-slug + invoice-slug → rewrite на `/host-pay/{businessSlug}/{invoiceSlug}`. Reserved-slug check — тільки на першому сегменті (business-slug); invoice-slug — будь-який валідний string (вже unique-blocked у БД per-business).
- 🔲 **Internal route `apps/web/src/app/host-pay/[slug]/[invoiceSlug]/page.tsx`** — Server Component, `revalidate: 60`. Defense-in-depth host check (як Sprint 3). Fetch `GET /businesses/public/{slug}/invoices/{invoiceSlug}` через server-side fetch. 404 → `notFound()`. Canonical-redirect логіка для business-slug (як Sprint 3) — якщо case-mismatch на business-slug, `permanentRedirect('/{canonicalBusinessSlug}/{invoiceSlug}')`. Для invoice-slug canonical-redirect **не робиться** (case-sensitive за SP-8).
- 🔲 **Компонент `apps/web/src/features/invoice-public/InvoicePublicView.tsx`** — переиспользує `PublicBusinessView` Sprint 3 з invoice-overlay:
    - Заголовок: "Рахунок на {amount} ₴" (якщо amount=null — "Рахунок на оплату" — без суми).
    - Sub-info блок над сіткою банків: "Призначення: {purpose}" + "Дійсний до: {validUntil або "без терміну"}".
    - Якщо `validUntil < now`: на місці банків і кнопок — empty-state-banner "Термін рахунку минув. Зверніться до отримувача". Без 11-bank grid, без кнопок, без QR (sanity-block).
    - Інакше — той самий 11-bank grid + 2 active CTAs з `nbuLinks.primary/legacy` (payload містить amount/lock-mask/validUntil) + 2 QR images (на `/api/.../qr/nbu.png?host=`).
- 🔲 SEO: title "Рахунок на {amount} ₴ — {ТипНазваБізнесу}", `noindex` за замовчуванням (на відміну від бізнесу — інвойси **завжди noindex**, бо одноразові і часто містять чутливу інформацію у purpose). `seoIndexEnabled` toggle для інвойсу **відсутній** — навмисно.

**DoD:** middleware-spec покриває 4 нові кейси (host=pay + 2-segment path → rewrite; host=cabinet + /host-pay/2-segment → 404; host=pay + reserved-business-slug + invoice-slug → 404; case-mismatch на business-slug → 308 на canonical business-slug + same invoice-slug); E2E smoke у dev на 320/768/1440px з expired/active/no-amount інвойсами.

---

### 4.8 Cross-cutting

#### Інтеграція з QR-модулем

`QrService` уже готовий (Sprint 2) — приймає `PayloadInput` і опціонально host для 003. Sprint 4 лише викликає його з нового `buildPayloadInputFromInvoice(business, invoice)` mapper-а. Жодних змін у `QrService` / `QrModule`.

#### Convention compliance

- **`as const` enums** — `SLUG_PRESETS` уже Sprint 1.
- **Нові `RESPONSE_CODE` entries** — рівно 4 коди, кожен консумується конкретним service-методом і має UA-string у `mapApiCode.ts`:
    - `INVOICE_NOT_FOUND` (404) — `InvoiceAccessGuard` / `InvoicesService.getBySlug`. UA: "Рахунок не знайдено".
    - `INVOICE_SLUG_GENERATION_FAILED` (500) — `InvoiceSlugGeneratorService` після 11 retry. UA: "Не вдалося згенерувати посилання. Спробуйте ще раз".
    - `INVOICE_AMOUNT_LOCKED_REQUIRES_AMOUNT` (400) — `InvoicesService.create/update` (Sprint 1 Zod-refine на entity, продубльоване write-DTO для UX-friendly inline error). UA: "Заблокувати редагування суми можна лише при заданій сумі".
    - `CASCADE_DELETE_REQUIRES_REPLICA_SET` (500, infra-failure) — `BusinessesService.delete` cascade-handler (рішення SP-5 + §4.0). UA: нейтральне "Не вдалося видалити бізнес. Зверніться в підтримку" — справжню причину видно лише у server-логах, не leak-ається user-у. **Жодних retry-механізмів на frontend** для цього коду — це infra-config issue, не transient.

    Чек-лист синхронізації для рев'юера PR: для кожного нового коду — (а) entry у `RESPONSE_CODE` map (`packages/types/src/enums/response-code.ts`), (б) entry у `RESPONSE_CODE_TYPE` (всі 4 — `RESPONSE_TYPE.ERROR`), (в) UA-message у `apps/web/src/shared/api/mapApiCode.ts` notification-словнику. Без усіх трьох — toast показує raw machine-code і regress на UX.

- **Zod refine `message`-strings** — `AMOUNT_LOCKED_REQUIRES_AMOUNT` (Sprint 1 існує).
- **FSD layering** — нові slices `invoice-create`, `invoice-edit`, `invoice-public`, `invoices-list` як features. Public route — app-layer.
- **Overlays** — slug-pre Confirmation modal для `with-purpose` пресету як `useSlugPresetWarningStore` (in-slice ownership), реєструється у `app/overlays.tsx`.
- **Single-locale uk** — інлайн.
- **Fail-fast** — жодних нових env vars.

#### Manual checks (`docs/manual-checks/README.md`)

Додаємо нові пункти. Стиль файлу — простою мовою, без термінів.

- 🔲 **INV-1.** "Виставив рахунок з фіксованою сумою на 100 грн → відкрив посилання на іншому телефоні → банк показує 100 грн і не дає правити".
- 🔲 **INV-2.** "Виставив рахунок без суми → клієнт сам вписує її у банку → кнопка «Інший банк» відкриває банк з порожньою сумою".
- 🔲 **INV-3.** "Поставив термін дії «вчора» → відкрив публічну сторінку → побачив повідомлення «Термін минув», банків і QR не видно".
- 🔲 **INV-4.** "Видалив бізнес, у якого було 3 рахунки → зникли всі 4 (бізнес + 3 рахунки) — посилання на рахунки 404".
- 🔲 **INV-5.** "Створив рахунок з пресетом «з призначення», у purpose «Оплата за консультацію» → отримав URL з `oplata-za-konsultatsiu-...` → переконався, що при першому виборі виду пресета з'явилась попереджувальна модалка".
- 🔲 **INV-6.** "Створив 5 рахунків з пресетом «простий» → їхні номери `inv-001`, `inv-002`, …, `inv-005` (без дублів)".
- 🔲 **INV-7.** "На головній сторінці `/business` бачу counter `3 активних рахунки` на картці бізнесу → клацаю → відкривається той бізнес зі скролом до секції «Рахунки»".

#### Документація

- 🔲 **`CLAUDE.md`**:
    - "## Domain Model" — додати `Invoice` (повна структура з amountLocked, slugPreset, validUntil) + поле `invoiceSlugPresetDefault` у Business.
    - "## Module Dependency Map" — `InvoicesModule → MongooseModule(Invoice) + BusinessesModule(Business model export) + QrModule + UsersModule`.
    - "## API Overview" — додати таблицю `InvoicesController` (cabinet) + `PublicInvoicesController`.
    - "## Known Complexities" — додати:
        - **Invoice slug-case asymmetry vs business-slug** (SP-8).
        - **Slug-preset counter monotonic per (business, preset)** — без БД-counter поля; aggregation-lookup на створення.
        - **Lock-mask FEFF/FFFF derived from `amountLocked`** — backend-only mapping; frontend оперує boolean.
        - **`validUntil` без timezone** — локальний український час, норматив не уточнює.
        - **Cascade hard-delete atomic-or-nothing.** Mongo `withTransaction` обов'язковий; replica-set — infrastructure-level requirement (Atlas у production, external Mongo replica-set у dev — Atlas dev / Docker з `--replSet rs0` / local mongod-replica-set, на вибір; `MongoMemoryReplSet` у test-suite). `docker-compose.dev.yml` Mongo не запускає — production-parity. Якщо `withTransaction` недоступний — 500 `CASCADE_DELETE_REQUIRES_REPLICA_SET`, жодного delete не виконано. Жодного fallback на 2 sequential deletes — orphan-invoices state свідомо неможливий у production і dev.
- 🔲 **`docs/product/qr-decisions.md`** — closure для §2.3 / §4.3.2 / §4.3.3 / §4.6 (посилання на цей README).
- 🔲 **`docs/sprints/README.md`** — оновити статус Sprint 4 (`[ ]` → `[x]` після завершення).
- 🔲 **`docs/product/business-flow.md`** — у §6 (Free vs Paid) додати рядок "Інвойси (виставлення рахунків) — Free, без ліміту на кількість у MVP. Sprint 6 ревізує."

#### Тестова стратегія

- **API unit:** `InvoicesService.spec.ts`, `InvoiceSlugGeneratorService.spec.ts` (4 пресети + counter), `InvoiceAccessGuard.spec.ts`, `payload-mapper.spec.ts` (fee-cases: amount=null, amountLocked, validUntil, purpose-inheritance).
- **API e2e:** `apps/api/test/invoices.e2e-spec.ts` — full-cycle (CRUD як ФОП у бізнесі; access-deny на чужий бізнес; cascade-delete; public read анонімно; expired-invoice render).
- **Web unit:** `CreateInvoiceForm.spec.tsx`, `InvoiceCabinetPage.spec.tsx`, `InvoicePublicView.spec.tsx`, `host-pay/[slug]/[invoiceSlug]/page.spec.tsx`, `middleware.spec.ts` (нові 4 кейси).
- **Manual UAT:** INV-1..7.

---

## Definition of Done (спринт у цілому)

- 🔲 `pnpm build` зелений (3/3 packages).
- 🔲 `pnpm test` зелений: types з новими contract-spec-ами; api з ~35 нових тестів (CRUD + Guard + slug + service + cascade-delete + e2e); web з ~20 нових (form + cabinet + public + middleware).
- 🔲 `pnpm lint` без NEW warnings (preexisting — далі у tech-backlog).
- 🔲 Cabinet flow — створення інвойсу з 6 slug-опцій (explicit + 4 пресети + random), inline-edit, delete з 5s Undo, секція "Рахунки" на сторінці бізнесу — працюють у dev на 320/768/1440px.
- 🔲 Public flow — сторінка `pay.finly.com.ua/{businessSlug}/{invoiceSlug}` рендериться (з налаштованим `/etc/hosts`); QR з amount/lock-mask/validUntil round-trip-валідний через jsqr; expired-invoice показує банер замість банків.
- 🔲 Cascade-delete працює (в transaction); confirm-dialog Sprint 3 показує counter якщо > 0.
- 🔲 Manual checks `INV-1..7` додані до `docs/manual-checks/README.md`.
- 🔲 `CLAUDE.md` оновлено (Domain Model, API Overview, Module Map, Known Complexities).
- 🔲 `docs/product/qr-decisions.md` отримує closure-маркери для закритих питань §2.3, §4.3.2, §4.3.3, §4.6.

---

## Ризики / TPM-зауваги

### Sprint-blocking

1. **Mongo replica-set як вимога infra.** §4.0 переводить cascade-delete на `withTransaction` без runtime-fallback (рішення SP-5). Production на Atlas — replica-set є за замовчуванням. **Ризик:** developer experience у local-dev — новий developer без replica-set Mongo отримає 500 на cascade-delete, не одразу зрозумівши, що `MONGODB_URI` має точку на replica-set. `docker-compose.dev.yml` Mongo не містить (production-parity, Sprint 4 свідомо не додає). **Mitigation:** root `README.md` має три copy-paste-готових сніпети (Atlas dev / Docker `--replSet rs0` / local mongod), `.env.example` має коментар "must be replica-set"; existing api-test-сьют переходить на `MongoMemoryReplSet` саме для cascade-delete-tests (інші — лишаються на `MongoMemoryServer` для швидкості). CI-step (post-Sprint 4) — startup `replSetGetStatus` warning-log, не fail-fast.
2. **Slug-preset counter race.** При паралельному створенні двох інвойсів того ж пресету одночасно — два `MAX(N)+1` lookup-и можуть отримати однакове значення → один з insert-ів впаде на compound-unique. **Mitigation:** `try/catch` на 11000 у `InvoicesService.create` з retry (до 3 спроб) — еквівалент Sprint 3 race-handling-у на slug-collision. Acceptable затримка ~50ms у нереально рідкісному кейсі.
3. **`with-purpose` transliteration може дати порожній рядок** для purpose з самим лише emoji / non-cyrillic-non-ascii / лише пробіли. **Mitigation:** після transliteration + slugify — якщо результат empty → fallback на рівень 3 (тільки tail). UI попередження не показує (не помилка ФОП-у — це expected behavior).
4. **Розширення middleware на 2-сегментний path** ламає Sprint 3 invariant "тільки root-slug на pay-host". **Mitigation:** middleware-spec повинен включити повне regression-coverage Sprint 3 6 кейсів + 4 нових — без цього тест-сьюту регресія йде непомітно. Тест-suite Sprint 3 готовий до розширення.

### Out-of-scope, але закладене коректно

1. **Phase 1.5 трекінг оплат через `paidAt`** — `Invoice` Sprint 1 закладений як schema-immutable без `paidAt`/`paymentStatus` (qr-decisions §1.12). Додавання — `$set` нового поля без переписування існуючих.
2. **Cron expired-invoices cleanup** — index `{validUntil: 1, sparse: true}` Sprint 1 заклав. Cron — Phase 1.5+ через `ReservationReconcileService`-style pattern.
3. **Bulk-операції / шаблони** — Sprint 6 при появі реального запиту.
4. **Per-bank deep-links на public-сторінці інвойсу** — Sprint 5. UI готовий (11 неактивних логотипів + 2 NBU кнопки) — Sprint 5 розблокує без архітектурних змін.
5. **Paid-ліміт на кількість інвойсів** — Sprint 6. Архітектурно `InvoicesService.create` готовий додати guard на `Invoice.countDocuments({businessId})` без переписування service-layer.
6. **Custom invoice-slug edit post-creation** — навмисно out-of-roadmap (на відміну від бізнесу). Якщо Phase 1.5+ продукт-feedback покаже потребу — окрема ініціатива.

### Залишковий продуктовий ризик

**"Модель А" нагадування** (qr-decisions §1.12): MVP Sprint 4 — це **тупий генератор**. ФОП виставляє рахунок, клієнт оплачує через банк, **Finly не знає, чи прийшла оплата**. Reality-check для маркетингу: на public-сторінці інвойсу не варто обіцяти "ми скажемо вам, коли клієнт заплатив" — це буде брехня в MVP. Sprint 4 deliverable — генератор, не tracker. Якщо post-launch feedback покаже "за що ми платимо, якщо все це я й так бачу в Monobank" — це і є тригер для Phase 1.5 рішення про Open Banking-інтеграцію (Phase 1.5 — інша велика розмова, не Sprint 5/6).

---

## Послідовність робіт (рекомендована)

1. **§4.0 Infra-prep — Mongo replica-set.** Перший — без replica-set §4.2 cascade-delete не пройде. `MongoMemoryReplSet` для test-сьюту, документація у root `README.md` (три варіанти: Atlas dev — обидва режими; Docker `--replSet rs0` — обидва режими з Linux-specific `--add-host` + `extra_hosts` для Режим C; local mongod — тільки Режим H), коментар у `.env.example`. **Єдина compose-зміна** — `extra_hosts: ["host.docker.internal:host-gateway"]` у `api`-блоці (2 рядки yaml, для Linux у Режимі C); Mongo service у compose НЕ додається — production-parity (~0.5 дня).
2. **§4.1 Schema розширення + slug-генератор.** Підкладає фундамент для §4.2. Включає 4 пресети + tests на counter monotonicity + transliteration `with-purpose`. (~1 день).
3. **§4.2 Backend CRUD + cascade-delete.** Найбільший backend-епік. Розширення Sprint 3 service + контролер + новий guard + atomic cascade. (~2 дні).
4. **§4.3 Public Invoices Controller.** Тривіально після §4.2 (~0.5 дня).
5. **§4.5 Frontend — створення інвойсу.** Single-form з 6 slug-опціями (explicit + 4 пресети + random) і `with-purpose` warning-modal. (~1 день).
6. **§4.4 Frontend — секція "Рахунки" на сторінці бізнесу.** List + counter + extended `getBySlug` response. (~0.75 дня).
7. **§4.6 Frontend — кабінет інвойсу.** Inline-edit + preview-toggle + delete-undo. Повторно використовує Sprint 3 primitives. (~1.5 дня).
8. **§4.7 Frontend — public-сторінка інвойсу + middleware extension.** Розширення Sprint 3 host-aware routing-у. (~1 день).
9. **§4.8 Cross-cutting cleanup.** Manual checks, CLAUDE.md, qr-decisions closure-маркери, business-flow.md. (~0.5 дня).
10. **Регресія + smoke у dev на трьох viewport-ах + manual prep INV-1..7.** (~0.75 дня).

**Загалом:** ~9.5 робочих днів для одного інженера (з infra-extension §4.0). При 2 інженерах (один backend + slug-generator + cascade + infra, інший — frontend create + cabinet + public) — calendar 5–6 днів. Public-сторінка інвойсу і кабінет інвойсу — найризиковіші для UX-регресій (повторне використання Sprint 3 primitives робить їх швидкими, але середнім бутстреп-вікном для regression-тестування).

---

## TPM-фідбек чесний (об'єктивне резюме)

- **Sprint 4 — найменш ризикований з точки зору архітектури.** Усі primitive-и готові: slug-генератор pattern Sprint 3, BusinessAccessGuard, EditableField, scheduleDeleteWithUndo, host-aware middleware, PublicBusinessView як reusable composite. Backend additions — додати один service, один controller, один guard, один payload-mapper.
- **Найбільший ризик — UX consistency.** Sprint 3 встановив високий стандарт inline-edit / preview-toggle / 5s-Undo / вертикальної ієрархії bizness-secions. Sprint 4 повинен **точно** його повторити для інвойсу, без "трохи інакше зробимо тут". Перший огляд PR має шукати дрифт.
- **Counter monotonicity для slug-presets — підступний edge-case.** Імплементація через aggregate `MAX(N)+1` без явного counter-поля у БД — простіше і консистентніше з Модель-А-філософією, але **обов'язково** treба test на перегонів. Sprint-blocking risk #2 — реальний.
- **Cascade-delete — критичне рішення.** Альтернатива (заборона delete) виглядає "безпечнішою", але створює ситуацію, коли ФОП застряє в кабінеті бізнесу зі 50 старих інвойсів, які ніхто не хоче чистити вручну. Cascade + clear warning + 5s-Undo — кращий UX, бо повторюється Sprint 3 паттерн (один-кліковий "вийти з продукту з конкретного бізнесу"). Контракт — **atomic-or-nothing через `withTransaction`**, без fallback (рішення SP-5 + §4.0). Замість того щоб приймати orphan-invoices state як норму — піднімаємо вимогу replica-set на infra-layer; production (Atlas) уже їй відповідає, dev — developer обирає один з трьох документованих шляхів: (а) Atlas dev cluster як zero-friction default (працює для обох Режимів H/C); (б) standalone Docker Mongo з `--replSet rs0` (обидва режими, з Linux-specific `--add-host` + `extra_hosts` alias для Режим C); (в) local mongod-replica-set (тільки Режим H — Режим C на Linux крихкий через heartbeat-resolve). Member-host у `rs.initiate()` явно фіксується (`localhost` для H, `host.docker.internal` для C), `directConnection`-параметр НЕ додаємо (Node driver default `false` саме те, що потрібно для replica-set transactions). Sprint 4 не додає Mongo service у `docker-compose.dev.yml` (production-parity), єдина compose-зміна — `extra_hosts: ["host.docker.internal:host-gateway"]` alias для Linux у Режимі C. Залишковий ризик переноситься з runtime-data-corruption на DX (developer-experience): новий developer без replica-set Mongo отримає 500 на cascade-delete, що сигналізує infra-misconfig, не data corruption — root `README.md` має onboarding-секцію зі сніпетами для обох workflow-режимів.
- **`with-purpose` пресет — кандидат на виключення зі скоупу при стиску.** Він єдиний потребує transliteration UA→latin, slugify, warning-modal-flow. Якщо ресурси обмежені — переносимо у Sprint 6 разом з vanity-features. 3 пресети (`simple` / `with-month` / `with-year`) покривають 90% реальних UX-кейсів.
- **Manual UAT INV-1..7 — обов'язковий блокер закриття спринту.** Unit/e2e-тести покривають payload-генерацію і CRUD, але live-банк-додатки на реальному телефоні з `amount=1500` і `lockMask=FFFF` — не покривають. Минулий Sprint 3 поки що pending UAT — Sprint 4 не повинен повторити цю асинхронність.
