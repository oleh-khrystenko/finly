# Sprint 8 — Публічний QR-генератор для незареєстрованих + claim-flow

> **Статус (запланований 2026-05-09):** новий спринт. Передумовами закриті всі sprint 1–4 deliverable-и (Sprint 3 UAT і Sprint 5/6 не блокують).
> **Передумови:** Sprint 2 QR-ядро (`@finly/types/qr` + `QrService.renderForNbuPayload`), Sprint 3 public-зона (`PublicBusinessesController` як референс throttle/whitelist patterns), Sprint 7 payer-types ⊃ `BusinessType = 'individual'` варіант з RNOKPP-валідатором.
> **Що розблоковує:** конверсійна точка входу для лідогенерації (стандартна landing → demo → signup воронка); reuse-абельні primitives для майбутніх anon-демо-фіч (інвойс-демо для зареєстрованих ФОП у Sprint 9+, multi-type demo).
> **Контекст рішень:** усі продуктові і технічні питання, з яких виросли цілі цього спринта, у [`planning-questions.md`](planning-questions.md). README не дублює rationale — лише імплементаційну механіку.

---

## Мета

Дати потенційному ФОП-у спробувати продукт **без реєстрації**: ввести IBAN + РНОКПП + призначення → за 2 секунди отримати валідний за нормативом НБУ QR-код 003 + universal-link, що відкривається в банк-додатку. Дані зберігаються у браузері (`localStorage`) і не зникають при перезавантаженні. Один клік "Зберегти у кабінет" → реєстрація → бізнес автоматично створюється у БД і привʼязується до акаунта.

End-to-end флоу:

```
Anon відкриває /
   ↓ заповнює форму (Отримувач / IBAN / РНОКПП / Призначення)
   ↓ POST /api/qr/preview  →  { link, qrPngBase64 }
   ↓ зберігається у Zustand+localStorage (формдата + результат)
Anon бачить QR + посилання + warning "дані ніде не зберігаються"
   ↓ натискає "Зберегти у кабінет"
   ↓ intent = 'claim-pending' (у store)
   ↓ редірект на /auth/signin
Anon реєструється (Google OAuth або magic-link)
   ↓ AuthInitializer гідратує user
   ↓ useClaimLandingDraft() МОНТУЄТЬСЯ у protected-layout-і (sibling до AuthGuard)
   ↓
[Розгалуження за станом профілю]
   │
   ├─ A. Профіль повний (Google OAuth дав firstName/lastName)
   │     ↓ AuthGuard пропускає на /business
   │     ↓ hook бачить (isAuthenticated && onboardingComplete && intent==='claim-pending')
   │     ↓ POST /api/businesses/me → success → router.replace('/business/{slug}?completed-from=landing')
   │
   └─ B. Профіль неповний (magic-link, або Google без surname)
         ↓ AuthGuard примусово редіректить на /profile?mode=new
         ↓ hook залишається змонтований (він СИБЛІНГ AuthGuard, не дитина)
         ↓ умова !onboardingComplete → hook чекає, нічого не робить
         ↓ User заповнює профіль → PATCH /users/me → authStore оновлюється
         ↓ onboardingComplete стає true → useEffect re-fires
         ↓ POST /api/businesses/me → success → router.replace('/business/{slug}?completed-from=landing')

   ↓ intent='claimed', формдата+результат clear-аються, toast "Бізнес створено"
Залогінений бачить banner "Перевірте список банків"
   ↓ за потреби знімає галочки → бізнес повноцінно функціональний
```

**Чому НЕ skip-ати onboarding для `BusinessesController.create`:** AuthGuard всеодно блокує рендер /business для incomplete-profile-користувача (`apps/web/src/features/auth/AuthGuard.tsx:34-50`), і навіть якщо backend-create пройде, frontend не змогти показати результат. Дві паралельні гілки enforcement-у (AuthGuard + OnboardingInterceptor) узгоджуються лише через "пройди онбординг повністю" — Sprint 8 цьому inviariant-у не суперечить, а **чекає** на нього.

---

## Скоуп

### Backend (`apps/api`)

- 🔲 **`QrController`** у `QrModule` — новий controller з єдиним публічним ендпоінтом `POST /api/qr/preview`. Без auth, без cookie, з throttle-bucket-ом `'qr-preview'` (10 req/min/IP).
- 🔲 **`QrPreviewDto`** через `createZodDto(QrPreviewInputSchema)` (shared schema).
- 🔲 **Throttle-bucket `'qr-preview'`** додається у `ThrottlerModule.forRoot` (`apps/api/src/app.module.ts`) поряд з `'default'` і `'public-payment'`.
- 🔲 **Reuse `QrService.renderForNbuPayload`** (Sprint 2) — жодних змін у service-layer-і. Controller викликає сервіс, отримує PNG buffer, повертає `{ link, qrPngBase64 }`.

### Frontend (`apps/web`)

- 🔲 **`/` (root) переписується**: коротка hero-секція + інтерактивний блок (form ліворуч, QR/link праворуч).
- 🔲 **Hero-секція** — заголовок + sub-text + 2 CTA + три benefit-tile-и з конкретними value-props (стандарт НБУ / один тап / без комісій). Content-complete.
- 🔲 **Interactive block** — феча `qr-landing-preview`: форма (RHF + Zod-resolver) + result-pane (`UiQrImage` + truncated link з copy-кнопкою + warning + claim CTA).
- 🔲 **Persistence layer** — entity `qr-landing-draft` з Zustand-`persist` (localStorage, key `finly:landing-draft`, version 1).
- 🔲 **Claim-flow** — `useClaimLandingDraft()` хук, інстанційований у protected-layout-і. Детектить `intent='claim-pending'` після auth → POST `/businesses/me` → clear draft → toast + redirect.
- 🔲 **Banner на business-detail** — read once-flag `?completed-from=landing` показує note "Перевірте список банків" з якорем на `BanksSection`. One-time, dismissable.

### Shared (`@finly/types`)

- 🔲 **`packages/types/src/contracts/qr-preview.ts`** — `QrPreviewInputSchema` (reuse `businessNameSchema`, `ibanZod`, `individualTaxIdZod`, `businessPaymentPurposeTemplateSchema`) + `QrPreviewResponseSchema`.
- 🔲 Re-export через `packages/types/src/contracts/index.ts`.

---

## НЕ-скоуп

- ❌ **Множинні типи отримувача в формі.** Тільки `'individual'` (Фіз особа) — захардкожено. ФОП/ТОВ/Організація — кабінетний wizard у Sprint 6 розширить landing на multi-type, але не зараз. Анонімному юзеру ми не питаємо систему оподаткування і ПДВ-payer-статус (вони nullable для individual-типу — Sprint 7 §SP-3).
- ❌ **Інвойс-демо.** Тільки бізнес-вивіска без суми (`amountKopecks: null`). Інвойс-режим (з фіксованою сумою + lockMask) — Sprint 9+ (вимагає окремих UI-полів і додаткової валідації).
- ❌ **Дві host-кнопки primary/legacy** як на `pay.finly.com.ua/{slug}`. У landing — один QR + одне посилання на `qr.bank.gov.ua` (NBU_HOST_PRIMARY). Legacy-fallback (`bank.gov.ua/qr`) — лише на повноцінній публічній сторінці бізнесу, де є місце пояснити різницю.
- ❌ **Server-side draft persistence.** Жодних DB-таблиць для anonymous draft-ів. Дані живуть у браузері користувача до моменту claim-у. Це матеріальна частина privacy-promise "ці дані не зберігаються на нашому сервері".
- ❌ **Pre-filled wizard після реєстрації** (альтернативна модель claim-flow B). Reject-нуто — `planning-questions.md` D4. Auto-create + banner-nudge — каноничний шлях.
- ❌ **Custom-logo в QR.** Норматив-asset гривні в центрі (Sprint 2 G2). Custom-logo upload — Sprint 6 (Paid).
- ❌ **`amount` чи `validUntil` поля у формі.** "Поки даних немає то там написати текст заклику..." — Sprint 8 робить exactly виставочний QR без суми (NBU дозволяє через `amountKopecks: null`).
- ❌ **Multi-language.** Single-locale (uk only) — convention з CLAUDE.md > Known Complexities.
- ❌ **A/B-тестування варіантів hero.** Один простий варіант без feature-flag-ів. Marketing optimization — Phase 1.5+.
- ❌ **Server-side rate-limit per-fingerprint.** Тільки IP-based (`ThrottlerGuard`). Anonymous endpoint живе під ризиком NAT-агрегації, але `'qr-preview'` budget 10/min достатньо щедрий навіть для офісної мережі.

---

## Архітектурні рішення (короткий перелік)

Повне обґрунтування — у [`planning-questions.md`](planning-questions.md). Тут — лише висновки.

| #  | Рішення                                                                                        | Альтернатива (reject-нута)                                                |
| -- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| D1 | Серверний рендер QR через `POST /api/qr/preview`                                               | Клієнтський QR через додавання `qrcode` лібу у web-bundle                 |
| D2 | Throttle-bucket `'qr-preview'` (10 req/min/IP) у `ThrottlerModule.forRoot`                     | Default 60/min — недостатньо restrictive для anon-зони                    |
| D3 | Persistence через Zustand+`persist`+localStorage у entity `qr-landing-draft`                   | sessionStorage (не переживає закриття вкладки), або без persistence       |
| D4 | Claim-flow: auto-create після auth з `acceptedBanks=[...MVP_BANKS]` + banner на business-detail | Pre-fill wizard з extra-кліком; новий "from-landing" endpoint            |
| D5 | Захардкожений `type='individual'` (без UI-перемикача типу)                                     | Повний multi-type селектор як у Sprint 7 wizard                          |
| D6 | Shared contract `packages/types/src/contracts/qr-preview.ts` (reuse existing field-schemas)    | Inline Zod на API і дублікат на web                                       |
| D7 | Один QR (тільки `NBU_HOST_PRIMARY`)                                                            | Дві кнопки primary/legacy як на public business page                      |

---

## Епіки

### 8.0 Shared contract (`@finly/types`)

**Файл:** `packages/types/src/contracts/qr-preview.ts` (новий).

```ts
import { z } from 'zod';
import { ibanZod } from '../validation/iban';
import { individualTaxIdZod } from '../validation/tax-id';
import {
    businessNameSchema,
    businessPaymentPurposeTemplateSchema,
} from '../entities/business';

/**
 * Sprint 8 §8.0 — input для публічного QR-preview-ендпоінту.
 *
 * Жорстко прибито до `'individual'` (Фіз особа): немає поля `type`, taxId
 * валідується саме як 10-цифровий РНОКПП з ДПС-checksum (`individualTaxIdZod`),
 * а не union RNOKPP+ЄДРПОУ. Якщо колись захочемо anon-демо для ТОВ — це нова
 * Zod-схема, не розширення цієї.
 *
 * Reuse `businessNameSchema` / `businessPaymentPurposeTemplateSchema` тримає
 * landing input під тими самими NBU charset + byte-limits, що cabinet —
 * single source of truth для "що валідне у нашому QR-payload-і".
 */
export const QrPreviewInputSchema = z.object({
    receiverName: businessNameSchema,
    iban: ibanZod,
    taxId: individualTaxIdZod,
    purpose: businessPaymentPurposeTemplateSchema,
});

export type QrPreviewInput = z.infer<typeof QrPreviewInputSchema>;

export const QrPreviewResponseSchema = z.object({
    /** Universal NBU payload-link, формат 003, host = `qr.bank.gov.ua`. */
    link: z.string().url(),
    /** PNG QR-код, base64-encoded (без префіксу `data:image/png;base64,`). */
    qrPngBase64: z.string().min(1),
});

export type QrPreviewResponse = z.infer<typeof QrPreviewResponseSchema>;
```

- 🔲 **`packages/types/src/contracts/index.ts`** — додати `export * from './qr-preview';`.
- 🔲 **`packages/types/src/contracts/qr-preview.spec.ts`** — unit-тести: parse валідного input-у, reject-кейси (bad iban / bad taxId / empty purpose / non-NBU char у name).

**DoD §8.0:** `pnpm --filter @finly/types build` зелений; усі реюзені імпорти (`businessNameSchema`, `businessPaymentPurposeTemplateSchema`) існують і не змінювали public-API в попередніх спринтах.

**Залежності для імпорту з `entities/business`:** треба перевірити, що `businessNameSchema` і `businessPaymentPurposeTemplateSchema` уже **named-exports** (read of `entities/business.ts` під час планування підтверджує — обидва експортуються). Якщо ні — окремий PR-prep крок винести як named-exports без зміни API.

---

### 8.1 Backend — `POST /api/qr/preview`

**Файли:**
- `apps/api/src/modules/qr/dto/qr-preview.dto.ts` (новий) — `class QrPreviewDto extends createZodDto(QrPreviewInputSchema) {}`.
- `apps/api/src/modules/qr/qr.controller.ts` (новий).
- `apps/api/src/modules/qr/qr.module.ts` — додати `controllers: [QrController]`.
- `apps/api/src/app.module.ts` — додати throttle-bucket `'qr-preview'`.
- `apps/api/src/modules/qr/qr.controller.spec.ts` (новий) — unit-тести.
- `apps/api/test/qr-preview.e2e-spec.ts` (новий) — e2e з MongoMemoryServer (хоча БД не торкається — keeps consistent з іншими e2e-тестами).

**Контролер:**

```ts
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import {
    NBU_HOST_PRIMARY,
    type QrPreviewResponse,
} from '@finly/types';

import { SkipOnboarding } from '../../common/decorators/skip-onboarding.decorator';
import { QrService } from './qr.service';
import { QrPreviewDto } from './dto/qr-preview.dto';

/**
 * Sprint 8 §8.1 — публічний preview для анонімних користувачів.
 *
 * Без auth, без cookie, без БД. Reuse `QrService.renderForNbuPayload` 1:1.
 * Throttle-bucket `'qr-preview'` (10/min/IP) — окремий від `'public-payment'`,
 * бо це інша поверхня атаки: payload-перебір потенційно дешевший за
 * full payment-page-hit (нема DB lookup-у). Тримаємо restrictive.
 *
 * `@SkipOnboarding()` — глобальний `OnboardingInterceptor` пропускати, бо
 * запит anon-only (немає user-context-у для перевірки onboarding-стану).
 */
@SkipThrottle({ default: true })
@Throttle({ 'qr-preview': { limit: 10, ttl: 60_000 } })
@Controller('qr')
export class QrController {
    constructor(private readonly qrService: QrService) {}

    @SkipOnboarding()
    @Post('preview')
    @HttpCode(HttpStatus.OK)
    async preview(
        @Body() dto: QrPreviewDto
    ): Promise<{ data: QrPreviewResponse }> {
        const png = await this.qrService.renderForNbuPayload(
            {
                receiverName: dto.receiverName,
                iban: dto.iban,
                receiverTaxId: dto.taxId,
                amountKopecks: null,
                purpose: dto.purpose,
            },
            '003',
            { host: NBU_HOST_PRIMARY }
        );
        const link = this.qrService.buildNbuPayloadLinkForInput(
            {
                receiverName: dto.receiverName,
                iban: dto.iban,
                receiverTaxId: dto.taxId,
                amountKopecks: null,
                purpose: dto.purpose,
            },
            NBU_HOST_PRIMARY
        );
        return {
            data: {
                link,
                qrPngBase64: png.toString('base64'),
            },
        };
    }
}
```

**Throttle-конфіг (`apps/api/src/app.module.ts`):**

Поточний shape — `ThrottlerModule.forRoot({ throttlers: [...] })` з рядом `{ name, ttl, limit }` (саме у такому порядку ключів). Sprint 8 додає **третій рядок** у існуючий масив, не змінюючи структуру:

```ts
ThrottlerModule.forRoot({
    throttlers: [
        { name: 'default', ttl: 60000, limit: 60 },
        { name: 'public-payment', ttl: 60000, limit: 600 },
        { name: 'qr-preview', ttl: 60000, limit: 10 }, // новий
    ],
}),
```

**Чому два виклики `QrService` (render + link), а не один:** `renderForNbuPayload` вже **внутрішньо** конструює link-у, але повертає лише PNG. Робити public link-getter був би invasive у service-API. Простіше — два виклики, payload будується двічі (~50µs each, BCP-39 + Base64URL). Якщо профілювання покаже bottleneck — додати overload, що повертає `{ png, link }` за одне обчислення payload-у. Зараз — premature.

**Unit tests (`qr.controller.spec.ts`):**

- 🔲 Валідний input → 200 + `{ data: { link starts-with "https://qr.bank.gov.ua/", qrPngBase64 length > 0 } }`.
- 🔲 Invalid IBAN → 400 з code `VALIDATION_ERROR`, field-path `iban`.
- 🔲 Invalid taxId (failing checksum) → 400 з code `VALIDATION_ERROR`, field-path `taxId`.
- 🔲 Empty purpose → 400.
- 🔲 Покрити `BusinessPaymentPurposeTemplate` byte-limit edge case (Кирилиця > char-limit, але < byte-limit).

**E2E tests (`test/qr-preview.e2e-spec.ts`):**

- 🔲 Happy-path supertest POST з валідним body → 200, response shape матчить `QrPreviewResponseSchema`.
- 🔲 Throttle-test: 11-й запит за 60s → 429.
- 🔲 PNG round-trip через `jsqr` декодування (як у `qr.service.integration.spec`) — підтвердження, що `qrPngBase64` декодується назад у NBU-payload-link.

**DoD §8.1:** `pnpm --filter api test`, `pnpm --filter api test:e2e`, `pnpm --filter api build` зелені; новий controller зареєстрований у `QrModule`; `'qr-preview'` throttle-bucket зʼявився у app-module.

---

### 8.2 Frontend — entity `qr-landing-draft` (persistence layer)

**Файли:**
- `apps/web/src/entities/qr-landing-draft/store.ts` (новий).
- `apps/web/src/entities/qr-landing-draft/index.ts` (новий) — public re-exports.
- `apps/web/src/entities/qr-landing-draft/store.spec.ts` (новий).

**Store-schema:**

```ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { QrPreviewInput, QrPreviewResponse } from '@finly/types';

export type ClaimIntent = 'idle' | 'claim-pending' | 'claimed' | 'claim-failed';

interface QrLandingDraftState {
    formData: Partial<QrPreviewInput>;
    result: QrPreviewResponse | null;
    intent: ClaimIntent;
    setFormData: (patch: Partial<QrPreviewInput>) => void;
    setResult: (result: QrPreviewResponse) => void;
    invalidateResult: () => void;
    setIntent: (intent: ClaimIntent) => void;
    clearAll: () => void;
}

const STORAGE_KEY = 'finly:landing-draft';
const STORAGE_VERSION = 1;

export const useQrLandingDraftStore = create<QrLandingDraftState>()(
    persist(
        (set) => ({
            formData: {},
            result: null,
            intent: 'idle',
            setFormData: (patch) =>
                set((s) => ({ formData: { ...s.formData, ...patch } })),
            setResult: (result) => set({ result }),
            invalidateResult: () => set({ result: null }),
            setIntent: (intent) => set({ intent }),
            clearAll: () =>
                set({ formData: {}, result: null, intent: 'idle' }),
        }),
        {
            name: STORAGE_KEY,
            version: STORAGE_VERSION,
            storage: createJSONStorage(() => localStorage),
            // partialize страхує від persist-у нових (не-доменних) полів:
            // якщо у майбутньому додамо UI-state-only поля у сам store —
            // вони не лізуть у localStorage без явного дозволу.
            partialize: (s) => ({
                formData: s.formData,
                result: s.result,
                intent: s.intent,
            }),
            // migrate-callback для майбутніх версій — поки що no-op-reset.
            migrate: (persistedState, version) => {
                if (version === STORAGE_VERSION) return persistedState;
                // Невідома стара версія → reset (gracious degrade).
                return {
                    formData: {},
                    result: null,
                    intent: 'idle',
                };
            },
        }
    )
);
```

**Поведінкові інваріанти (тестуються у `.spec.ts`):**

1. **Persist round-trip:** `setFormData({iban: 'UA...'})` → reload (повторне `create`-вживання store) → state містить ту саму iban.
2. **`invalidateResult` зберігає formData:** використовується коли користувач редагує поле після генерації — старий QR неактуальний, але форма не скидається.
3. **`clearAll` робить `intent = 'idle'`:** після успішного claim-у або ручного "Очистити" хук-листинер не повинен повторно тригерити claim.
4. **Hydration safety:** `useQrLandingDraftStore` на SSR віддає initial-state (`{}`) — компоненти, що рендеряться SSR, мусять використовувати `useEffect`-pattern або `'use client'`-only обгортки, щоб уникнути hydration mismatch.

**DoD §8.2:** unit-spec з 4-х кейсів вище зелений; localStorage-key `finly:landing-draft` появляється у DevTools після першого `setFormData`.

---

### 8.3 Frontend — feature `qr-landing-preview`

**Файли:**
- `apps/web/src/features/qr-landing-preview/index.ts` (новий) — public exports.
- `apps/web/src/features/qr-landing-preview/QrLandingBlock.tsx` (новий) — orchestrator (form + result side-by-side).
- `apps/web/src/features/qr-landing-preview/QrLandingForm.tsx` (новий) — RHF + Zod-resolver.
- `apps/web/src/features/qr-landing-preview/QrLandingResult.tsx` (новий) — empty-state і filled-state.
- `apps/web/src/features/qr-landing-preview/api.ts` (новий) — `fetchQrPreview()` + `claimLandingDraftAsBusiness()`.
- `apps/web/src/features/qr-landing-preview/__tests__/QrLandingForm.spec.tsx` (новий).
- `apps/web/src/features/qr-landing-preview/__tests__/QrLandingResult.spec.tsx` (новий).
- `apps/web/src/shared/api/client.ts` — додати named-export `publicPostJson<TBody, TRes>(path, body)` поряд з існуючим `publicFetchJson<T>(path)`.
- `apps/web/src/shared/api/client.spec.ts` (новий або розширення існуючого) — тест на `credentials: 'omit'` + `Content-Type: application/json` + reject на non-2xx через `PublicApiError`.

**`QrLandingBlock.tsx` (структура):**

```tsx
'use client';

import { QrLandingForm } from './QrLandingForm';
import { QrLandingResult } from './QrLandingResult';

export function QrLandingBlock() {
    return (
        <section
            id="try-now"
            aria-labelledby="try-now-heading"
            className="container mx-auto px-6 py-16"
        >
            <h2 id="try-now-heading" className="text-3xl font-semibold ...">
                Спробуйте прямо зараз
            </h2>
            <p className="text-muted-foreground mt-2 max-w-prose">
                Введіть реквізити — система згенерує QR-код за стандартом НБУ,
                який відкривається в будь-якому банк-додатку.
            </p>
            <div className="mt-10 grid gap-8 md:grid-cols-2">
                <QrLandingForm />
                <QrLandingResult />
            </div>
        </section>
    );
}
```

**`QrLandingForm.tsx` (структура):**

- Read-only badge "Тип отримувача: **Фіз особа**" (нерозкривний; пояснює, що під капотом залочений `type='individual'`).
- 4 поля:
  - `UiInput` — "Отримувач" (приклад значення «Іваненко Олена Петрівна», `autoComplete="name"`).
  - `UiInput` — "IBAN" (приклад значення `UA213223130000026007233566001`, `inputMode="text"`, `autoComplete="off"`, `spellCheck={false}`).
  - `UiInput` — "РНОКПП" (приклад значення «1234567890», `inputMode="numeric"`, `maxLength={10}`, `pattern="[0-9]*"`).
  - `UiTextarea` — "Призначення" (default value `"Поповнення рахунку"`, max-length підказка під полем).
- Кнопка "Створити QR" (disabled поки `formState.isValid !== true` або `isSubmitting`).
- При зміні **будь-якого** валідного поля після генерації — викликаємо `invalidateResult()` зі store, щоб старий QR не вводив в оману.

**Контракт RHF:**

```tsx
const form = useForm<QrPreviewInput>({
    resolver: zodResolver(QrPreviewInputSchema),
    mode: 'onChange',
    defaultValues: {
        receiverName: persistedFormData.receiverName ?? '',
        iban: persistedFormData.iban ?? '',
        taxId: persistedFormData.taxId ?? '',
        purpose: persistedFormData.purpose ?? 'Поповнення рахунку',
    },
});

// Persist у store на кожне валідне змінення (subscribe-to-watch).
useEffect(() => {
    const sub = form.watch((value) => {
        setFormData(value);
        if (result) invalidateResult();
    });
    return () => sub.unsubscribe();
}, [form, setFormData, result, invalidateResult]);

const onSubmit = async (data: QrPreviewInput) => {
    const response = await fetchQrPreview(data);
    setResult(response);
};
```

**`QrLandingResult.tsx`:**

- **Empty-state** (`result === null`):
  - Центрований empty-state: декоративна QR-іконка (контурна, не справжній код) + текст: "Ваш QR-код зʼявиться тут після введення даних".
- **Filled-state** (`result !== null`):
  - `<UiQrImage src={data:image/png;base64,...} alt="Платіжний QR-код">` — реюз існуючого primitive-у.
  - Truncated link: показуємо перші ~50 символів (host + початок Base64URL) + ellipsis. Точна довжина — derived з `host.length + 12 chars payload + '…'` для візуальної консистентності між короткими і довгими payload-ами.
  - Кнопка "Скопіювати посилання" (Sonner toast "Скопійовано" на success, `navigator.clipboard.writeText`).
  - Warning-banner (під QR): "Ці дані не зберігаються на нашому сервері. Збережіть бізнес у кабінет, зареєструвавшись."
  - CTA: `UiButton variant="filled"` "Зберегти у кабінет" — поведінка залежить від `useAuthStore.isAuthenticated`:
    - **Anon:** `setIntent('claim-pending')` + `router.push('/auth/signin')`.
    - **Logged-in:** прямий виклик `claimLandingDraftAsBusiness()` (див. §8.4).
  - Secondary: `UiButton variant="text"` "Очистити" → `clearAll()` + `form.reset()`. (`'text'` — low-emphasis variant у whitelist-і `UiButton/types.ts:4-12`; `'ghost'` у нашій design-системі не існує.)

**Truncation helper (note для імплементації):**

```ts
// Маска `https://qr.bank.gov.ua/eyJ0eXAiOi…` — host + 10-12 chars + ellipsis.
// Користувач довіряє host-у (`bank.gov.ua`) і бачить початок унікальної
// частини як "це не той самий що інший QR" сигнал.
function truncateLink(link: string, payloadHeadChars = 10): string {
    const slashIdx = link.indexOf('/', 8); // після "https://"
    if (slashIdx === -1) return link;
    const head = link.slice(0, slashIdx + 1 + payloadHeadChars);
    return `${head}…`;
}
```

**`api.ts`:**

Anonymous QR-preview hop використовує `publicPostJson` (новий sibling до існуючого `publicFetchJson` у `shared/api/client.ts`) — це гарантує `credentials: 'omit'` + жодного `Authorization`-header-а, що fundamental для anon-зони (axios `apiClient` з `withCredentials: true` + Bearer-interceptor суперечив би заявленому контракту "без auth, без cookie").

Claim-hop, навпаки, працює **тільки** для авторизованих → іде через `apiClient` (Bearer-токен необхідний).

```ts
import { apiClient, publicPostJson } from '@/shared/api/client';
import {
    MVP_BANKS,
    QrPreviewInputSchema,
    QrPreviewResponseSchema,
    type QrPreviewInput,
    type QrPreviewResponse,
} from '@finly/types';

export async function fetchQrPreview(
    input: QrPreviewInput
): Promise<QrPreviewResponse> {
    const validated = QrPreviewInputSchema.parse(input); // belt-and-suspenders
    const envelope = await publicPostJson<
        QrPreviewInput,
        { data: QrPreviewResponse }
    >('/qr/preview', validated);
    return QrPreviewResponseSchema.parse(envelope.data);
}

export async function claimLandingDraftAsBusiness(
    formData: QrPreviewInput
): Promise<{ slug: string }> {
    // Payload точно матчить `createIndividualVariant.strict()` з
    // `packages/types/src/contracts/businesses.ts`: рівно 5 ключів,
    // жодних додаткових (taxationSystem/isVatPayer/seoIndexEnabled/
    // invoiceSlugPresetDefault — заборонені для individual-варіанту,
    // дефолти проставляються Mongoose-схемою при insert-і).
    //
    // `acceptedBanks: [...MVP_BANKS]` — повний список 11 банків (тих самих,
    // що проставляє кабінетний wizard на step 4 за дефолтом B6). Bare-`[]`
    // рідко-плив contract-rule `acceptedBanksField.min(1)` зі скоупу sprint-3.
    // Banner на business-detail після claim-у запрошує переглянути список
    // і зняти галочки з банків, що не використовуються.
    const { data } = await apiClient.post<{ data: { slug: string } }>(
        '/businesses/me',
        {
            type: 'individual',
            name: formData.receiverName,
            requisites: { iban: formData.iban, taxId: formData.taxId },
            paymentPurposeTemplate: formData.purpose,
            acceptedBanks: [...MVP_BANKS],
        }
    );
    return data.data;
}
```

**Pre-flight checks (виконати перед §8.3):**

1. У `packages/types/src/index.ts` (або відповідному barrel-у) `MVP_BANKS` уже named-export — підтверджено читанням `entities/business.ts:3` (`import { MVP_BANKS } from '../constants/banks'`). Frontend може імпортувати напряму без додаткового re-export-у.
2. `createIndividualVariant.strict()` (`businesses.ts:88-99`) приймає рівно `{ type, name, requisites, paymentPurposeTemplate, acceptedBanks }`. Будь-який `taxationSystem`/`isVatPayer`/`seoIndexEnabled`/`invoiceSlugPresetDefault` у payload-і → 400 `VALIDATION_ERROR` через `.strict()`. Ці поля свідомо випадають з payload-у — service-layer і Mongoose-defaults їх проставляють.
3. У `shared/api/client.ts` додається новий named-export `publicPostJson<TBody, TRes>(path, body)` поряд з існуючим `publicFetchJson<T>(path)`. Контракт ідентичний за безпекою (`credentials: 'omit'`, `Accept: application/json`), плюс `Content-Type: application/json` і `JSON.stringify(body)`. На non-2xx → `PublicApiError` (reuse того самого error-class).

**DoD §8.3:** феча `qr-landing-preview` будує і рендериться без runtime-помилок; форма валідується (RHF inline-errors); submit викликає API; result персиститься; truncation відображає host видимо.

---

### 8.4 Frontend — claim-flow після auth

**Файли:**
- `apps/web/src/features/qr-landing-preview/useClaimLandingDraft.ts` (новий).
- `apps/web/src/app/(protected)/layout.tsx` — інтегрувати hook (одна-разовий effect).
- `apps/web/src/features/qr-landing-preview/__tests__/claim-flow.spec.tsx` (новий).

**Hook-логіка:**

```ts
'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { isOnboardingComplete, QrPreviewInputSchema } from '@finly/types';
import { useAuthStore } from '@/entities/user';
import { useQrLandingDraftStore } from '@/entities/qr-landing-draft';
import { claimLandingDraftAsBusiness } from './api';

/**
 * Sprint 8 §8.4 — пост-auth трігер для claim-у landing-draft-у.
 *
 * Спрацьовує **один раз**, коли всі чотири умови true:
 *   - користувач автентифікований (`isAuthenticated === true`)
 *   - онбординг профілю завершений (`isOnboardingComplete(user.profile)`).
 *     Це критичний gate: якщо новий користувач прийшов з лендінгу і ще не
 *     заповнив профіль, AuthGuard примусово редіректить його на
 *     `/profile?mode=new`. Backend `OnboardingInterceptor` все одно
 *     блокує `POST /businesses/me` до моменту завершення профілю.
 *     Hook чекає на цей флаг — після успішного PATCH `/users/me`
 *     authStore оновлюється, useEffect re-fires автоматично.
 *   - intent зі store === 'claim-pending'
 *   - formData у store пройшла Zod-валідацію (захист від drift-у схеми між
 *     версіями застосунку — якщо схема змінилась, autosave не запускаємо,
 *     показуємо toast "продовжити вручну").
 *
 * Race-protection: `inProgressRef` блокує повторні виклики у двох render-ах
 * до завершення першого. `intent='claimed'` після success — `useEffect`
 * наступних mount-ів не тригериться.
 */
export function useClaimLandingDraft(): void {
    const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
    const profile = useAuthStore((s) => s.user?.profile);
    const intent = useQrLandingDraftStore((s) => s.intent);
    const formData = useQrLandingDraftStore((s) => s.formData);
    const setIntent = useQrLandingDraftStore((s) => s.setIntent);
    const clearAll = useQrLandingDraftStore((s) => s.clearAll);
    const router = useRouter();
    const inProgressRef = useRef(false);

    const onboardingDone = profile ? isOnboardingComplete(profile) : false;

    useEffect(() => {
        if (!isAuthenticated) return;
        if (!onboardingDone) return; // ← чекаємо на profile completion
        if (intent !== 'claim-pending') return;
        if (inProgressRef.current) return;

        const parsed = QrPreviewInputSchema.safeParse(formData);
        if (!parsed.success) {
            setIntent('claim-failed');
            toast.error(
                'Не вдалося відновити чернетку — створіть бізнес вручну'
            );
            return;
        }

        inProgressRef.current = true;
        claimLandingDraftAsBusiness(parsed.data)
            .then(({ slug }) => {
                clearAll(); // intent='idle', formData={}, result=null
                toast.success('Бізнес створено');
                router.replace(`/business/${slug}?completed-from=landing`);
            })
            .catch(() => {
                inProgressRef.current = false;
                setIntent('claim-failed');
                toast.error(
                    'Не вдалося зберегти бізнес. Спробуйте ще раз із кабінету.'
                );
                // Failure залишає formData у store — користувач не втрачає
                // дані. Empty-state списку бізнесів читає `intent ===
                // 'claim-failed'` і показує CTA "Продовжити чернетку з
                // лендінгу" (§8.5).
            });
    }, [
        isAuthenticated,
        onboardingDone,
        intent,
        formData,
        setIntent,
        clearAll,
        router,
    ]);
}
```

**Інтеграція в `app/(protected)/layout.tsx` — критично важливе розміщення:**

Hook монтується **сиблінгом** до `<AuthGuard>`, **не дитиною**. Причина: AuthGuard повертає `null` для incomplete-profile-користувачів на non-profile-routes (`AuthGuard.tsx:48-50`). Якщо мокувати hook всередині AuthGuard, то для гілки B (нова реєстрація без імені) hook просто не змонтується до завершення профілю — перший mount відбудеться після `setUser` з фуллпрофайлом, але до того моменту AuthGuard вже зробив `router.replace('/profile?mode=new')`, і користувач сидить на /profile, де hook все ще не змонтований (бо AuthGuard з isProfilePage exception-ом рендерить /profile, але тільки якщо hook був там), — циркулярна dependency.

Правильна структура:

```tsx
// apps/web/src/app/(protected)/layout.tsx
import { ClaimLandingDraftHook } from '@/features/qr-landing-preview';
import AuthGuard from '@/features/auth/AuthGuard';

export default function ProtectedLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <>
            {/* ClaimLandingDraftHook рендериться як null, але утримує hook
                підписаним на authStore і qrLandingDraftStore. Він живий
                незалежно від того, що рендериться нижче через AuthGuard
                (children, /profile, або null). */}
            <ClaimLandingDraftHook />
            <AuthGuard>{children}</AuthGuard>
        </>
    );
}
```

`<ClaimLandingDraftHook />` — мінімальний компонент:

```tsx
'use client';

import { useClaimLandingDraft } from './useClaimLandingDraft';

export function ClaimLandingDraftHook(): null {
    useClaimLandingDraft();
    return null;
}
```

**Важливо:** компонент сам — `'use client'`. Якщо існуючий `app/(protected)/layout.tsx` зараз серверний — додавання client-сиблінга через client-компонент не змусить layout стати клієнтським; Next.js допускає змішані children у server layout-і.

**Тестування (`claim-flow.spec.tsx`):**

- 🔲 Anon (`isAuthenticated=false`) → hook не робить нічого незалежно від intent.
- 🔲 Authenticated + `onboardingDone=false` + `intent='claim-pending'` → hook чекає, API НЕ викликається (захист гілки B: користувач ще на /profile).
- 🔲 Authenticated + `onboardingDone=true` + `intent='claim-pending'` → API викликається, `clearAll()` спрацьовує, `router.replace` з `?completed-from=landing`.
- 🔲 Перехід `onboardingDone: false → true` (симуляція PATCH /users/me success) при незмінному `intent='claim-pending'` → hook fires автоматично через `useEffect`-deps.
- 🔲 API 500 → `intent='claim-failed'`, formData **не очищається**, toast.error викликається.
- 🔲 Schema-drift case (formData має невалідний iban): hook не робить API-виклик, `intent='claim-failed'`, error-toast.
- 🔲 Race-protection: два render-и підряд з тими ж (true, true, claim-pending) → API викликається один раз.

**DoD §8.4:** hook інтегрований у protected-layout, claim-flow.spec проходить, manual UAT-чек "anon → реєстрація → /business/{slug}" дає toast і banner.

---

### 8.5 Banner на business-detail (post-claim nudge)

**Файли:**
- `apps/web/src/features/business-edit/CompletedFromLandingBanner.tsx` (новий).
- `apps/web/src/app/(protected)/business/[slug]/page.tsx` — інтегрувати banner; **додати `id="banks"` на `<BanksSection>` обгортку** (поточний рендер `<BanksSection business={business} onSave={handlePatch} />` не має anchor-target — banner-CTA `<a href="#banks">` без цього не скролить). Конкретно: обгорнути `<BanksSection>` у `<section id="banks">` або передати `id`-prop, якщо `BanksSection` його приймає (за конвенцією `UiSectionCard` — перевірити). Без цього sub-task §8.5 CTA не функціональний.

**Логіка:**

- На mount читаємо `searchParams.get('completed-from') === 'landing'`.
- Якщо так — показуємо banner у верху сторінки:
  - Заголовок: "Дані з лендінгу збережено"
  - Текст: "За замовчуванням бізнес приймає всі 11 банків. Перевірте список і зніміть галочки з тих, що не використовуєте."
  - Кнопка: "Перейти до банків" (`<a href="#banks">`, scroll-to-section).
  - Кнопка-Х: dismiss → setQueryParam без `completed-from` через `router.replace` (без створення history-entry).
- Banner показується ТІЛЬКИ один раз — query-param removal на dismiss + не персиститься.

**Чому не додавати dismissed-flag у localStorage:** baner показується ОДИН раз ПІСЛЯ claim-у. Якщо юзер ігнорує — на наступному вході `?completed-from=landing` уже немає в URL → baner не зʼявляється. Жодної додаткової state-management складності не треба.

**Sprint-8.5 додатково:** на сторінці `/business` (список) у empty-state перевіряти `useQrLandingDraftStore.getState().intent === 'claim-failed'`. Якщо так — додаткова CTA "Продовжити чернетку з лендінгу" → відкриває create-wizard з pre-filled-полями (одно-разово; reuse `claimLandingDraftAsBusiness` з retry).

**DoD §8.5:** banner показується після успішного claim; dismiss прибирає його з URL; e2e-чек "anon → claim → bunner videly".

---

### 8.6 Hero-section

**Файли:**
- `apps/web/src/widgets/landing-hero/LandingHero.tsx` (новий).
- `apps/web/src/widgets/landing-hero/index.ts` (новий).
- `apps/web/src/app/page.tsx` — переписати.

**Контент:**

Hero — заголовок + sub-text + 2 CTA + три benefit-bullets (виправдані як content-complete: кожен bullet є реальним value-prop, а не декоративним блоком). Текст benefit-tile-ів — не маркетинг-копія, а constraints, що відображають реальний контракт продукту:

```tsx
export function LandingHero() {
    return (
        <section className="container mx-auto px-6 py-20">
            <div className="text-center">
                <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">
                    Платіжні QR-коди
                    <br />
                    <span className="text-primary">для українського бізнесу</span>
                </h1>
                <p className="text-muted-foreground mx-auto mt-6 max-w-2xl text-lg">
                    Згенеруйте QR-код за стандартом НБУ і прийміть оплату
                    в один тап з будь-якого банк-додатку.
                </p>
                <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
                    <UiButton as="link" href="#try-now" variant="filled" size="lg">
                        Спробувати без реєстрації
                    </UiButton>
                    <UiButton
                        as="link"
                        href="/auth/signin"
                        variant="outline"
                        size="lg"
                    >
                        Зареєструватись
                    </UiButton>
                </div>
            </div>

            <ul className="mx-auto mt-16 grid max-w-4xl gap-6 sm:grid-cols-3">
                <li className="bg-card border-border rounded-xl border p-6">
                    <h3 className="text-base font-medium">Стандарт НБУ</h3>
                    <p className="text-muted-foreground mt-2 text-sm">
                        Формат 003 згідно постанови № 97 — сумісний з усіма
                        банк-додатками України.
                    </p>
                </li>
                <li className="bg-card border-border rounded-xl border p-6">
                    <h3 className="text-base font-medium">Один тап</h3>
                    <p className="text-muted-foreground mt-2 text-sm">
                        Клієнт сканує QR або відкриває посилання — банк-додаток
                        запускається з заповненими реквізитами.
                    </p>
                </li>
                <li className="bg-card border-border rounded-xl border p-6">
                    <h3 className="text-base font-medium">Без комісій від Finly</h3>
                    <p className="text-muted-foreground mt-2 text-sm">
                        Сервіс не утримує процент з платежу. Гроші йдуть
                        напряму на ваш IBAN.
                    </p>
                </li>
            </ul>
        </section>
    );
}
```

Кожен з трьох tile-ів описує **конкретний** факт продукту:
- "Стандарт НБУ" — посилається на постанову № 97 (єдина існуюча нормативна база, не перебільшення).
- "Один тап" — описує реальний UX flow universal-link → app-link → банк-додаток.
- "Без комісій від Finly" — фактичне обмеження бізнес-моделі MVP (Sprint 6 додає Paid-плани, але % з платежу не входить у roadmap).

Hero — content-complete: він читабельний як готова сторінка. Жодних "поки що", "пізніше додамо", декоративних filler-ів.

**`page.tsx` стає:**

```tsx
import { Header } from '@/widgets/header';
import { LandingHero } from '@/widgets/landing-hero';
import { QrLandingBlock } from '@/features/qr-landing-preview';
import { fetchMetadata } from '@/shared/seo/metadata';

export function generateMetadata() {
    return fetchMetadata({
        page: 'home',
        href: 'landing',
        meta: {
            title: 'Finly — Платіжні QR-коди',
            description:
                'Згенеруйте QR-код за стандартом НБУ і прийміть оплату в один тап.',
        },
    });
}

export default function HomePage() {
    return (
        <>
            <Header />
            <main>
                <LandingHero />
                <QrLandingBlock />
            </main>
        </>
    );
}
```

**DoD §8.6:** `/` рендериться як hero+block, оба responsive (mobile-stacked, desktop-2col), без console-warnings.

---

## Cross-cutting

- 🔲 **`CLAUDE.md`** — додати у "Project Structure" `apps/web/src/features/qr-landing-preview` і `apps/web/src/entities/qr-landing-draft`. У "API Overview" — нову секцію `QrController` з ендпоінтом `POST /qr/preview` і throttle bucket. У "Configuration & Environment" нічого не міняється (нових env немає). У "Known Complexities" — пункт про Sprint-8 claim-flow та `intent`-state-machine у store.
- 🔲 **`docs/manual-checks/README.md`** — додати секцію "Sprint 8 — Anonymous QR preview" з пунктами LAND-1..8 (див. UAT нижче).
- 🔲 **`docs/sprints/README.md`** — додати рядок "Sprint 8" у tree-overview після Sprint 7 з кратким описом.
- 🔲 **`docs/product/business-flow.md`** — додати лід-секцію "Anonymous QR preview" з посиланням на цей README. Не дублювати rationale.

---

## UAT — Manual checks

Доповнити `docs/manual-checks/README.md` (живі-банк-додатки, малі екрани):

- **LAND-1.** На реальному телефоні (iOS Safari) відкрити `finly.com.ua` → ввести валідні реквізити → нажати "Створити QR" → переконатись, що QR відображається за < 3 секунди, посилання обрізається коректно, кнопка "Скопіювати" працює.
- **LAND-2.** Тапнути по QR-у з іншого пристрою (Android Camera або native scanner) → переконатись, що банк-додаток (Monobank/Privat24/будь-який з 11) відкривається з заповненими реквізитами.
- **LAND-3.** Перезавантажити вкладку → переконатись, що форма і QR відновлені з localStorage без миготіння.
- **LAND-4.** Anonymous → "Зберегти у кабінет" → пройти Google OAuth → переконатись, що toast "Бізнес створено" зʼявляється і landing-data вже у /business/{slug}.
- **LAND-5.** На сторінці business-detail після claim — banner "Перевірте список банків" видимий; натискання "Перейти до банків" скролить до `BanksSection` (anchor `#banks` має працювати — перевірити, що sub-task у §8.5 додав `id="banks"` на обгортку); "Х" приховує banner і прибирає `?completed-from=landing` з URL.
- **LAND-6.** На реєстрованому юзері з повним профілем відкрити `/` → форма працює; "Зберегти у кабінет" одразу створює бізнес без redirect-у на signin.
- **LAND-7.** Throttle: 11 швидких submit-ів за хвилину з одного IP → 11-й 429 з error-toast у UI; рядок з error не падає на UI.
- **LAND-8.** Гілка B claim-flow (incomplete profile): зайти у режимі incognito → заповнити landing → "Зберегти у кабінет" → magic-link signup на новий email (без firstName/lastName) → AuthGuard редіректить на `/profile?mode=new` → заповнити обовʼязкові поля профілю → submit → переконатись, що **автоматично** спрацьовує claim (toast "Бізнес створено" + redirect на /business/{slug}). Жодного додаткового кліку від користувача.

---

## Ризики

- **R1. Anonymous endpoint abuse / scraping.** Mitigation: throttle 10/min/IP, payload-validation strict, no DB writes (немає вектора амплифікації). Якщо post-launch побачимо abuse — додати CAPTCHA (Cloudflare Turnstile) на endpoint як next-step без зміни API.
- **R2. localStorage drift зі схеми застосунку.** Mitigation: `version: 1` + `migrate`-callback, який resets stale-state. Якщо changeschema у Sprint 9+ — bump version + write migration.
- **R3. localStorage disabled у браузері (privacy mode / Safari ITP).** Mitigation: feature працює без persistence (Zustand fallback на in-memory), але форма не зберігається при reload. UI показує note: "У вашому браузері локальне зберігання вимкнено — дані можуть зникнути при перезавантаженні." Реалізація: try-catch на perist-write з graceful fallback.
- **R4. Claim race з двома вкладками.** Один user відкрив landing у двох вкладках, заповнив у обох, в одній натиснув "Зберегти у кабінет", у другій теж. Обидві мають `intent='claim-pending'`, обидві після auth викликають POST → дублікат бізнесу. Mitigation: `inProgressRef` локальний, не cross-tab; додатково — broadcast-channel-сигнал на success "claim done" → інші вкладки роблять `clearAll`. Якщо broadcast недоступний — користувач ловить дублікат і видаляє руками. **Decision: НЕ реалізовуємо broadcast у Sprint 8** (overengineer-ing для edge-case). Acceptable.
- **R5. Claim API 500 → user думає, що дані втрачено.** Mitigation: failure НЕ робить `clearAll`, formData залишається у localStorage; toast пояснює "Спробуйте з кабінету"; Sprint 8.5 показує "Чернетка з лендінгу — продовжити" в empty-state списку бізнесів.
- **R6. SSR/CSR hydration mismatch на формі.** localStorage недоступний на SSR, тому `defaultValues` починаються з порожніх → після hydration поля наповнюються. Mitigation: `'use client'` у `QrLandingBlock`; форма рендериться лише після mount (`useEffect`-gate) для уникнення React-warning-у `useId() mismatch`. Альтернатива: skeleton-state на 1 frame після mount.
- **R7. Validation drift між shared schema і UI.** Reuse Zod з `@finly/types/contracts/qr-preview` як на API так і RHF-resolver — single source. Якщо валідатор у `entities/business` змінюється, drift автоматично propagates.

---

## Definition of Done

Спринт вважається закритим, коли:

1. ✅ `pnpm build` зелений у всіх workspace.
2. ✅ `pnpm test` зелений (нові тести §8.0/§8.1/§8.2/§8.3/§8.4/§8.5 + не зламані попередні).
3. ✅ `pnpm lint` без нових warnings.
4. ✅ Endpoint `POST /api/qr/preview` повертає 200 на supertest e2e і 429 на 11-му запиті.
5. ✅ `/` рендерить hero + interactive block; форма валідується inline; submit генерує QR; "Скопіювати" працює; "Очистити" обнуляє state.
6. ✅ Persistence: `pnpm dev` → ввести дані → reload → дані відновлені.
7. ✅ Claim-flow: anon → "Зберегти у кабінет" → Google OAuth → toast + redirect на /business/{slug} + banner.
8. ✅ Logged-in user на `/` → "Зберегти у кабінет" → прямо створює бізнес без signin-stop-у.
9. ✅ UAT LAND-1..8 виконано на реальному пристрої (manual checks журнал заповнений).
10. ✅ `CLAUDE.md` оновлено (Project Structure, API Overview, Known Complexities).
11. ✅ `docs/sprints/README.md` має рядок Sprint 8.

---

## Послідовність робіт

Рекомендований порядок для уникнення блокерів:

1. **§8.0** — shared contract (5–10 хв робота, blocker для §8.1 і §8.3).
2. **§8.1** — backend endpoint + tests (можна паралельно з §8.2 силами 2 розробників).
3. **§8.2** — entity store + tests.
4. **§8.3** — feature `qr-landing-preview` form/result/api.
5. **§8.6** — hero + page.tsx (тривіальна правка, можна одразу після §8.3 для UAT-готовності).
6. **§8.4** — claim-flow hook + integration в protected-layout.
7. **§8.5** — banner.
8. **Cross-cutting docs** + UAT прогон.

Kritичний шлях: §8.0 → §8.1 / §8.2 → §8.3 → §8.4 → UAT. Час на 1 розробника (з тестами): ~3–4 робочих дні.
