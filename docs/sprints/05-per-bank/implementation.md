# Sprint 5 — Per-bank deep-links: розгадка механізму + імплементація

> **Дата:** 2026-06-02.
> **Контекст:** закриває open-question §3.1 з [`docs/product/qr-decisions.md`](../../product/qr-decisions.md)
> («як примусово відкривати конкретний банк»). Research-передісторія —
> [`research-aasa.md`](./research-aasa.md). Живий статус банків —
> [`bank-status.md`](./bank-status.md).

---

## Розгадка одним абзацом

Конкурент (`bank-qr.com.ua`) НЕ використовує жодного спец-API. Він бере
**звичайний НБУ payload-link** `https://bank.gov.ua/qr/<base64payload>` і:

- **на iOS** — підміняє протокол `https` на **приватну URL-схему банку**
  (`mono://bank.gov.ua/qr/<payload>`). Приватну схему `mono://` в системі заявив
  лише monobank, тож iOS відкриває рівно цей застосунок (діалог
  «Відкрити у програмі …?») і парсить той самий base64 payload, що й через
  universal link;
- **на Android** — будує `intent://`-URL з примусовим `package=` (той самий
  payload, `scheme=https`). Кожен банк декларує app-link на хост `bank.gov.ua`,
  тож package-targeting відкриває саме його; не встановлений → Play Store.

Механізм знайдено у їхньому `https://bank-qr.com.ua/js/pay.js` (функція
`openApplicationLink`). Жодних офіційних інтеграцій, signed-payload чи угод з
банками — лише публічний НБУ payload + публічні схеми/пакети застосунків.

---

## Чому це працює (а не системний пікер)

- НБУ-домен `qr.bank.gov.ua` / `bank.gov.ua/qr` зареєстрований як **спільний**
  universal/app link одразу ~30 банками (підтверджено
  `qr.bank.gov.ua/.well-known/apple-app-site-association` + `assetlinks.json`).
  Тому загальний НБУ-лінк дає **системний вибір** (Android) або «останній банк»
  (iOS) — без контролю над тим, що відкриється.
- Приватна схема (`mono://`, `privat24://`…) зареєстрована **тільки одним**
  банком → детермінований запуск саме його. Це і є важіль per-bank.
- iOS-діалог «Відкрити у програмі «…»?» з'являється саме для кастомної схеми
  (не для universal link) — він і видно на скрінах `IMG_0409..0411`.

---

## Формат посилань (наш білдер)

База — НБУ legacy payload-link `https://bank.gov.ua/qr/<b64>` (наш
`nbuLinks.legacy`).

| Платформа | Перетворення | Результат |
| --------- | ------------ | --------- |
| **iOS** | `https` → `<iosScheme>` | `mono://bank.gov.ua/qr/<b64>` |
| **Android** | `https` → `intent`, suffix `#Intent;scheme=https;package=<pkg>;S.browser_fallback_url=<Play Store>;end` | `intent://bank.gov.ua/qr/<b64>#Intent;scheme=https;package=com.ftband.mono;…;end` |

`iosScheme: null` (Ощад/Райф — приватна схема невідома) → білдер повертає `null`
→ UI робить fallback на загальний НБУ-universal-link (`nbuLinks.primary`).
Desktop — теж fallback (банк-додатків немає).

---

## Що реалізовано (file-map)

### `packages/types` (чиста логіка, host-agnostic)

- `src/constants/banks.ts`
  - `BANK_APP_LAUNCH: Record<BankCode, { iosScheme: string | null; androidPackage: string }>`
    — мапа для 10 банків `MVP_BANKS`.
  - `buildBankAppLink(nbuLegacyLink, bank, platform)` — будує iOS/Android лінк
    або `null`.
  - `type BankAppPlatform = 'ios' | 'android'`.
- `src/constants/banks.spec.ts` — 6 unit-тестів (підміна протоколу, null-fallback,
  intent-формат, exhaustiveness по `MVP_BANKS`).

### `apps/web`

- `src/shared/lib/clientPlatform.ts` — `detectClientPlatform(): 'ios' | 'android' | 'desktop'`
  (з обробкою iPadOS, що маскується під Mac). Викликається **лише на кліку** →
  без SSR-mismatch.
- `src/shared/ui/UiBankAppGrid/` — спільна сітка тапабельних банків. На кліку
  детектить платформу, будує лінк (`buildBankAppLink`) і `window.location.assign`;
  iOS-без-схеми / desktop → fallback на `nbuFallbackLink`. Живе у `shared/ui`
  (легітимний нативний `<button>`, споживається двома фічами без feature→feature
  import).
- `src/features/account-public/PublicAccountView.tsx` — неактивний grayscale-грід
  («Незабаром») замінено на активний `<UiBankAppGrid>`.
- `src/features/invoice-public/InvoicePublicView.tsx` — додано активний грід у
  `PaymentSection` + запасні CTA перейменовано на «Або відкрити в іншому банку».

---

## Поведінка fallback (важливо)

Per-bank схеми **приватні й недокументовані** — банк може змінити схему, і кнопка
тихо перестане відкривати застосунок. Тому UI **завжди** лишає поряд:

1. загальний НБУ-link (`nbuLinks.primary` / `legacy`) як кнопки «Інший банк»;
2. QR-картинки (primary + legacy).

Так клієнт ніколи не залишається без шляху до оплати, навіть якщо конкретна
банк-кнопка зламалась.

---

## Джерела значень мапи

- iOS-схеми + Android-пакети — з робочого `bank-qr.com.ua/js/pay.js`
  (`Banks[]` масив) + крос-звірка з публічними НБУ-реєстрами
  (`qr.bank.gov.ua/.well-known/{apple-app-site-association,assetlinks.json}`),
  зафіксованими в [`research-aasa.md`](./research-aasa.md).
