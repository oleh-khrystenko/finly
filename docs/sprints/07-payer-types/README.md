# Sprint 7 — QR-код для всіх типів платників

> **Статус (на 2026-05-08):** заплановано, не стартував.
> **Передумови:** Sprint 1 (`Business.type` enum-поле), Sprint 2 (QR-payload-builder з `PayloadInputSchema.receiverTaxId`), Sprint 3 (cabinet wizard, `BasicSection`, `TaxationSection`, `RequisitesSection`, `PublicBusinessView`), Sprint 4 (інвойсний flow читає `business.requisites.taxId` через `buildPayloadInputFromInvoice`) — закриті у функціональному обсязі. Sprint 5/6 не блокують Sprint 7 і навпаки.
> **Що розблокує:** маркетинговий запуск на не-ФОП-сегмент (індивідуали для зборів, ОСББ, благодійні фонди, ТОВ); розширює TAM продукту з ~1.9 млн ФОП до ~2 млн ФОП + кілька десятків тисяч ОСББ + сотні тисяч індивідуальних кейсів.
> **Контекст рішень:** продукт-теза з [`docs/sprints/README.md` §7](../README.md). Технічна основа — норматив НБУ постанови № 97, додатки 3/4, поле "Код одержувача": дозволяються 8 цифр (ЄДРПОУ) АБО 10 цифр (РНОКПП). Sprint 7 закриває цю асиметрію на рівні валідаторів, схеми `Business`, write-DTO, wizard-форми і public-вивіски.

---

## Мета

Закрити обмеження "Finly = тільки для ФОП": дати чотирьом типам платників (фізособа / ФОП / ТОВ / неприбуткова організація) можливість виставити робочий платіжний QR і посилання, заповнюючи **тільки поля, що мають юридичний сенс для їхньої форми**.

Архітектурно — це **розширення `Business.type` з одного варіанта (`'fop'`) на чотири**, з відповідним розгалуженням валідації коду одержувача (10 vs 8 цифр) і умовністю податкових полів (тільки для `fop` і `tov`). Жодних нових сутностей, жодних нових routing-зон, жодних нових public-endpoints — це **dimension extension** існуючої моделі, не нова доменна площина.

---

## Скоуп

### Backend (`apps/api`)

- 🔲 `BusinessSchema` (Mongoose) робить `taxationSystem` і `isVatPayer` **необов'язковими полями** — без default-значень, **без enum-fallback-у**. Для `type ∈ {individual, organization}` ці поля лишаються `null`; для `type ∈ {fop, tov}` — required на write-DTO рівні (Zod). Жодних магічних дефолтів типу "Загальна, без ПДВ" для організацій — це створює data-corruption-state (публічна сторінка віддавала би неправдиву інформацію).
- 🔲 `BusinessesService.create / update` отримує **type-aware coupled-check**: при PATCH без переданого `type` (а він **immutable** post-creation, див. SP-8) сервіс читає документ-resident `type` з БД і відкидає невалідну пару (`type=individual` + переданий `taxationSystem` → 400 `TAXATION_NOT_APPLICABLE_FOR_TYPE`). Це той самий патерн, що Sprint 3 робив для `taxationSystem × isVatPayer` (DB-read для partial-PATCH cross-field).
- 🔲 `BusinessesService.create` валідує `requisites.taxId` згідно `type` (10 цифр + checksum для `individual|fop`; 8 цифр для `tov|organization`). Поле зберігається як та сама `string` без розгалуження за форматом — discriminator живе **виключно у валідаторі**, не у структурі документа. На лінії БД `Business.requisites.taxId: string` лишається.
- 🔲 `payload-mapper` (`buildPayloadInputFromBusiness` + `buildPayloadInputFromInvoice` зі Sprint 4) **не змінюється** — він уже передає `business.requisites.taxId` як-є у `receiverTaxId`. Розширення приймальної здатності — на рівні `PayloadInputSchema` (див. Shared).
- 🔲 Нічого не змінюється у public-endpoints (`PublicBusinessesController`, `PublicInvoicesController`) у плані routing або whitelist-полів. Зміна — лише **трактування `business.type` у view-side build heading-тексту**, що відбувається повністю на frontend (див. Frontend / SP-5). Public JSON-shape лишається 6/7 whitelist-полів — `taxationSystem`/`isVatPayer` НЕ leak-аються (інваріант Sprint 3 не порушений; вони і не були у whitelist).

### Frontend (`apps/web`)

- 🔲 `Step1TypeName` стає `Step1TypeAndName` — справжній вибір з 4 radio-cards (замість Sprint 3 disabled-pseudo-вибору з підписом "Поки що підтримуємо лише ФОП"). Кожна картка має короткий one-liner-підпис, що **знімає UX-плутанину** між схожими типами (наприклад, ТОВ vs Організація обидва — юр.особи з ЄДРПОУ).
- 🔲 `BusinessWizardStore` отримує **dynamic step-list**, що залежить від `formData.type`: для `fop|tov` — 4 кроки (Type+Name → Requisites → Taxation → PurposeBanks); для `individual|organization` — 3 кроки (Type+Name → Requisites → PurposeBanks). `StepNavigator` рендерить індикатор "Крок 2 з 3" або "Крок 2 з 4" відповідно, без skip-екрана-заглушки.
- 🔲 `Step2Requisites` — поле "Код одержувача" набуває **type-aware поведінки**: label, placeholder, maxLength input-у, live-validator. Sprint 7 розщеплює існуючий `taxId`-input на дві логічні UI-варіації (одне поле з контекстною label-ою; **не два окремих field-а**), щоб JSON-shape лишився єдиним.
- 🔲 `Step3Taxation` лишається без структурних змін — просто не рендериться wizard-ом для `individual|organization`. Defensive: якщо store-state ламається і wizard форсує step 3 для не-taxation-type — компонент сам редіректить на step 4 (sanity-fail-safe, не очікуваний шлях).
- 🔲 `BasicSection` (cabinet edit) — `type` лишається **read-only label-ом** (immutable, SP-8), але `BUSINESS_TYPE_LABEL` мапиться на 4 значення, не одне.
- 🔲 `RequisitesSection` (cabinet edit) — той самий `taxId`-input з контекстною label-ою/валідатором за `business.type`. Validation-error message при typo враховує тип ("РНОКПП має 10 цифр" vs "ЄДРПОУ має 8 цифр").
- 🔲 `TaxationSection` (cabinet edit) — **рендериться лише** коли `business.type ∈ {fop, tov}`. Для `individual|organization` секція не входить у DOM (а не "disabled" чи "приховано через CSS"), щоб користувач не отримував шуму з нерелевантних полів.
- 🔲 `PublicBusinessView` heading — Sprint 7 переходить з шаблону "Оплата на {Тип} {Назва}" на **єдиний нейтральний шаблон** "Платіж на користь {name}" для всіх 4 типів (SP-5 rationale). Це знімає лінгвістичну незграбність "Оплата на фізособа Іваненко" і робить heading-helper pure-функцією від `name` (не від `type`). Type лишається у JSON-shape `PublicBusinessSchema` — використовується frontend-ом для `<title>` SEO-метатегу і aria-label-у, але **не у h1-heading**.
- 🔲 `InvoicePublicView` heading — той самий pattern: "Рахунок №… на 1500 грн" як було (Sprint 4), без зміни. Інвойсна heading вже tип-нейтральна.
- 🔲 Адаптивність mobile-first (`responsive.md`); радіо-картки на Step1 розкладаються 2×2 на мобілці, 4-в-ряд на ≥md.

### Shared (`@finly/types`)

- 🔲 `BUSINESS_TYPES` розширюється з `['fop']` до `['individual', 'fop', 'tov', 'organization']` (`as const`-tuple). Порядок зафіксований — frontend wizard рендерить radio-cards у цьому порядку (SP-1 нижче пояснює чому саме такий).
- 🔲 `BUSINESS_TYPE_LABEL` дає UA-короткий label для кожного:
  - `individual` → "Я особисто"
  - `fop` → "ФОП"
  - `tov` → "ТОВ"
  - `organization` → "ОСББ / фонд / громадська"
- 🔲 Новий helper `requiresTaxation(type): boolean` — single source of truth для conditional-логіки frontend-у і service-layer cross-check-ів. Returns `true` лише для `fop|tov`. Окрема const-tuple `TAXATION_REQUIRED_TYPES = ['fop', 'tov']` — щоб refine-помилка читала тип, а не зашитий перелік.
- 🔲 Новий helper `taxIdLengthFor(type): 8 | 10` — для UI maxLength та message-mapping. Returns `10` для `individual|fop`, `8` для `tov|organization`.
- 🔲 **Нова public-helper-мапа `PAYMENT_HEADING_TEMPLATE`** виноситься поза scope (SP-5: heading стає універсальним; map не потрібна). Це — навмисна no-op-точка плану: "розглянули, відкинули, не пишемо".
- 🔲 `validation/tax-id.ts` отримує **другий валідатор `legalEntityTaxIdZod`** (8 десяткових цифр). Існуючий `individualTaxIdZod` не змінюється (10 цифр + checksum-РНОКПП). Sprint 7 НЕ перейменовує `individualTaxIdZod` у `residentTaxIdZod` чи подібне — стабільність публічного API `@finly/types` важливіша за косметичну консистентність назв (Sprint 4 invoice-payee-snapshot уже locked-in цей імпорт у multiple consumer-ах).
- 🔲 **Checksum для ЄДРПОУ — НЕ реалізуємо у Sprint 7** (SP-2 нижче). `legalEntityTaxIdZod` валідовує лише `^\d{8}$`. Окремий ticket у `tech-backlog.md` фіксує можливість додати ДКСУ-checksum після збору реальних кейсів — без блокування Sprint 7.
- 🔲 Новий combined-валідатор `payerTaxIdZod = z.union([individualTaxIdZod, legalEntityTaxIdZod])` — приймає або 10-цифровий РНОКПП, або 8-цифровий ЄДРПОУ. Використовується у `PayloadInputSchema.receiverTaxId` (заміна існуючого `individualTaxIdZod`). Це **єдиний breaking-touch** на QR-builder; pure-функціональні NBU builder-и (002 / 003) не міняються — вони не валідовують taxId-довжину окремо, лише через input-schema.
- 🔲 `BusinessRequisitesSchema` (Zod) перестає hardcoded-приймати `individualTaxIdZod` і набуває `taxId: z.string()` без формат-refine на рівні sub-схеми. Формат-валідація переїжджає у **type-aware refine `BusinessSchema`/`CreateBusinessSchema`** (SP-3), бо валідний taxId-формат залежить від `type`, який живе на рівні `Business`, не `BusinessRequisites`.
- 🔲 `BusinessSchema` (entity Zod) набуває нових refine-ів:
  - `(b.type ∈ TAXATION_REQUIRED_TYPES) ⇔ (b.taxationSystem !== null && b.isVatPayer !== null)` — exactly-iff (обидва напрями), щоб не було ні missing-data для ФОП/ТОВ, ні garbage-data для individual/organization.
  - `taxId-формат відповідає type` (10+checksum для individual/fop; 8-digits для tov/organization).
  - Існуючий `INVALID_VAT_FOR_TAXATION_SYSTEM` refine лишається без змін, але активується **тільки коли поля не-null** (тобто type ∈ taxation-required).
- 🔲 `taxationSystem`-field у `BusinessSchema` стає `taxationSystemSchema.nullable()`; `isVatPayer` — `z.boolean().nullable()`.
- 🔲 `CreateBusinessSchema` стає **discriminated union по `type`** з 4 варіантами (`'individual' | 'fop' | 'tov' | 'organization'`). Кожен варіант явно описує власний набір полів — TAxation-поля присутні лише у `fop|tov` варіантах. Це робить compile-error для будь-якого frontend-handler-а, що передасть taxation-поля у individual-payload (Sprint 7 додає не-trivial dimension; discriminated union — найдешевша гарантія exhaustiveness).
- 🔲 `UpdateBusinessSchema` лишається **`.partial().strict()` single-shape** (НЕ discriminated union), бо partial-PATCH не несе `type` (`type` immutable, SP-8). Cross-field-перевірка "чи дозволені taxation-поля для цього `type`" — на service-layer (читає документ з БД, валідує проти переданого payload-у). Це той самий pattern, що Sprint 3 для `taxationSystem × isVatPayer`-coupling без `type`-context-у.
- 🔲 `PublicBusinessSchema` — **без змін у whitelist** (`type, name, slug, acceptedBanks, seoIndexEnabled, nbuLinks`). `type` уже у схемі; для frontend-у достатньо.

### Migrations

- 🔲 **Жодного DB-migration script-а Sprint 7 не пише.** Sprint 1/3 закладали `BUSINESS_TYPES = ['fop']`, тому всі існуючі документи мають `type='fop'` і заповнені `taxationSystem`/`isVatPayer`. Розширення enum-у з 1 до 4 значень — pure additive (Mongoose enum-validation на load не падає; Zod-entity-схема після SP-3 теж не падає, бо `type='fop'` + non-null taxation-поля проходять обидва нові refine-и). Поля стають nullable у новій schema — backward-compat (existing-doc not-null значення лишаються валідні).
- 🔲 Acceptance: smoke-тест на staging, що один реальний ФОП-документ Sprint 3 успішно вантажиться через нову Zod-entity-схему без validation-error.

---

## НЕ-скоуп

- ❌ **Підтипи юридичних осіб (ПрАТ, ПАТ, КП, ДП)** — Sprint 7 згортає всі комерційні юр.особи з ЄДРПОУ у один bucket `'tov'`. Юридично ПрАТ ≠ ТОВ, але payment-flow для них ідентичний (8-цифровий ЄДРПОУ + taxationSystem + isVatPayer). Окремі enum-варіанти створили б UX-шум без бізнес-користі. Якщо feedback покаже, що користувач хоче бачити "ПрАТ" у heading-у — це point-fix у `Business.legalFormLabel` (free-text-поле), не розширення `BUSINESS_TYPES`.
- ❌ **Розрізнення підтипів організацій (ОСББ vs благодійний фонд vs громадське об'єднання)** — той самий argument: payment-flow ідентичний (8-цифровий ЄДРПОУ + без taxation-полів). Маркетингова диференціація (icon-ка в radio-card-і) — UX-питання, не data-model.
- ❌ **ЄДРПОУ-checksum валідатор** — SP-2 нижче пояснює рішення відкласти. Tech-backlog-ticket фіксує можливість.
- ❌ **Bookkeeper-toggle для не-ФОП-кейсів** — Sprint 3 рішення E5 закладено, що toggle "Я бухгалтер" фільтрує бізнеси за ownership. Sprint 7 НЕ змінює цю логіку: бухгалтер вибирає `type` так само, як і власник; null-owner режим (Sprint 3) працює для всіх 4 типів без змін.
- ❌ **Sprint 5/6 інтеграція** — per-bank deep-links і Free/Paid гейти не залежать від `type`. Sprint 7 не вносить нічого, що блокує або розблоковує ці спринти.
- ❌ **Зміна публічного routing-у або whitelist-у** — public-зона лишається 6 полів, host-aware middleware не торкаємось, jsons-shape лишається ті ж 7 fields для invoice-public-view.
- ❌ **Type-change post-creation flow** — SP-8 фіксує immutable type. Якщо ФОП юридично перетворився на ТОВ, це нові реквізити, новий taxId, новий бізнес-обʼєкт. Migration-flow "ФОП → ТОВ" — не MVP-кейс, ризики занадто великі (історичні інвойси під старим taxId стають неконсистентні).
- ❌ **Dynamic UA-локалізація heading-у "Оплата на {Тип}"** — SP-5 уніфікує heading. `BUSINESS_TYPE_LABEL` лишається тільки для labels у read-mode UI (BasicSection, public meta-tags), не для heading-у h1.
- ❌ **Free-text legal-form-label** ("ТОВ Каса Здоров'я" → ФОП хоче "Громадська спілка ...") — це Sprint 6+, бо завʼязано на vanity-фічі (custom поле, що показується у public).

---

## Закриті продуктові рішення

> Discharge-list. Кожне рішення з rationale; не закриваємо "бо так хочеться".

### SP-1. `BUSINESS_TYPES` — 4 значення і їх порядок

**Тuple:** `['individual', 'fop', 'tov', 'organization']` (`as const`).

**Чому саме ці 4, не більше і не менше.**
- Норматив НБУ дає 2 формати taxId (10 vs 8) — це **технічна вісь** (X).
- Юр-семантика дає 2 кластери: "комерційна діяльність з оподаткуванням" vs "не комерційна / приватна" — це **продуктова вісь** (Y).
- Декартова крос-таблиця 2×2 → 4 значення:
  - `(10, comm)` = `fop` (приватна особа з податковою активністю)
  - `(10, non-comm)` = `individual` (приватна особа без оподаткування — збори, подарунки)
  - `(8, comm)` = `tov` (юр.особа з оподаткуванням)
  - `(8, non-comm)` = `organization` (неприбуткова юр.особа)
- Будь-яке інше значення (наприклад, ФОП на патенті) — підваріант одного з 4, не нове enum-значення.

**Чому саме такий порядок** (`individual → fop → tov → organization`):
- Wizard радіо-картки рендеряться зверху-вниз / зліва-направо у цьому порядку.
- Психологічний "найпростіший спочатку" сценарій: фізособа збирає на пицу — найшвидший шлях; ФОП — найчастіший комерційний кейс продукту (Sprint 3 baseline); ТОВ — менш частий, але рівноцінно валідний; organization — найрідший, замикає список.
- Альтернативний "юр-каскад" (комерц перед некомерцом) дав би `fop → tov → individual → organization`, але це загромаджує первинний cohort користувачів (індивідуалів) у нижній half wizard-а.

### SP-2. ЄДРПОУ-checksum — не валідуємо у MVP

**Рішення:** `legalEntityTaxIdZod` приймає `^\d{8}$` без checksum-перевірки.

**Чому не реалізуємо ДКСУ-checksum зараз.**
1. Алгоритм має 2-фазну логіку (друге проходження з вагами 3..9 у разі залишку 10 на першому проході) і edge-cases (legacy-коди до 1992 для державних підприємств, нерезидентські коди, коди філій). Naive-implementation відсіче 5-10% валідних реальних ЄДРПОУ як false-negative — для MVP, де ми **намагаємося відкритись на нові сегменти**, заблокований ОСББ зі старим легітимним кодом — гірший провал, ніж пропущений typo.
2. ЄДРПОУ — публічний реєстр (юрособу можна перевірити на opendatabot за 5 секунд). ФОП-checksum РНОКПП мав сенс, бо РНОКПП — особистий код, його легко зробити з помилкою при ручному введенні; ЄДРПОУ зазвичай copy-paste з документа.
3. Реальний контроль "чи код валідний" робить банк-додаток клієнта при списанні. Finly як "тупий генератор" (Модель А, qr-decisions §1.12) не претендує на повну корекцію реквізитів.
4. Реалізація відкладається у `tech-backlog.md` як низькопріоритетний tech-debt-ticket; додавання checksum пізніше — non-breaking (нові документи можуть мати помилку тільки коли writer ігнорує warning, що uncommon).

**Чому НЕ йдемо у компроміс "checksum як warning, без блоку submit"** — це не паттерн поточного codebase: всі Zod-validators тут блокуючі, RHF не має concept "warning issue", і додання нового рівня помилок ламає universal `mapValidationCode` mapping. Не виправдано на 5% case coverage.

### SP-3. Coupled-валідація `(type) × (taxationSystem, isVatPayer)`

**Інваріант:** `(b.type ∈ TAXATION_REQUIRED_TYPES) ⇔ (b.taxationSystem !== null && b.isVatPayer !== null)`. Точне iff, обидва напрями.

**Чому два напрями (а не лише `⇒`).**
- `⇒` (forward): ФОП без taxationSystem — невалідна data (UI ще не дозволяє submit без вибору, але curl-payload без поля провалився б тихо у БД).
- `⇐` (backward): individual з заповненим taxationSystem — це data-corruption-state. Якщо ОСББ помилково отримає `taxationSystem='general'` (через API-bug у майбутньому коді), public-вивіска НЕ покаже це поле (whitelist), але внутрішня БД матиме сміттєві дані, що не drop-аються при наступному migration. Backward-direction блокує цей gate.

**Implementation:**
- Zod entity refine у `BusinessSchema` — інваріант для read-side, спрацьовує на load.
- Zod write-DTO — discriminated union по `type` (CreateBusinessSchema), де taxation-поля є лише у `fop|tov` варіантах; `individual|organization` варіанти просто не мають цих полів у схемі (Zod `.strict()` reject-ить будь-який extra-key payload).
- Update — service-layer cross-check (читає `type` з БД, валідує що PATCH-payload не містить taxation-полів для individual/organization; або, навпаки, що clear-out (передача `null`) для fop/tov не дозволено окрім як разом з зміною `type`, що сам по собі заборонено).
- Existing `INVALID_VAT_FOR_TAXATION_SYSTEM` refine (Sprint 3 C1) залишається; активний лише коли обидва поля не-null (для individual/organization вони обидва null — refine коротко-замикається на тривіально-true).

### SP-4. taxId-формат — discriminated за `type`, single string у БД

**Рішення:** на write-DTO рівні `requisites.taxId` валідується через type-aware refine, що читає сусіднє поле `type`. У БД зберігається без розгалуження за форматом — те саме `BusinessRequisites.taxId: string`.

**Чому не два окремих поля** (наприклад, `requisites.rnokpp10 | requisites.edrpou8`):
- Public NBU payload-builder (`buildPayloadInputFromBusiness`) читає одне поле `taxId`. Зберігання його у двох — додатковий branch у mapper-і без виграшу.
- Mongoose-схема стає простішою (одне string-поле), index-и не міняються.
- Zod-validation per-type — тривіальний refine, не складніше за існуючий `taxationVatCheck`.

**Чому не валідувати taxId всередині `BusinessRequisitesSchema` (sub-schema):**
- `BusinessRequisitesSchema` не знає про `type` (вона sub-object у `Business`); refine з context-доступом до parent-fields у Zod вимагав би переїзду refine-у на parent-level.
- Sprint 7 явно переносить taxId-format-refine на `BusinessSchema` / `CreateBusinessSchema`, де `type` доступний як сусідне поле. `BusinessRequisitesSchema` лишається структурною схемою (`iban: ibanZod`, `taxId: z.string()`).

### SP-5. Heading template — універсальний, type-нейтральний

**Рішення:** на public-сторінці бізнесу — heading **"Платіж на користь {name}"** для всіх 4 типів. На public-сторінці інвойсу heading лишається Sprint 4 ("Рахунок №… на 1500 грн" — type-нейтральний з рождення).

**Чому не type-driven шаблон** (наприклад, `'Оплата на ${BUSINESS_TYPE_LABEL[type]} ${name}'`, як було Sprint 3):
- "Оплата на фізособа Іваненко" звучить лінгвістично неприродно; "Оплата на ОСББ Каса Здоров'я" — нормально, але змішування 4 шаблонів у frontend-helper-і дає крихкий код для маргінальної UX-користі.
- Назва бізнесу зазвичай уже містить юр-форму ("ФОП Іваненко І.І.", "ТОВ Каса Здоров'я", "ОСББ Покрова") — heading префікс дублює інформацію, а для individual-у назва часто проста ("Іваненко І.І.") і додавати "Я особисто" як префікс на public-сторінці клієнту — дивно і не несе платіжної цінності.
- "Платіж на користь {name}" — нейтральне юр-формулювання, що працює і для ФОП, і для пожертв на ОСББ, і для індивідуального збору.

**Що збережено type-aware:**
- `<title>` SEO meta — формується з `BUSINESS_TYPE_LABEL` для пошукової видачі (опціонально, не блокер).
- `BasicSection` cabinet read-mode — показує `BUSINESS_TYPE_LABEL[type]` у блоці "Тип" (UX-довідка для самого ФОП).

### SP-6. Wizard — dynamic step-list

**Рішення:** wizard будує `steps[]` залежно від `formData.type` після Step1.
- `'fop' | 'tov'` → 4 кроки: `type-name → requisites → taxation → purpose-banks`.
- `'individual' | 'organization'` → 3 кроки: `type-name → requisites → purpose-banks`.

**Чому не статичні 4 кроки з skip-екраном-заглушкою** для individual/organization:
- Користувач бачить "Крок 3 з 4: Оподаткування — пропускаємо" і втрачає довіру: "чому система запитала, якщо мені не треба?"
- Skip-екран — додатковий UX-step без значення, на mobile (де кожен tap дорогий) — реальний шум.

**Чому не статичні 3 кроки + opt-in "розширене" для fop/tov:**
- Saxon path для ФОП (>50% користувачів Sprint 3) — поточний 4-крок-flow. Робити його через додатковий tap "Я хочу ввести податкову систему" — погіршення для baseline-cohort на користь нових сегментів. Dynamic-step-list — neutral для ФОП, виграш для individual/organization.

**Implementation note:** `BusinessWizardStore.steps: string[]` обчислюється computed-getter-ом з `formData.type`. `StepNavigator` рендерить індикатор з `steps.length`; назад-кнопка йде по тому ж масиву.

### SP-7. Cabinet edit — `TaxationSection` conditional unmount

**Рішення:** `TaxationSection` рендериться **лише якщо** `business.type ∈ {fop, tov}`. Для individual/organization секція не входить у DOM (не схована через CSS, не disabled).

**Чому unmount, а не disabled:**
- Disabled-секція з 2 пустими полями (taxationSystem dropdown, isVatPayer toggle) — UX-шум для індивідуала, що зайшов на свою сторінку зборів.
- Unmount гарантує, що `business.taxationSystem === null` (yes, JSON-shape віддає null) не покаже "—" або порожнє місце; секція просто відсутня.

**Vertical stack для individual/organization:** 6 секцій (Sprint 3 7 — 1 = 6) + Sprint 4 додав 2 (`InvoicesSettingsSection`, `InvoicesSection`); підсумок — **8 секцій** для individual/organization, **9 секцій** для fop/tov. Порядок не міняється; "пропуск" посередині визначається відсутністю.

### SP-8. `type` immutable post-creation

**Рішення:** `type` фіксується при `POST /businesses/me`, потім ніколи не змінюється. `UpdateBusinessSchema` навмисно не містить `type`-поле; service-layer reject-ить будь-яку спробу через DTO-strict.

**Чому immutable** (а не "правка через окремий type-migration endpoint"):
- Зміна `type` тягне 4 каскадні revalidation-и: taxId-формат (10 vs 8), taxationSystem-presence, isVatPayer-presence, paymentPurposeTemplate-семантика. Жоден з цих revalidation-ів не безпечний без user-input-у — тобто "правка через PATCH" неможлива, потрібен новий wizard-flow.
- Існуючі інвойси (Sprint 4) snapshot-ять `payee.taxId` з business у момент створення (Sprint 4 §SP-payee-snapshot, commit `878ec92`). Зміна `type` бізнесу post-factum не повинна торкатись історичних інвойсів; immutable type — найдешевша гарантія.
- Якщо ФОП юридично став ТОВ — це юр-сутнісно новий бізнес; створення нового `Business` (5 хвилин у wizard-і) — правильний сценарій. Старий лишається як архів або hard-delete-ється з cascade-flow Sprint 4.

### SP-9. `paymentPurposeTemplate` — обов'язковий для всіх 4 типів

**Рішення:** поле required і непорожнє для individual/organization так само, як для fop/tov.

**Чому не зробити optional для individual:**
- "Призначення платежу" — обов'язкове поле NBU payload-у (інакше банк-додаток не дозволить оплату). Default "Переказ коштів" чи "Поповнення рахунку" — robotik-message, що ламає UX (клієнт не розуміє, на що він платить).
- Для індивідуального збору ФОП-користувач все одно введе щось людське ("На пицу для Олі") — поле з самого початку має payload-цінність.
- Уніфікований flow знижує кількість conditional-логіки у wizard-і / formі / payload-mapper-і.

**Side-effect:** Step4PurposeBanks не змінюється у Sprint 7 — той самий required-input для всіх 4 типів.

### SP-10. NBU `PayloadInputSchema.receiverTaxId` — `union(rnokpp10, edrpou8)`

**Рішення:** замінити `individualTaxIdZod` на `payerTaxIdZod = z.union([individualTaxIdZod, legalEntityTaxIdZod])`. Це єдиний breaking-touch у `@finly/types/qr/`.

**Чому union, а не окремий optional:**
- Норматив НБУ дозволяє рівно 2 формати; будь-яке третє не існує у production payment-flow.
- Union дає чисту semantic "приймаємо рівно один з двох", без stale options.
- `individualTaxIdZod` лишається для backward-compatible callsites (Sprint 4 invoice-payee-snapshot, який snapshot-ить тільки fop-документи на момент створення Sprint 4 — після Sprint 7 нові snapshot-и можуть мати ЄДРПОУ).

**Чому НЕ перейменовуємо `individualTaxIdZod` → `residentTaxIdZod`:** name стабільність публічного API `@finly/types`. Sprint 4 invoice-payee-snapshot уже locked-in цей імпорт; перейменування ламає 4-5 callsite-ів без функціональної різниці.

---

## Епіки

### 7.0 Shared types — розширення enum-у і helper-ів (БЛОКЕР №0)

Виконується **перед** усім іншим (інші епіки read-from-це).

- 🔲 `packages/types/src/enums/business-type.ts`: `BUSINESS_TYPES = ['individual', 'fop', 'tov', 'organization'] as const`. `BUSINESS_TYPE_LABEL` для 4 типів. Окрема const-tuple `TAXATION_REQUIRED_TYPES = ['fop', 'tov']` (`as const satisfies readonly BusinessType[]`).
- 🔲 Helper-функції у тому ж файлі: `requiresTaxation(type)` (boolean), `taxIdLengthFor(type)` (`8 | 10`).
- 🔲 Експорти через `packages/types/src/enums/index.ts` і кореневий `index.ts`.
- 🔲 Tests: spec на helper-функції (24 кейси: 4 types × 6 інвокацій helper-ів).
- 🔲 **Acceptance:** `pnpm --filter @finly/types build` проходить; `pnpm --filter @finly/types test` зелений; downstream `apps/api` і `apps/web` ще не компілюються — це OK (наступні епіки доганяють).

### 7.1 Tax-id валідатори — `legalEntityTaxIdZod` + `payerTaxIdZod`

- 🔲 `packages/types/src/validation/tax-id.ts`: новий `legalEntityTaxIdZod = z.string().regex(/^\d{8}$/, { message: 'INVALID_LEGAL_TAX_ID' })`. `individualTaxIdZod` не змінюється.
- 🔲 Той же файл або новий sibling-файл `validation/payer-tax-id.ts`: `payerTaxIdZod = z.union([individualTaxIdZod, legalEntityTaxIdZod])`.
- 🔲 Tests: spec на legalEntity (positive: '12345678', negative: '1234567', '123456789', 'abc12345', empty); spec на union (positive: 10-цифровий валідний РНОКПП, 8 цифр; negative: 9 цифр).
- 🔲 `RESPONSE_CODE` додає `INVALID_LEGAL_TAX_ID` (Sprint 1 patern для error-code-ів).
- 🔲 `mapApiCode` (frontend) додає UA-message "ЄДРПОУ має містити 8 цифр".

### 7.2 BusinessSchema (entity Zod) — type-driven refine-и

- 🔲 `packages/types/src/entities/business.ts`:
  - `taxationSystem: taxationSystemSchema.nullable()`.
  - `isVatPayer: z.boolean().nullable()`.
  - `BusinessRequisitesSchema.taxId: z.string()` (без format-refine; format-refine переїжджає на `BusinessSchema`-level).
  - Новий `BusinessSchema`-refine: `requiresTaxation(b.type) ⇔ (b.taxationSystem !== null && b.isVatPayer !== null)` з code `TAXATION_FIELDS_MISMATCH_TYPE`.
  - Новий refine: `taxId-формат за type` (10+RNOKPP-checksum для `individual|fop`; 8-digits для `tov|organization`) з code `TAX_ID_FORMAT_MISMATCH_TYPE`. Path: `['requisites', 'taxId']`.
  - Існуючий `INVALID_VAT_FOR_TAXATION_SYSTEM` лишається, але активується лише коли обидва поля не-null.
- 🔲 Tests: golden vectors для 4 типів × (valid-input, missing-taxation, garbage-taxation, taxId-wrong-length).

### 7.3 Mongoose schema — taxation-fields nullable

- 🔲 `apps/api/src/modules/businesses/schemas/business.schema.ts`:
  - `@Prop({ required: false, type: String, enum: TAXATION_SYSTEMS, default: null })` для `taxationSystem`. Default null **навмисно** (для нових individual/organization-документів — чисте null без race-condition).
  - `@Prop({ type: Boolean, default: null })` для `isVatPayer`. Default null.
  - **Важливо:** не використовуємо `required: true` навіть для fop/tov — це data-integrity-rule на write-DTO рівні (Zod), не Mongoose-schema (бо Mongoose enum-validator не вміє coupled-rule з `type`).
- 🔲 Tests: schema-level test, що документ `{ type: 'individual', taxationSystem: null, isVatPayer: null, ... }` save-ається без помилки; документ `{ type: 'fop', taxationSystem: null, ... }` теж save-ається на Mongoose-рівні (бо Mongoose не валідовує coupled-rule), але **НЕ** проходить Zod-entity-схему (а саме там цей invariant).
- 🔲 **Існуючі ФОП-документи** lifecycle smoke-test: load + Zod-parse не падає (`type='fop'` + non-null taxation — обидва нові refine-и проходять).

### 7.4 Write-DTO — `CreateBusinessSchema` як discriminated union

- 🔲 `packages/types/src/contracts/businesses.ts`:
  - `CreateBusinessSchema = z.discriminatedUnion('type', [individualVariant, fopVariant, tovVariant, organizationVariant])`.
  - `individualVariant`: `{ type: 'individual', name, requisites: { iban, taxId: individualTaxIdZod }, paymentPurposeTemplate, acceptedBanks }` (без taxation-полів) `.strict()`.
  - `fopVariant`: те саме + `taxationSystem`, `isVatPayer` (refine на VAT × taxationSystem-coupling) `.strict()`.
  - `tovVariant`: `{ type: 'tov', ..., requisites.taxId: legalEntityTaxIdZod, taxationSystem, isVatPayer }` `.strict()`.
  - `organizationVariant`: `{ type: 'organization', ..., requisites.taxId: legalEntityTaxIdZod }` (без taxation-полів) `.strict()`.
  - `CreateBusinessRequest` derived-type — discriminated union.
- 🔲 `UpdateBusinessSchema` — лишається `.partial().strict()` без `type`. Додається cross-field refine лише для `taxationSystem × isVatPayer` (вже існує). Format-валідація `taxId` у Update — service-layer (читає `type` з БД).
- 🔲 Tests: 4 positive-create-кейси, 4 negative-кейси (taxation-поля для individual; taxId 8-цифр для fop; taxId 10-цифр для organization; missing-taxation для tov).

### 7.5 Backend service — type-aware cross-check

- 🔲 `apps/api/src/modules/businesses/businesses.service.ts`:
  - `BusinessesService.create` — Zod-rule вже все ловить через `CreateBusinessSchema` (discriminated union). Service-layer додає лише `Business.taxationSystem ?? null`/`isVatPayer ?? null` нормалізацію для individual/organization (бо schema variant не містить полів — резолвимо у `null` явно, не undefined).
  - `BusinessesService.update`: при PATCH без `type` (`type` immutable) сервіс читає документ-resident `type` і робить два cross-check-и:
    1. **Якщо PATCH містить будь-яке з `taxationSystem`/`isVatPayer`** і document.type ∉ TAXATION_REQUIRED_TYPES → throw `BadRequestException({ code: 'TAXATION_NOT_APPLICABLE_FOR_TYPE' })`.
    2. **Якщо PATCH містить `requisites.taxId`** — валідатор обирається за document.type (RNOKPP для individual/fop, ЄДРПОУ для tov/organization).
- 🔲 Tests: e2e — 4 positive (create individual / fop / tov / organization), 6 negative (taxation у PATCH для individual; ЄДРПОУ у PATCH для FOP; type у PATCH; missing taxation на CREATE-fop).

### 7.6 NBU payload-builder — `receiverTaxId` приймає union

- 🔲 `packages/types/src/qr/input.ts`:
  - `import { payerTaxIdZod } from '../validation/tax-id'`.
  - `PayloadInputSchema.receiverTaxId: payerTaxIdZod` (заміна `individualTaxIdZod`).
- 🔲 `packages/types/src/qr/limits.ts` — перевірити, чи `FIELD_LIMITS['receiverTaxId']` (якщо існує) не зашиває 10-symbol-only constraint. Якщо зашиває — розширити до max-10 (8 теж проходить).
- 🔲 `packages/types/src/qr/payload-002.ts`, `payload-003.ts` — без змін (вони не валідують taxId-довжину окремо, лише через `parseInput`).
- 🔲 Tests: input.spec — golden vectors для 8-цифрового ЄДРПОУ (positive); 9 цифр (negative); 11 цифр (negative).
- 🔲 Round-trip integration test (`qr.service.integration.spec`) для бізнесу з 8-digit taxId — payload вантажиться у `jsqr` і парсить таксі-поле як 8-digit string без помилки.

### 7.7 Frontend wizard — Step1TypeAndName, dynamic step-list

- 🔲 `apps/web/src/features/business-wizard/Step1TypeName.tsx` → `Step1TypeAndName.tsx` (rename file для clarity):
  - Замість read-only label-у — radio-card-group на 4 опції (mobile 2×2, ≥md — 4-в-ряд).
  - Кожна картка: `<icon>`, label `BUSINESS_TYPE_LABEL[type]`, sub-label one-liner (наприклад, "Для зборів з друзями" / "Підприємець" / "ТОВ, ПрАТ" / "ОСББ, фонд").
  - `name`-input лишається; default `type` — пустий (не вибрано), wizard блокує "Далі" до вибору обох.
- 🔲 `BusinessWizardStore`:
  - `steps: BusinessWizardStep[]` — computed-array з `formData.type` (`'taxation'` присутній лише для fop/tov).
  - `nextStep()` / `prevStep()` йде по `steps[]`, не по hardcoded `1..4`.
  - `setType(type)` reset-ить `formData.taxationSystem` і `formData.isVatPayer` у `null` при переключенні з fop/tov на individual/organization (UX safety: користувач передумав, щоб не залишати garbage).
- 🔲 `Step3Taxation.tsx` — без змін структури; defensively редіректить на step 4 якщо рендериться при `type ∉ {fop, tov}`.
- 🔲 `StepNavigator.tsx` — рендер `steps.length` замість hardcoded 4.
- 🔲 `Step2Requisites.tsx`:
  - `taxId`-input маркує label / placeholder / validator залежно від `formData.type`.
  - `maxLength={taxIdLengthFor(formData.type)}`.
  - Validator: `formData.type ∈ {individual, fop} ? individualTaxIdZod : legalEntityTaxIdZod`.
- 🔲 Tests: Wizard spec прокачує усі 4 type-flow через mock-store (positive create-payload reaching Step 4); spec на dynamic step-count.

### 7.8 Frontend cabinet edit — RequisitesSection / TaxationSection conditional

- 🔲 `apps/web/src/features/business-edit/RequisitesSection.tsx`:
  - taxId field — той самий dynamic-label/validator-pattern, що Step2Requisites (reuse via shared-helper).
- 🔲 `apps/web/src/features/business-edit/TaxationSection.tsx`:
  - Без структурних змін у самому компоненті.
- 🔲 `apps/web/src/app/(protected)/business/[slug]/page.tsx`:
  - Conditional render: `{requiresTaxation(business.type) && <TaxationSection ... />}`.
- 🔲 `apps/web/src/features/business-edit/BasicSection.tsx`:
  - `BUSINESS_TYPE_LABEL[business.type]` уже працює — після SP-1 буде валідно для всіх 4 типів автоматично.
- 🔲 Tests: спека `business/[slug]/page` / wrapper, що рендерить individual-business — `TaxationSection` НЕ у DOM (`queryByText('Оподаткування')` returns null).

### 7.9 Frontend public — heading рефакторинг до universal

- 🔲 `apps/web/src/features/business-public/PublicBusinessView.tsx`:
  - `heading = 'Платіж на користь ${name}'` замість `'Оплата на ${BUSINESS_TYPE_LABEL[type]} ${name}'`.
  - prop `type` лишається у signature (для майбутніх SEO / aria-label використань); h1 його не використовує.
- 🔲 `apps/web/src/app/host-pay/[slug]/page.tsx`:
  - SEO `<title>` (Server Component metadata) можна сформувати з `BUSINESS_TYPE_LABEL` для пошукової видачі — `'Оплата на ФОП Іваненко — Finly'` тощо. Це **необов'язкове** покращення Sprint 7; якщо не зроблено — heading у браузерному tab-і просто `name`. Decision-point: винести у sub-task або лишити як baseline.
- 🔲 `InvoicePublicView.tsx` — без змін (heading вже type-neutral).
- 🔲 Tests: knownComplexity — heading text для 4 типів коректний; не містить `BUSINESS_TYPE_LABEL`.

### 7.10 Cross-cutting — CLAUDE.md, business-flow, qr-decisions, tone

- 🔲 `CLAUDE.md`:
  - Domain Model — `Business.type` enum описується як 4 значення (не 1).
  - Domain Model — `taxationSystem`/`isVatPayer` як nullable з coupled-rule до `type`.
  - Known Complexities — додаються пункти "type immutable post-creation", "taxId — single string у БД, format per-type на write-DTO", "ЄДРПОУ без checksum на MVP (rationale)".
- 🔲 `docs/product/qr-decisions.md`:
  - Новий розділ §1.13 "Чотири типи платників — закрито у Sprint 7" з посиланням на цей README.
  - §1.11 (валідація даних) — додаток про різницю РНОКПП vs ЄДРПОУ.
- 🔲 `docs/product/business-flow.md` (якщо існує) — оновити схему "ФОП → бізнес → інвойси" на "Платник (один з 4 типів) → бізнес → інвойси".
- 🔲 `docs/product/tech-backlog.md` — новий ticket "ЄДРПОУ-checksum (ДКСУ-алгоритм)" з пріоритетом low.
- 🔲 `docs/manual-checks/README.md` — нові пункти PUB-6..PUB-9 (по одному на тип; UAT-сценарій "QR для individual / fop / tov / organization читається 3 банками і відкриває оплату з правильним кодом одержувача").

---

## Risks / Known Complexities

- **Ризик 1 — нормативна сумісність 8-цифрового ЄДРПОУ у форматі 003.** Sprint 2 builder читає charset/length-обмеження з `FIELD_LIMITS`. Перед інтеграцією потрібна **верифікація normативу**: §IV.10.5 "Код одержувача" — допустимі 8 (ЄДРПОУ) або 10 (РНОКПП) цифр. Якщо normative-обмеження каже "10 only", то Sprint 7 не виконуваний без апеляції до НБУ — і це блокер. **Mitigation:** перший епік 7.6 робить round-trip integration test з реальним 8-cіфровим ЄДРПОУ через jsqr; якщо тест падає на charset/length-assert — Sprint 7 паузується, normативний reread.
- **Ризик 2 — ЄДРПОУ без checksum** (SP-2): false-positive (typo проходить як валідний). Прийнятий ризик для MVP. Mitigation — банк-додаток клієнта валідує реквізити при списанні.
- **Ризик 3 — UX-плутанина "ТОВ" vs "Організація".** Користувач, який має ОСББ, може не знати, що ОСББ — це юр.особа з ЄДРПОУ і помилково обере "Я особисто". Mitigation — radio-card-sub-labels чітко описують who-is-who; UAT-чекліст обовʼязково перевіряє цей сценарій (нова Manual-Check PUB-6).
- **Ризик 4 — discriminated union у RHF-resolver-і.** Zod 4 підтримує `discriminatedUnion`; RHF + `@hookform/resolvers/zod` теж. Але dynamic typing форми (зміна полів при зміні `type`) вимагає `useForm<z.input<typeof CreateBusinessSchema>>` з downcast у onSubmit. Це перевіримо на спайку у Епіку 7.7. **Fallback** — single flat schema з conditional refine на frontend, dispatch у service за `type`. Втрата TS-exhaustiveness, але працююче рішення.
- **Ризик 5 — Migration-data-state на existing-ФОП.** Sprint 1 створив ~N документів `type='fop'`. Нова Mongoose-schema робить taxation-поля nullable; existing non-null значення лишаються валідні. Zod entity new-refine `(type='fop') ⇒ (taxation !== null)` для існуючих ФОП проходить (вони all мають taxation-поля заповнені). Smoke-test на staging обовʼязковий перед prod-deploy.
- **Ризик 6 — `mapApiCode` UA-strings.** Нові коди (`TAXATION_FIELDS_MISMATCH_TYPE`, `TAX_ID_FORMAT_MISMATCH_TYPE`, `TAXATION_NOT_APPLICABLE_FOR_TYPE`, `INVALID_LEGAL_TAX_ID`) потребують UA-message-mapping у `apps/web/src/shared/api/mapApiCode.ts`. Епік 7.10 фіксує. Без цього — користувач бачить raw error-code, що порушує `tone.md`.
- **Ризик 7 — Existing Sprint 4 invoice-payee-snapshot.** Sprint 4 commit `878ec92` snapshot-ить `payee.taxId` у момент створення інвойсу (захист від переіменування бізнесу post-issuing). Snapshot-структура валідується тим же `individualTaxIdZod`. Sprint 7 розширює реєстр валідних формат на 8-digit — означає, що нові invoice-snapshot-и для tov/organization мають містити 8-digit-string. Перевіримо у Епіку 7.6 / 7.5: snapshot-mapper читає `business.requisites.taxId` як-є, без revalidate. Snapshot-Zod схема (якщо існує окремо) — оновити на `payerTaxIdZod` з SP-10.

---

## Manual Checks (UAT)

Нові пункти у `docs/manual-checks/README.md`:

- **PUB-6 — Individual.** Створити бізнес `type='individual'`, slug автогенерований, ввести 10-цифровий РНОКПП (приклад зі spec-fixtures), назва "Іваненко І.І.", payment purpose "На пицу для Олі", без taxation-полів (wizard має скіпати step 3). Відкрити public-сторінку. Сканувати QR трьома банк-додатками (Mono, Privat24, mBank). Перевірити: heading "Платіж на користь Іваненко І.І.", taxId у банк-формі — 10 цифр, оплата проходить.
- **PUB-7 — TOV.** Те саме для `type='tov'`, ЄДРПОУ 8 цифр, taxationSystem='general', isVatPayer=true. Heading "Платіж на користь ТОВ Каса Здоров'я".
- **PUB-8 — Organization.** Те саме для `type='organization'`, ЄДРПОУ 8 цифр, без taxation-полів. Heading "Платіж на користь ОСББ Покрова".
- **PUB-9 — Mixed migration.** На staging-БД з existing fop-документом перевірити, що cabinet edit і public-сторінка для нього працюють без regressions після Sprint 7 deploy. Перевірити, що `TaxationSection` у cabinet рендериться (бо type='fop'), значення `taxationSystem`/`isVatPayer` показуються коректно.

UAT-чекліст для wizard-форми:
- **CAB-5 — Type-driven step-list.** Запустити wizard з `type='individual'` — step-індикатор показує "Крок 2 з 3", step "Оподаткування" відсутній. Repeat для всіх 4 типів. Перевірити, що зміна `type` після step 1 reset-ить `formData.taxationSystem`/`isVatPayer` у null.
- **CAB-6 — TaxId-format error message.** Ввести 10 цифр у поле taxId при `type='tov'` — побачити inline-error "ЄДРПОУ має містити 8 цифр" (не "INVALID_TAX_ID"). Repeat для зворотного: 8 цифр у `type='fop'`.

---

## Definition of Done

- ✅ Усі епіки 7.0..7.10 закриті.
- ✅ `pnpm test` зелений по всіх workspace-ах:
  - `@finly/types` — нові spec на helper-функції, validators, contracts.
  - `apps/api` — нові unit + e2e (4 type-positive create, 6 type-negative create/update, type-aware service cross-check, jsqr round-trip 8-digit).
  - `apps/web` — нові spec на Wizard dynamic step-list, RequisitesSection per-type validator, conditional TaxationSection unmount, PublicBusinessView heading-template.
- ✅ `pnpm lint` без нових warnings (Sprint 1 baseline 86 існуючих лишається).
- ✅ `pnpm build` всіх workspace-ів success.
- ✅ Smoke-test на staging із 1 existing-ФОП-документом — cabinet + public-сторінка без regressions.
- ✅ UAT manual-checks PUB-6..9 + CAB-5..6 — статус ⬜ → ✅ або документований negative-result з ticket-ом.
- ✅ `CLAUDE.md` оновлений (Domain Model + Known Complexities + Project Structure якщо додались нові файли).
- ✅ `docs/product/qr-decisions.md` має §1.13 closure-маркер.
- ✅ `docs/product/tech-backlog.md` має low-priority ticket "ЄДРПОУ-checksum (ДКСУ)".
