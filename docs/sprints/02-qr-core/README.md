# Sprint 2 — QR-ядро (генерація + валідація)

> **Статус:** working draft, 2026-05-01.
> **Передумови:** Sprint 1 закритий — Business/Invoice schemas і IBAN/ІПН валідатори вже у `packages/types`.
> **Що розблоковує:** Sprint 3 (кабінет + публічна вивіска споживають payload-builder і `QrImageRenderer`); Sprint 5 (per-bank deep-links — research-spike поверх payload-builder); Sprint 6 (custom-logo overlay поверх `QrLogoCompositor`).

---

## Мета

Зібрати **повне QR-ядро** як замкнену під-систему: builder NBU-payload (формати 002 і 003), encoder у Base64URL, builder NBU-payload-link (host — параметризований, не hardcoded) і renderer PNG-образу з опційним лого Finly. Усе — **за специфікацією НБУ**, з повним покриттям тестами і чіткою сегрегацією pure-логіки (shared у `@finly/types`) від Node-only рендеру (NestJS-модуль у `apps/api`).

Цей спринт — це чисті примітиви: жодних controllers, жодних DB-записів, жодного R2. Його споживачі — Sprint 3 (URL→картинка для кабінету та публічної сторінки) і Sprint 5 (per-bank deep-links поверх того ж payload). Архітектурна інваріанта: payload-генерація мусить пройти test round-trip (build → encode → decode QR-зображення → parse payload → assert поля) **до** інтеграції в будь-який endpoint.

### Дисамбігуація URL-типів (важливо до §2.1)

У продукті існують **два різні URL**, що історично плутаються в обговореннях. План явно їх розводить:

**(1) Pretty page URL** — адреса публічної сторінки бізнесу/інвойсу. Те, що ФОП вставляє у візитку чи Telegram.
- **Хост:** `pay.finly.com.ua` (фіксований, qr-decisions §1.2 + §4.3).
- **Формат:** `pay.finly.com.ua/{slug}` або `pay.finly.com.ua/{business-slug}/{invoice-slug}`.
- **Хто рендерить:** Sprint 3 (slug-генератор + публічна сторінка). Sprint 2 лише пакує цей URL у QR-картинку, **не** будує його сам.

**(2) NBU-payload link** — технічний URL з NBU-payload у Base64URL, що його ОС/банк-додаток розпарсить і відкриє оплату. Активується кнопкою "Інший банк" на публічній сторінці і потенційно per-bank кнопками (Sprint 5 research).
- **Хост:** **відкрите питання §2.0**. Два кандидати: (а) `bank.gov.ua` — якщо спека НБУ або app-link конфіги банків *вимагають* саме цей хост; (б) `pay.finly.com.ua` — якщо банки приймають payload незалежно від хоста, бо тоді бренд лишається на нашому домені (qr-decisions §1.2).
- **Формат:** `{host}/qr/{base64url(payload-002 або payload-003)}`.
- **Хто рендерить:** Sprint 2 — і builder, і env-config точки.

**Sprint 2 зобов'язання:** payload і encoder повністю host-agnostic (pure-функції); `buildNbuPayloadLink` приймає `host` як параметр. Sprint 2 **НЕ фіксує** конкретне значення `host` — це фіксується у §2.0 при вичитці специфікації, з результатом у env (`NBU_PAYLOAD_LINK_HOST`).

## Скоуп

- 🔲 **Acquisition spec-PDF НБУ для формату 003** (постанова №97 від 19.08.2025) — артефакт у `docs/product/qr-spec/` з посиланнями на джерело і відмітками "field X → ось ця сторінка PDF". **Без цього builder 003 — guesswork; це блокер №0**.
- 🔲 Pure payload-builder для **002** (fallback) і **003** (основний) у `packages/types/src/qr/` з per-version обмеженнями довжин (chars + bytes).
- 🔲 Encoder payload → Base64URL + builder universal NBU-link.
- 🔲 Bank → version map (`'003'` дефолт, per-bank override через map-конфіг) — **архітектура під відкрите питання §4.4 qr-decisions, не вирішення**.
- 🔲 `QrImageRenderer` (NestJS-injectable) — `qrcode` → PNG-buffer з error-correction `H`; `QrLogoCompositor` (sharp) — overlay Finly-лого у центр.
- 🔲 `QrService` — orchestrator (input → validate → build → encode → render). Інжектиться у Sprint 3 controllers без змін.
- 🔲 Перегляд hard-coded limits у Sprint 1 Zod-схемах (`name.max(140)`, `paymentPurposeTemplate.max(420)`) — переключити на derived-from-spec константи, з тестом на симетрію.
- 🔲 Round-trip тести з `jsqr` (decoder) — перевіряємо, що згенерований PNG зчитується назад у вихідний payload.
- 🔲 Golden-vector тести на payload (8+ кейсів на версію), включно з UTF-8 cyrillic, нульовою сумою, fixed-сумою, max-length полями.

## НЕ-скоуп

- ❌ **Per-bank deep-links і bank-specific payload форматів** — це Sprint 5 (research-driven §3.1). Sprint 2 будує лише universal NBU-link; per-bank URL-схеми — окрема ітерація поверх існуючого builder-а.
- ❌ Custom-logo upload, R2 storage картинок QR, content-moderation лого — Sprint 6 (qr-decisions §2.2). Sprint 2 рендерить **лише** дефолтне Finly-лого (статичний asset у репо).
- ❌ Ендпоінти `/businesses/{slug}/qr.png`, кабінетна `<QrPreview>` — Sprint 3.
- ❌ Slug-генератор бізнесу/інвойсу — Sprint 3.
- ❌ Trackable analytics-параметри в QR (UTM, scan-counter) — Phase 1.5+.
- ❌ Stamping QR на PDF-накладні / друкарські формати — post-MVP.
- ❌ Client-side QR-preview без round-trip на сервер — Sprint 3 при необхідності, через ту ж `qrcode` lib у браузері (не цей спринт).

---

## Епіки

### 2.0 Spec acquisition (БЛОКЕР №0)

Без цього кроку builder 003 — fan-fic. `docs/example/generate.ts` ілюстративний, формат 002, синтетичні поля; за qr-decisions §1.1 source of truth — **постанова НБУ №97 від 19.08.2025 + специфікаційний PDF на bank.gov.ua**. Sprint не починається з імплементації — починається з документа.

- 🔲 Завантажити PDF з bank.gov.ua у `docs/product/qr-spec/nbu-003-spec.pdf` (commit-able, бо публічний документ; лицензійні обмеження НБУ дозволяють reference).
- 🔲 `docs/product/qr-spec/README.md` — нормалізована таблиця **Field × 002 × 003 × max-len-chars × max-len-bytes × encoding × notes**, з прив'язкою до конкретних сторінок PDF. Ціль — щоб TypeScript-константи у §2.1 мали посилання `// see qr-spec/README.md §FIELD_NAME` на одному джерелі правди.
- 🔲 Окремий файл `docs/product/qr-spec/diff-002-003.md` — **що саме змінилось** у 003 vs 002 (нові поля? renamed? різні max-длини? обов'язковість?). Це джерело rationale для коментарів у коді.
- 🔲 **Зібрати дані для рішення про host** для NBU-payload-link (див. дисамбігуацію URL-типів вище). Sprint 2 **не приймає рішення сам по собі** — рішення комбіноване з двох незалежних входів, обидва обов'язкові:
  - **Вхід (a) — PDF спека НБУ.** У спеці шукаємо: чи нормативний документ фіксує конкретний хост, чи лише payload-формат. Фіксуємо знайдене у `qr-spec/README.md` секцією **"Host у нормативі"** з цитатою/постраничним посиланням. Три можливі стани: `mandates: bank.gov.ua` / `recommends: bank.gov.ua` / `silent`.
  - **Вхід (b) — реальна поведінка банк-додатків.** Навіть однозначна нормативна вимога **не гарантує**, що всі 11 MVP-банків коректно ловлять URL на цьому хості — це визначається їхніми приватними `apple-app-site-association` / `assetlinks.json` конфігами, а не постановою НБУ. Тому UAT-пункт **QR-6** у [`docs/manual-checks/README.md`](../../manual-checks/README.md) — **обов'язковий перед launch у будь-якому стані входу (a)**. Покриває всі 11 банків з `MVP_BANKS`, обидві ОС, обидва кандидат-хости.
- 🔲 **Зафіксувати рішення.** Після збору обох входів — у `qr-spec/README.md` секція **"Host вирішення"** містить (1) дані з нормативу, (2) матриця QR-6 (банк × ОС × хост → результат), (3) фінальне значення `NBU_PAYLOAD_LINK_HOST` з обґрунтуванням. Правило прийняття: `pay.finly.com.ua` дозволено **лише** якщо QR-6 показав 100%-успіх для всіх 11 банків на обох ОС; будь-який бан-fail → `bank.gov.ua` для всього flow (немає половинчастого "для одних банків наш хост, для інших — НБУ" — це збиває per-bank кнопки і UI-консистентність).
- 🔲 **Fail-fast у коді.** `NBU_PAYLOAD_LINK_HOST` — **required** env var, без дефолту, додається до fail-fast loader-а (`apps/api/src/config/env.ts`) за існуючою політикою [`docs/conventions/fail-fast.md`](../../conventions/fail-fast.md). Якщо env не заданий — API не стартує. Це усуває можливість "тимчасового дефолта" у коді: рішення фіксується через deploy-config окремим PR після §2.0, не у source.

**Розподіл відповідальності між документами (важливо).** UAT-чекліст ([`docs/manual-checks/README.md`](../../manual-checks/README.md), пункт QR-6) описує **тільки процедуру** для не-технічного виконавця: які кнопки натискати, що записувати у табличку, які варіанти результату фіксувати. Усе інше — **архітектурна policy** — живе **тут**, у §2.0 sprint plan: правило прийняття рішення, поведінка env, fail-fast інваріант, формат фінального artifact-а у `qr-spec/README.md`. Манул-чекліст не повинен містити технічних термінів, посилань на код, env vars, паттернів конфігурації — це порушує його контракт ([`CLAUDE.md > Rules & Conventions`](../../../CLAUDE.md)). Якщо при імплементації спадає на думку додати щось engineering-у в QR-N — це означає, що насправді це належить сюди, у sprint plan.

**DoD:** `qr-spec/README.md` містить (1) повну таблицю полів обох версій з номерами сторінок PDF; (2) секцію "Host вирішення" з рекомендацією і обґрунтуванням. Жодне TypeScript-значення у §2.1 не є магічним числом — кожне має посилання на цей документ. Манул-чекліст QR-6 описує лише процедуру і варіанти результату — без архітектурних термінів і посилань на код.

**Ризик:** PDF може виявитись неповним або неоднозначним по якомусь полю. Mitigation: при невизначеності фіксуємо консервативніший варіант (коротша max-len, обов'язкове поле) + TODO у `qr-spec/README.md` з планом валідації через тестовий QR у реальному банк-додатку (research-задача, не блокує спринт — використовуємо консервативні обмеження).

---

### 2.1 Pure payload-builder (`packages/types/src/qr/`)

Тут — **чиста детермінована логіка**, без Node-залежностей. Чому в shared-пакеті: ті самі обмеження довжин консумуються Zod-схемами (`Business.name.max`, `Invoice.paymentPurpose.max`); ті ж builders можуть викликатись у клієнтському dev-tooling-у, тестах або майбутній web-side preview без перевипуску бекенда. Логіка — pure functions, тривіально юніт-тестовані.

**Структура файлів:**

```
packages/types/src/qr/
├── format-version.ts      # PAYLOAD_VERSIONS = ['002', '003'] as const
├── limits.ts              # FIELD_LIMITS[version][field] — за qr-spec/README.md
├── bank-version-map.ts    # BANK_PAYLOAD_VERSION: Record<BankCode, PayloadVersion>
├── input.ts               # Zod-схема PayloadInput (build-time validation)
├── payload-002.ts         # build002Payload(input): string  ← \n-joined
├── payload-003.ts         # build003Payload(input): string
├── encode.ts              # encodePayloadAsBase64Url(payload): string
├── universal-link.ts      # buildNbuUniversalLink(base64url): string
├── errors.ts              # PayloadValidationError (typed, з machine-code)
├── *.spec.ts              # golden-vectors per файл
└── index.ts               # public re-exports у `@finly/types/qr`
```

- 🔲 `format-version.ts` — `PAYLOAD_VERSIONS = ['002', '003'] as const`; `type PayloadVersion = (typeof PAYLOAD_VERSIONS)[number]`. Конвенція `as const` — повторюємо Sprint 1 (`USER_ROLES`, `BUSINESS_TYPES`).
- 🔲 `limits.ts` — `FIELD_LIMITS: Record<PayloadVersion, FieldLimits>` де `FieldLimits = { name: {chars: number, bytes: number}, purpose: {chars: number, bytes: number}, … }`. **Окремо chars і bytes**, бо `І` (`І`) — 1 char але 2 bytes у UTF-8; стандарт НБУ оперує **байтами**, JS `.length` рахує chars → це класичне джерело silent overflow. Helper `assertWithinUtf8Limits(value, limit)` — exported.
- 🔲 `bank-version-map.ts` — `BANK_PAYLOAD_VERSION: Record<BankCode, PayloadVersion>`. Дефолт усі `'003'`. **Архітектурне рішення:** ми не вирішуємо §4.4 qr-decisions ("як перемикається 002/003 для банку") — ми надаємо механізм. Один rebuild const + redeploy = переключення банку у fallback. Альтернативи (per-FOP toggle, runtime DB-конфіг) надбудовуються поверх цієї map без рефактору.
- 🔲 `input.ts` — Zod-схема `PayloadInputSchema` для входу обох builder-ів: `{ recipientName, iban, taxId, amountKopecks, currency: 'UAH', purpose, … }`. Re-uses `ibanZod` + `individualTaxIdZod` зі Sprint 1. **Грошові суми — int копійки**, конвертація у `UAH<рядок-цілих-гривень>` всередині builder-а (стандарт НБУ оперує цілими грошима без коми; копійки округлюються/форматуються за specifications PDF — фіксуємо у §2.0).
- 🔲 `payload-002.ts` / `payload-003.ts` — pure function `(input: PayloadInput) => string`. Внутрішньо: (1) валідація через Zod-схему `PayloadInputSchema`, (2) per-version length-assertions через `FIELD_LIMITS`, (3) збір масиву рядків точно за порядком полів зі специфікації, (4) `join('\n')`. **Жодного state, жодного I/O, жодного `Date.now()`** — детермінований output для одного input. **Trailing-empty fields обов'язкові** (приклад 002: 14 полів навіть якщо останні три порожні) — порядок і кількість фіксуються константою `FIELD_ORDER[version]: readonly string[]`, builder mappить input → array у тому порядку.
- 🔲 `encode.ts` — `encodePayloadAsBase64Url(payload: string): string`. **Imовлементація isomorphic** (працює і у Node, і у браузері без polyfill): `new TextEncoder().encode(payload)` → manual-binary-string → `btoa(...)` → `replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')`. Жодного `Buffer` — `apps/web/next.config.ts` не налаштовує browser-polyfill для Node-globals, і будь-який `Buffer.from(...)` у shared-коді при першому web-imp'orті дає `ReferenceError: Buffer is not defined` (або silent-broken bundler-shim). Native `TextEncoder` і `btoa` доступні у Node 18+ і всіх сучасних браузерах — нульова залежність. **Тест на детермінованість** + golden-vector проти reference-implementation (Buffer-варіант запускаємо як окремий тестовий oracle у Node, порівнюємо output) гарантує, що isomorphic-версія дає байт-у-байт такий самий результат як Node-only.
- 🔲 `universal-link.ts` — `buildNbuPayloadLink(base64url: string, opts: { host: string }): string`. **Жодного hardcoded host** — `host` приходить параметром (на API-боці — з env `NBU_PAYLOAD_LINK_HOST`, що ставить адмін після §2.0). Чому без дефолту: qr-decisions §1.2 закріплює "Платіжні посилання живуть на власному домені Finly" (`pay.finly.com.ua`), але §3.1 і `docs/example/generate.ts` згадують `bank.gov.ua/qr/...` — це **різні URL з різними ролями**, які план Sprint 2 більше не плутає (див. нижче). Реальний host для NBU-payload-link залежить від відповіді §2.0: чи специфікація НБУ **вимагає** саме `bank.gov.ua` як хост (через жорсткі app-link конфіги банків) — чи дозволяє будь-який host, доки payload відповідає формату.
- 🔲 `errors.ts` — `PayloadValidationError extends Error` з полями `code: string` (machine-readable, типу `PAYLOAD_NAME_TOO_LONG`), `field: string`, `version: PayloadVersion`. **Не throw'аємо raw Zod errors** — bekend-споживач `QrService` пере-pack'ує у `BadRequestException` з `code` для `mapApiCode.ts` web-сторони (Sprint 3 wiring).

**DoD:** `pnpm --filter @finly/types test` зелений; ≥ 8 golden-vector тестів на версію (UTF-8 cyrillic, ASCII-only, max-length boundary, empty-amount, fixed-amount, max-purpose, special-chars `«»№` у purpose, multi-word name); reject-тести на over-length у chars vs bytes (окремо); тест "build 003 з над-002-лімітом не падає" (доказ, що версії незалежні); тест "two distinct inputs → two distinct payloads" (детермінованість + sensitivity).

---

### 2.2 Sprint 1 Zod-обмежень → derive-from-spec

Sprint 1 захардкодив `name.max(140)` і `paymentPurposeTemplate.max(420)` за інтуїцією. Спринт 2 виводить ці значення зі специфікації — щоб **не існувало двох джерел правди**, які можуть розходитися.

**Архітектурне рішення (revised):** Zod-схема Business/Invoice бере `MIN(FIELD_LIMITS[v].field)` по всіх **активно підтримуваних версіях** (`PAYLOAD_VERSIONS`). Це найконсервативніше обмеження, що гарантує: **будь-який валідно збережений Business може згенерувати валідний QR для будь-якого з підтримуваних банків**.

Чому НЕ MAX (відкинутий варіант). MAX-підхід дозволяв би зберегти Business з name довжиною валідною для 003 але over-limit для 002, і впадати з runtime-помилкою лише в момент, коли клієнт тицяє кнопку 002-банка на публічній сторінці. ФОП у цей момент уже не на сайті — він давно зберіг бізнес і пішов друкувати QR. Помилка "ваш fallback відключений" приходить через клієнта, який не може заплатити. Це класичний антипатерн "save succeeds, render later fails" — переносить помилку на користувача, який не зможе її виправити.

Чому MIN прийнятний на UX-боці. Найперше: 002 — fallback-формат, тимчасовий до закриття переходу ринку на 003 (qr-decisions §1.9); MIN-обмеження діє лише поки 002 у `PAYLOAD_VERSIONS`. Друге: різниця max-len між 002 і 003 у спеці НБУ — десятки символів на полях типу name/purpose, не критична для legitimate ФОП-кейсів. Третє: якщо різниця виявиться неприйнятною на конкретному полі — є явна еволюційна точка (`acceptedBanks`-aware ліміт, див. нижче), не тиха корупція даних.

- 🔲 У `packages/types/src/qr/limits.ts`: helper `effectiveLimit(field: keyof FieldLimits): { chars: number; bytes: number }` повертає `min` по `PAYLOAD_VERSIONS`. Один computed-helper, не magic number.
- 🔲 У `packages/types/src/entities/business.ts`: `name.max(effectiveLimit('name').chars)` і `paymentPurposeTemplate.max(effectiveLimit('purpose').chars)`. UTF-8-byte перевірка через `.refine(v => new TextEncoder().encode(v).length <= effectiveLimit('name').bytes)` — **isomorphic**, без `Buffer.byteLength` (entity-Zod консумується і API, і web RHF-форми; `Buffer` у browser bundle = silent-broken або `ReferenceError`). `TextEncoder` доступний у Node 18+ і всіх сучасних браузерах нативно. Виносимо як shared helper `assertWithinUtf8Limits(value, byteLimit)` у `packages/types/src/qr/limits.ts` — щоб і Zod-refines, і payload-builder викликали одну функцію (single source of truth, симетрія перевірки на read- і write-path).
- 🔲 Таку ж деривацію — у `Invoice.paymentPurpose.max` + byte-refine.
- 🔲 Тест-симетрія: `business.spec.ts` додає три кейси: (a) name довжиною = MIN-1 chars приймається; (b) name довжиною = MIN+1 chars відхиляється; (c) name з MIN chars але > MIN bytes (cyrillic-heavy) відхиляється з `INVALID_NAME_BYTE_LENGTH`. Гарантія, що **жоден збережений Business не може заstuck-нути QR-render для жодної підтримуваної версії**.
- 🔲 **Не міняємо нічого у Mongoose-схемах** — Mongoose не валідує довжини, він просто зберігає рядок. Source of truth — Zod.

**Еволюційна точка (НЕ робимо у Sprint 2, але архітектура готова).** Якщо в майбутньому продукт хоче дозволити "довгі імена для бізнесів, що не використовують 002-банки" — додається `acceptedBanks`-aware валідація: `effectiveLimitForBusiness(business)` бере `min` лише по версіях, фактично потрібним для `business.acceptedBanks`. Інваріант "save → render завжди працює" зберігається, бо обмеження все одно похідне від реального скоупу банків бізнесу. Це eventual надбудова поверх `effectiveLimit`, не переписування.

**DoD:** `pnpm --filter @finly/types test` зелений з трьома симетричними кейсами; `business.ts` і `invoice.ts` не містять `.max(<число>)` — лише `.max(effectiveLimit(...).chars)` + byte-refine; тест-фактчек "MIN(002, 003) для name = $value, для purpose = $value" — фіксує конкретні числа з spec PDF як snapshot, щоб майбутня зміна `FIELD_LIMITS` не пройшла мовчки.

---

### 2.3 NestJS QR-модуль (`apps/api/src/modules/qr/`)

Тут живе все, що **не може жити у shared-пакеті**: image rendering через `qrcode` (Node-only depending build) + `sharp` (native libvips). Модуль injectable, без controller-ів — Sprint 3 інжектить `QrService` у `BusinessesController` / `InvoicesController`.

**Структура файлів:**

```
apps/api/src/modules/qr/
├── qr.module.ts
├── qr.service.ts                  # orchestrator
├── qr.service.spec.ts
├── renderers/
│   ├── qr-image.renderer.ts       # qrcode → Buffer, error-correction H
│   ├── qr-image.renderer.spec.ts
│   ├── qr-logo.compositor.ts      # sharp composite Finly logo center
│   └── qr-logo.compositor.spec.ts
├── assets/
│   └── finly-logo-qr.png          # 1024×1024 transparent PNG, white-bordered
└── errors.ts                      # QrRenderError extends Error
```

- 🔲 `QrImageRenderer` — `@Injectable()`, метод `render(text: string, opts: { sizePx: number; errorCorrection: 'L'|'M'|'Q'|'H' }): Promise<Buffer>`. Внутрішньо `QRCode.toBuffer(text, { width, errorCorrectionLevel, margin: 2 })`. **Дефолт `H`** — обов'язково для logo-overlay (~30% надлишковості; нижчі рівні дають центральні артефакти при overlay).
- 🔲 `QrLogoCompositor` — `@Injectable()`, метод `compose(qrPng: Buffer, logoPath: string, opts: { qrSizePx: number; logoMaxRatio: number }): Promise<Buffer>`. Sharp-pipeline: resize logo з `fit: 'contain'` + білий background → composite over QR з `gravity: 'center'`. **`logoMaxRatio` ≤ 0.25** (за прикладом 25-30%); жорсткий guard у коді — `if (ratio > 0.30) throw new QrRenderError('LOGO_TOO_LARGE')` з посиланням на error-correction H 30%-ну межу.
- 🔲 `QrService` — `@Injectable()`, два методи:
  - `renderForUrl(url: string, opts): Promise<Buffer>` — для **публічної сторінки**, QR що відкриває `pay.finly.com.ua/{slug}`. Чистий URL, без NBU-payload.
  - `renderForNbuPayload(input: PayloadInput, version: PayloadVersion, opts): Promise<Buffer>` — для **"Інший банк"** fallback і **per-bank** генерації (коли research §3.1 закриється і ми взнаємо, які банки приймають NBU URL напряму): build → encode → wrap у universal-link → render image.
- 🔲 `assets/finly-logo-qr.png` — підготовлений 1024×1024 PNG з білою округлою підкладкою (для контрасту над чорним QR). Statically імпортується через `path.join(__dirname, 'assets/finly-logo-qr.png')` — НЕ через bundler-magic (NestJS swc compiler не копіює asset-и автоматично; додаємо у `nest-cli.json` `assets` масив).
- 🔲 `QrServiceSpec` — інжектить через `Test.createTestingModule`, мокає файлову систему для logo (через `path` injection token, щоб уникнути disk-I/O в unit-тестах). Інтеграційний тест (без моків) живе в `apps/api/src/modules/qr/qr.service.integration.spec.ts` — реальне читання asset, реальний sharp, реальний `jsqr` round-trip.

**Архітектурне рішення — НЕ виносити рендер у окремий `packages/qr-render` workspace.** Pros: стерильна декомпозиція, переиспользование. Cons: +1 build target, додаткова pnpm/turbo конфігурація, ніхто крім api його не споживає у MVP. **Оцінка:** не виправдано до моменту, коли з'явиться другий споживач (наприклад, окремий worker для batch QR-генерації — post-MVP). Тримаємо в `apps/api`; екстракція пізніше — це механічний рефактор без зміни public API.

**DoD:** `pnpm --filter api test` додає ≥ 12 нових тестів у `modules/qr/`; інтеграційний `jsqr` round-trip проходить (build 003 → render → decode QR з PNG-буфера → parse payload → assert поля); тест "logo overlay не ламає QR-зчитування" (decoder читає payload навіть з overlay, бо `H`-level дозволяє); тест "logoMaxRatio > 0.30 → throw" (захист від зчитування-killer).

---

### 2.4 Cross-cutting: поведінка bank → version

§4.4 qr-decisions — **відкрите питання**. Спринт 2 не закриває його, але створює мінімальну архітектуру, що вміщує будь-яке закриття.

- 🔲 `BANK_PAYLOAD_VERSION: Record<BankCode, PayloadVersion>` у `packages/types/src/qr/bank-version-map.ts`. Поточний MVP-стан: усі 11 банків у `'003'`. Коментар у файлі: "If ФОП feedback shows bank X не приймає 003 — flip the entry to '002'; код споживачів (`QrService`, Sprint 3 UI) читає з цієї map без правок."
- 🔲 `getPayloadVersionForBank(code: BankCode): PayloadVersion` helper — навіть тривіальний lookup пакуємо у функцію, бо політика може ускладнитись (per-FOP-override в DB) без зміни API.
- 🔲 **НЕ робимо** runtime-perBank-config у БД. На MVP-масштабі ~100-1000 ФОП це over-engineering: ці перемикання трапляться 0-3 рази на місяць, redeploy дешевий і trackable.
- 🔲 Тест: для кожного `BankCode` map-entry існує (compile-time гарантія через `Record<BankCode, …>` + runtime smoke `MVP_BANKS.every(c => c in BANK_PAYLOAD_VERSION)`).

**DoD:** map містить усі 11 банків; helper exported; smoke-test зелений.

---

## Cross-cutting

### Convention: pure-shared / impure-app split

Усе, що **детермінована функція** від input-а — у `packages/types/src/qr/`. Усе, що тягне native binary (sharp), file system (asset loading), або I/O — в `apps/api/src/modules/qr/`. Цей split розбиває "що тестую через jest з ts-jest" від "що тестую через інтеграційний spec з реальним sharp" і запобігає повзучому затягуванню Node-only коду в shared-пакет (де він зламає майбутню web-side reuse).

### Convention: `as const` enums (повторюється зі Sprint 1)

`PAYLOAD_VERSIONS`, `FIELD_ORDER`, будь-які перерахування у `qr/` — `as const` array, не TS `enum`. Один source of truth для Zod (`z.enum(PAYLOAD_VERSIONS)`), TS-type, runtime check.

### Тести

- **Unit (types, pure):** golden vectors з `qr-spec/README.md` (для кожної версії — серія input → expected payload string, byte-for-byte). Reject-тести на UTF-8 byte overflow окремо від char overflow.
- **Unit (api, mocked):** `QrService` з мок-`QrImageRenderer` і мок-`QrLogoCompositor` — перевіряємо, що orchestration викликає праву версію builder-а для правого input-а.
- **Integration (api, real sharp):** `qr.service.integration.spec.ts` — реальний sharp, реальний asset, реальний `jsqr` round-trip. **`jsqr` додається як `devDependencies` у `apps/api`** — не shipped у production bundle.
- **Регресія Sprint 1:** після §2.2 derive-from-spec — перезапуск `pnpm test` mustn't ламати existing 99 + 390 тестів.
- E2E: **не додаємо** — endpoints з'являться у Sprint 3.
- **Manual UAT (живі банк-додатки):** автотести закривають payload-формат і round-trip через `jsqr` decoder, але **не закривають** питання "чи дійсно реальний банк-додаток прийме наш payload без скарг" — це визначається приватними `apple-app-site-association`/`assetlinks.json` конфігами кожного банку, які поза нашим контролем і поза НБУ-нормативом. Принципово людська перевірка з телефонами у руці. Список зафіксований у [`docs/manual-checks/README.md`](../../manual-checks/README.md), розділ **QR**:
  - **QR-1** (українські букви в назві) — валідує UTF-8 byte counting на боці реальних банків.
  - **QR-2** (QR з мінімумом полів) — валідує trailing-empty fields і загалом коректність формату; не закриває проблему сама — лише виявляє симптом, точна довжина звіряється з PDF спеки.
  - **QR-4** (QR з логотипом сканується) — валідує розмір/контраст лого, не ламає error-correction H.
  - **QR-6** (вибір хоста для NBU-payload-link) — **обов'язковий перед launch у будь-якому стані PDF-спеки** (див. §2.0). Покриває всі 11 банків з `MVP_BANKS` × обидві ОС × обидва кандидат-хости (44 клітинки). Не може бути замінений підмножиною з топ-3 банків — це різні класи перевірок (QR-1/2/4 — runtime payload, QR-6 — global routing policy для всього flow).
- **Gate перед launch публічного flow:** QR-1, QR-2, QR-4, QR-6 — мають бути ✅ або ❌ (не ⬜). QR-6 — додатково передумова для деплою, бо `NBU_PAYLOAD_LINK_HOST` — required env без дефолту (fail-fast, see §2.0); без рішення QR-6 + PDF — env не заданий, бекенд не стартує.

### Залежності

- `qrcode@^1.5.x` (нова, dependency `apps/api`) — типи `@types/qrcode` у dev. Перед install — перевірити, що libversion співпадає з вимогами sharp/Node 20 (в обох — pure JS, без native; sharp вже в репо).
- `jsqr@^1.4.x` (нова, **devDependency `apps/api`**) — тільки для тестів round-trip.
- `sharp` — вже у `apps/api/package.json` (Sprint 1 для avatar). Reuse, без оновлення версії.

### Документація споживачів

- 🔲 У `CLAUDE.md` (корінь) додається секція **"### QR generation pipeline"** під **## Key Patterns**, з посиланням на `apps/api/src/modules/qr/qr.service.ts` як entry-point. Шаблон секції — як існуюча "Avatar upload pipeline (R2)".
- 🔲 У **## Known Complexities** додається три пункти: "Field separator semantics — trailing empties обов'язкові за специфікацією"; "UTF-8 bytes vs chars — limits з НБУ-spec у байтах, JS `.length` у chars"; "QR error-correction H обов'язкова при logo overlay — нижчі рівні роблять центр нечитабельним".

---

## Definition of Done (спринт у цілому)

- 🔲 `qr-spec/README.md` зафіксований і покриває всі поля 002+003 з посиланнями на сторінки PDF.
- 🔲 `pnpm build` зелений (3/3 packages).
- 🔲 `pnpm test` зелений: types **+ ~30 нових** (golden-vectors per builder + encode + universal-link + symmetry §2.2), api **+ ~15 нових** (QrService unit + renderer + compositor + integration round-trip).
- 🔲 `pnpm lint` без NEW warnings (preexisting 86 — окрема ініціатива у tech-backlog, нічого не додаємо).
- 🔲 `QrService` exported з `QrModule`, готовий до інжекту у Sprint 3 controllers.
- 🔲 Жодного hard-coded `.max(N)` у `business.ts` / `invoice.ts` — усі через `FIELD_LIMITS`.
- 🔲 `CLAUDE.md` оновлений (Key Patterns + Known Complexities секції).

---

## Ризики / TPM-зауваги

### Sprint-blocking

1. **Spec acquisition (§2.0).** Без PDF-специфікації НБУ — builder 003 — це гадання. **Mitigation:** §2.0 — епік-блокер №0; жодна імплементація builder-а не починається до завершення цього артефакту. Якщо PDF недоступний / неоднозначний — fallback на консервативніші обмеження (коротша max-len) + фіксація TODO-research у `qr-spec/README.md` для верифікації через тестовий QR у живому банк-додатку (поза скоупом спринта, але артефакт фіксує що залишилось).
2. **UTF-8 bytes vs chars confusion.** Стандарт НБУ оперує **байтами** для length-обмежень; JS `.length` — це UTF-16 code units (≈ chars). Cyrillic символи (`І`, `Ї`, `Є`) — 2 байти, апостроф `'` — 1, емоджі — 4. Без явного `new TextEncoder().encode(str).length` legitimate ФОП-кейс ("Назва бізнесу — `ТОВ \"Молоко-Експрес\"`") мовчки переповнить byte-limit і зламає payload у деяких банках. **Mitigation:** окремі limits {chars, bytes} у `FIELD_LIMITS`, спільний isomorphic-helper `assertWithinUtf8Limits` (без `Buffer`, бо консумується і API, і web), окремі тести char vs byte overflow.
3. **Field separator semantics.** Формат — рядки розділені `\n`; **trailing empty fields обов'язкові** (без них payload коротший на одне поле і банк не парсить). `String.prototype.split('\n')` на стороні банку рахує trailing-empties — але `Array.prototype.join('\n')` на нашій стороні їх рахує тільки якщо вони присутні в array. **Mitigation:** `FIELD_ORDER[version]: readonly string[]` фіксує точну довжину масиву; builder завжди формує array цієї довжини, навіть якщо хвостові поля порожні; тест "trailing empties не obrizalysya" перевіряє exact-length output.

### Out-of-scope, але закладене коректно

1. **Per-bank deep-link payload formats.** Sprint 5 (research §3.1). Sprint 2 будує лише NBU-payload link (host-параметризований, host визначається у §2.0; формат `{host}/qr/{base64url}`); per-bank URL-схеми (`monobank://...`, `privat24://...`) надбудовуються поверх існуючого `build002/build003Payload` без переписування — payload ядро спільне, обгортка міняється.
2. **Bank → version policy (§4.4 qr-decisions).** Спринт надає механізм (`BANK_PAYLOAD_VERSION` map), не вирішує політику. Перемикання банку у fallback = 1 line PR + redeploy. Якщо політика дозріє до runtime-config — додається DB-table + admin UI у Phase 1.5.
3. **Custom logo content moderation (§2.2 qr-decisions).** Sprint 6. Sprint 2 рендерить лише дефолтне Finly-лого з `assets/`; параметр `logoPath` у `QrLogoCompositor` свідомо string (не R2-key, не Buffer), щоб Sprint 6 додав source-resolver зверху без зміни renderer.
4. **`qrcode` lib bundle size.** ~50 KB у production bundle `apps/api`. Несуттєво для server-side (Docker image вже ~200 MB через sharp/libvips). Якщо колись з'явиться **client-side** preview — там той же `qrcode` browser-build ~30 KB gzipped, прийнятно.
5. **PNG vs SVG output.** Sprint 2 рендерить **тільки PNG**. SVG може бути додано пізніше для масштабування без втрат (друк візиток) — `qrcode.toString(text, { type: 'svg' })` тривіально, додається без зміни інтерфейсу `QrService`. Не робимо у Sprint 2 бо немає споживача.

---

## Послідовність робіт (рекомендована)

1. **§2.0 spec acquisition** — paper-work перед кодом (1-1.5 дні: завантаження PDF, нормалізація таблиці полів, фіксація diff 002↔003).
2. **§2.1 pure payload-builder** — `format-version`, `limits`, `input`, `payload-002`, `payload-003`, `encode`, `universal-link`, golden-vector тести (2-2.5 дні; одна людина).
3. **§2.2 derive-from-spec** для Sprint 1 Zod-схем — паралельно з кінцем (2) (~0.5 дня).
4. **§2.3 NestJS QR-модуль** — renderer, compositor, service, integration round-trip з `jsqr` (2 дні; залежить від (2)).
5. **§2.4 bank → version map** — паралельно з (4) (~0.25 дня; тривіально).
6. Документація (`CLAUDE.md` секції Key Patterns + Known Complexities) + регресія full test sweep (~0.5 дня).

**Загалом:** ~6.5-7 робочих днів для одного інженера. Якщо §2.0 робить TPM/PM (paper-work паралельно з §2.1 builder-ами на основі попередньої гіпотези про поля 003) — calendar 4-5 днів. **Не починати імплементацію builder-а 003 до завершення §2.0** — переписувати після з'ясування реальної специфікації дорожче за тиждень очікування PDF-вичитки.
