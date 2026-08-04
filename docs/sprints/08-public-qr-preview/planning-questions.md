# Sprint 8 — Planning questions

> Архітектурні розгалуження, які треба було вирішити до початку імплементації.
> Кожна відповідь — фіналізована (рішення прийняте). Якщо щось перегортається у майбутньому — нова Q-секція з посиланням на причину.

---

## D1. Серверний рендер QR vs клієнтський

**Питання:** де рендериться QR-код — на сервері (новий endpoint) чи на клієнті (додавання `qrcode` лібу у web-bundle)?

**Рішення: серверний рендер через `POST /api/qr/preview`.**

**Чому:**

1. **Single source of truth для NBU-payload-логіки.** `QrService.renderForNbuPayload(input, '003', { host })` — це той самий шлях, що генерує QR на `pay.finly.com.ua/{slug}`. Reuse 1:1 без розгалужень.
2. **Pure builder з `@finly/types/qr` уже isomorphic** (працює і на Node, і у браузері), але **image-render** залежить від `sharp` (Node-only) і `qrcode` (npm-пакет, у нас уже на API). Клієнтський рендер вимагав би:
    - Додавання `qrcode` як web-залежності (~30KB gzipped).
    - Окремого `client-renderer.ts` без `sharp` overlay (норматив-asset гривні в центрі).
    - Двох розгалужених pipeline-ів для одного й того ж QR — ризик drift-у при змінах нормативу.
3. **Throttle і input-валідація централізовано на сервері.** Клієнтський рендер означає, що anon може DoS-ити власний браузер (не наш API), але також що ми не маємо metric-у "скільки QR-ів згенеровано" і не можемо мірити конверсію без додаткового tracking-endpoint-у. Сервер дає нативно це.
4. **Bundle-size і time-to-interactive.** Анонімний відвідувач на 3G — кожен KB рахується. ~30KB qrcode-лібу + його залежності — невелика, але уникома регресія TTI на головній.

**Альтернатива (reject-нута):** клієнтський рендер з `qrcode` лібою у web-bundle. Reject через 4 пункти вище.

**Trade-off:** мережевий round-trip ~200ms vs миттєвий клієнтський рендер. Acceptable: form-submit-then-show — звичайний UX-pattern, користувач очікує latency на "натиснув кнопку".

---

## D2. Throttle policy для anon-endpoint-у

**Питання:** який rate-limit ставимо на `POST /api/qr/preview`?

**Рішення: окремий named throttler-bucket `'qr-preview'`, limit 10 req/min/IP, ttl 60_000ms.**

**Чому 10/min, а не 60/min (default) і не 600/min (`'public-payment'`):**

- **60/min default** — недостатньо restrictive для anon. Payload-flooding scrapping (наприклад, перебір РНОКПП через checksum-генератор) міг би прокачуватись 60-rps × 60s × 60min = 216k спроб/год. Надто щедро для endpoint без auth.
- **600/min `'public-payment'`** — для public payment-page, де агресивний CDN/NAT збирає реальних платників в один IP. У lead-gen landing цей сценарій менше виражений: один анонімний user-це один user, NAT-multiplier у 10x не очікується.
- **10/min** — достатньо для нормального UX (3-5 typo-retry-ів за сесію + повторні generate-и при зміні полів) і restrictive для абʼюзу. Якщо реальні юзери впираються — bump до 20-30/min без зміни архітектури.

**Implementation:**

```ts
ThrottlerModule.forRoot({
    throttlers: [
        { name: 'default', ttl: 60000, limit: 60 },
        { name: 'public-payment', ttl: 60000, limit: 600 },
        { name: 'qr-preview', ttl: 60000, limit: 10 }, // новий
    ],
}),
```

(Shape — `{ throttlers: [...] }` з порядком ключів `{ name, ttl, limit }` — точно матчить існуючий `apps/api/src/app.module.ts:28-43`. Sprint 8 додає лише третій елемент масиву.)

```ts
@SkipThrottle({ default: true })
@Throttle({ 'qr-preview': { limit: 10, ttl: 60_000 } })
@Controller('qr')
export class QrController { ... }
```

**Альтернатива (reject-нута):** додавання Cloudflare Turnstile / hCaptcha. Reject як premature: Sprint 8 — MVP лідогенерації без proven-abuse signal-у. Якщо post-launch metric-и показують абʼюз → додаємо CAPTCHA як non-breaking-change без зміни API.

---

## D3. Persistence layer для form-state-у

**Питання:** де живе форм-data між reload-ами?

**Рішення: Zustand-`persist` middleware → localStorage, ключ `finly:landing-draft`, version 1.**

**Чому localStorage, а не sessionStorage / cookie / server-side:**

- **localStorage** — переживає закриття вкладки, перезавантаження, рестарт браузера. Користувач буквально сказав "перезавантаження та інші фактори не скинули" — це localStorage.
- **sessionStorage** — scope per-tab, гине на закриття вкладки. Не відповідає вимогам.
- **Cookie** — серверного state не маємо; cookie додало б по 4 поля × ~30 байт у кожному запиті без потреби (запит уже містить body-payload).
- **Server-side draft** — означає DB-table для anonymous user-ів з cookie-token-ом, cron для cleanup, новий `OrphanedDraft`-pattern. Контрадикує privacy-promise "ці дані не зберігаються на нашому сервері". Reject.

**Чому Zustand-`persist`, а не власний `useEffect(() => localStorage.setItem(...))`:**

- Convention з кодбази: `businessWizardStore` уже використовує цей патерн (Sprint 7 §SP-6).
- Версіонування з migrate-callback з коробки — захист від schema-drift.
- React 18 strict-mode-safe (без double-write-issue).
- Hydration-safe: store ловить server vs client mismatch і дає `_hasHydrated` flag (можна відкласти rendering до hydration completion).

**Що НЕ персиститься:** action-функції (`setFormData`, `clearAll`) — Zustand за замовчуванням не серіалізує functions. `partialize` явно whitelist-ить три поля: `formData`, `result`, `intent`. Якщо колись додамо UI-only state (наприклад, `isFormCollapsed: boolean`) — він не лізе у localStorage.

**TTL:** не вводимо. Draft живе вічно, поки користувач сам не очистить через "Очистити" або поки claim не пройде. Stale-draft-у через 6 місяців без використання — corner case, який користувач теж легко вирішить ручним кліком.

---

## D4. Claim-flow після реєстрації — auto-create vs pre-fill wizard

**Питання:** після того, як anon-user зареєструвався, що робити з його формданими?

**Опції:**

- **A. Auto-create:** одразу POST `/businesses/me` з даними + `acceptedBanks=[...MVP_BANKS]` (всі 11 банків як дефолт) → toast "Бізнес створено" → redirect на `/business/{slug}` з banner-ом "Перевірте список банків".
- **B. Pre-fill wizard:** redirect на `/business/new?prefill=1` → wizard відкривається з пре-заповненими кроками 1 і 2 → user обовʼязково вибирає банки на кроці 4 → submit → бізнес створюється.
- **C. Hybrid:** auto-create, потім **modal** "Доповнити банки" поверх business-detail.

**Рішення: A (auto-create з дефолтом усіх 11 банків + banner-nudge).**

**Чому A, а не B:**

1. **Literal interpretation user request-у.** Користувач сказав: "коли юзер зареєструється все це треба зберегти в базі і привʼязати до його акаунта". A — точне виконання; B вимагає extra клік "Створити" після auth.
2. **`acceptedBanks=[...MVP_BANKS]` точно матчить B6-дефолт wizard-у.** `packages/types/src/contracts/businesses.ts:46` enforces `acceptedBanksField = z.array(bankCodeSchema).min(1)` (нульовий стан заборонений). Sprint-3 рішення B6 (коментар у тому самому файлі) — UI-default = усі 11 MVP-банків. Claim-flow приєднується до того самого дефолту: "користувач явно не знімав галочки → вважаємо, що він приймає всі 11" — це той самий semantics, що в кабінетному wizard-і за замовчуванням.
3. **Single canonical create-path.** B вимагав би wizard з pre-fill mode → дві гілки логіки в wizard-і ("користувач прийшов з лендінгу" vs "користувач прийшов з кабінету"). A reuse-ить існуючий `POST /businesses/me` без changes у service / контракті / wizard-і.
4. **Banner-nudge закриває data-quality concern.** На сторінці `/business/{slug}?completed-from=landing` юзер бачить "Перевірте список банків" CTA на anchor-link до `BanksSection`. Перевірити = один скрол + опціонально зняти пару галочок.
5. **No half-finished implementations** (CLAUDE.md > "Doing tasks"). B вимагає parallel-shape `?prefill=1` логіки у wizard-і. A — ніяких "якщо це з лендінгу" if-розгалужень у пре-існуючому коді.

**Чому НЕ C:**

- Modal на business-detail — інтрузивний UX-pattern, перекриває cabinet-вʼю одразу після того, як user тільки-но зайшов. Banner — пасивний, не блокує дії.

**Trade-off A:** business створюється з усіма 11 банками → public page (`pay.finly.com.ua/{slug}`) показує повний список. Acceptable, бо:

- Banner на cabinet просить переглянути список — користувач знімає лише непотрібні.
- B6-дефолт у wizard-і вже так само налаштований, отже семантика "за замовчуванням всі" вже частина поведінки продукту.
- Альтернативу "1 дефолтний банк" відкинуто — невідомо який саме обрати без user-input-у.

**Контрактна узгодженість payload-у:**

`createIndividualVariant.strict()` (`packages/types/src/contracts/businesses.ts:88-99`) приймає рівно 5 ключів: `type, name, requisites, paymentPurposeTemplate, acceptedBanks`. Claim-payload містить точно цей набір. Будь-які додаткові поля (`taxationSystem`, `isVatPayer`, `seoIndexEnabled`, `invoiceSlugPresetDefault`) для individual-варіанту **заборонені** через `.strict()` — вони отримують дефолти на Mongoose-схемі при insert-і, не передаються з фронту.

---

## D5. Multi-type селектор у формі

**Питання:** показуємо у формі вибір типу (фіз особа / ФОП / ТОВ / організація) як у Sprint-7 кабінетному wizard-і, чи захардкоджуємо `'individual'`?

**Рішення: захардкоджено `'individual'` (Фіз особа). Видимий read-only badge у формі.**

**Чому:**

1. **User explicit:** "Тут ми не даємо вибору а просто під капотом хардкодимо цей пункт".
2. **Semantic alignment:** lead-gen landing — для невідомого user-а, який ще не уявляє себе як ФОП. "Фіз особа" — дефолтна опція для скиданок з друзями, донату, простого приймання-переказу. Якщо user уже — ФОП/ТОВ → він вже або має кабінет, або готовий зайти і пройти повний wizard.
3. **Скоуп-control:** додавання type-селектора затягує UI-логіку (taxId per-type валідатор, taxation-step для ФОП/ТОВ — Sprint 7 §SP-7). Це 30+ годин роботи без ясного value.
4. **Розширюваність:** якщо колись захочемо multi-type landing — нова Zod-схема `QrPreviewMultiTypeInputSchema` з discriminated union, новий form-component. Поточна `QrPreviewInputSchema` залишається для individual-only варіанту (backward-compat).

---

## D6. Shared contract location

**Питання:** де живе Zod-схема input-у?

**Рішення: `packages/types/src/contracts/qr-preview.ts` (новий файл).**

**Чому не inline на API:**

- Web-форма використовує **той самий** Zod через RHF-resolver. Inline на API → дублікат у `apps/web/src/features/qr-landing-preview/schema.ts` → drift-ризик при оновленні нормативних обмежень.
- Convention: усі shared contract-и (`CreateBusinessSchema`, `CreateInvoiceSchema`, `PublicBusinessSchema`) живуть саме у `@finly/types/contracts`. Sprint 8 не порушує цей патерн.

**Імпорти всередині `qr-preview.ts`:**

- `ibanZod` — з `validation/iban`.
- `individualTaxIdZod` — з `validation/tax-id` (без `payerTaxIdZod` — не потрібно ЄДРПОУ для individual).
- `businessNameSchema` — з `entities/business` (NBU charset + byte-limit для `receiverName`).
- `businessPaymentPurposeTemplateSchema` — з `entities/business` (той самий contract що `paymentPurposeTemplate` у бізнесі).

**Pre-flight check:** під час §8.0 робить `pnpm --filter @finly/types build`. Якщо `businessNameSchema` чи `businessPaymentPurposeTemplateSchema` ще не named-exports — окремий PR-prep крок винести як named-exports без зміни API. Поточний `entities/business.ts` (підтверджено читанням під час планування) **уже** експортує обидва як named.

---

## D7. Кількість host-кнопок у landing

**Питання:** показуємо одне посилання (на `qr.bank.gov.ua`) чи два (primary + legacy як на public-business-page)?

**Рішення: одне посилання + один QR на `NBU_HOST_PRIMARY = 'qr.bank.gov.ua'`.**

**Чому:**

1. **Сценарій use-case різний.** `pay.finly.com.ua/{slug}` — повноцінна публічна сторінка з місцем пояснити "Інший банк / Інший банк (запасний варіант)" і логотипи 11 банків. Landing — компактна одно-екранна форма; додавати два QR-и + дві кнопки = переобтяження UI.
2. **Risk-mitigation post-launch.** Sprint 3 рішення A2 (`docs/sprints/03-cabinet-public/planning-questions.md`) — Finly реалізує **обидва** допустимі hosts; з часом по metric-ам "яка частіше спрацьовує" одна з кнопок прибирається. На landing-у достатньо primary — якщо primary не працює у банк-додатку клієнта, то це не landing-конверсія, а norma-issue NBU host-у.
3. **Користувач сказав "один новий 003"** — пряма відповідь.

**Якщо колись захочемо legacy fallback на landing:** додати `?host=legacy` query-param + UI-toggle "Не відкривається? Спробуйте запасну адресу". Це non-breaking-зміна.

---

## D8. Auto-update QR при зміні полів після генерації

**Питання:** користувач натиснув "Створити QR", побачив результат, потім поправив IBAN. Що робимо з відображеним QR?

**Рішення: invalidate result (старий QR ховається), користувач змушений натиснути "Створити QR" знову.**

**Чому не debounced auto-regenerate:**

- Auto-regenerate при кожній валідній зміні створює зайві API-call-и (кожен — 200ms latency + throttle-budget).
- При типизаному IBAN-і (29 символів) користувач 28 символів був у "невалідному" стані; під час 29-го стає валідним — auto-regenerate спрацює раз. Acceptable, але робить "перегенерувати" implicit замість explicit.
- Explicit "Створити QR" даму юзеру control: він бачить, що дані змінились, і може свідомо запросити новий QR.

**Чому не зберігати старий QR з visual indicator-ом "stale":**

- Two-state UX (stale + fresh) додає складності у result-pane без чіткого value. Користувач, що дивиться на stale-QR, може випадково надіслати його клієнту з неправильним IBAN-ом — дата-quality-ризик.
- Простіше: invalidate → форма з кнопкою "Створити QR" → користувач генерує знов.

**Implementation:** `useEffect` у `QrLandingForm` watching form-state; на кожне зміна `formData` after-mount-у — `invalidateResult()` зі store.

---

## D9. Sprint placement (нумерація)

**Питання:** куди кладемо цей план — нова папка чи розширення існуючого спринта?

**Рішення: нова папка `docs/sprints/08-public-qr-preview/`.**

**Чому:**

- **Sprint 5** (per-bank deep links) — research-driven, паралельний шлях; landing-form не пов'язаний.
- **Sprint 6** (Монетизація + лонч) — full-onboarding для **зареєстрованих** + Free/Paid гейти + 2 landing для cabinet-онбордингу. Sprint 8 — про **anonymous** конверсію, інший сегмент. Включити у Sprint 6 — bloat, втрата фокусу.
- **Sprint 7** (payer-types) — у роботі; landing-feature не блокується payer-types (використовуємо `'individual'` тип).
- **Окремий Sprint 8** — clean scope, self-contained, можна закрити за 3-4 дні роботи.

**Розподіл відповідальностей з Sprint 6:**

- Sprint 6: post-signup onboarding flow (вибір worksAsBookkeeper, paid-конверсія modal, multi-business support).
- Sprint 8: pre-signup demo flow (заміна порожнього лендінга на робочий QR-генератор).

Розрізнення чітке: до signup vs після signup. Жодних cross-deliverable-ів.
