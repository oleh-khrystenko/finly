# Research-spike: WayForPay як білінг-провайдер підписки

Статус: чернетка з документації (2026-06-05). Усі ключові факти підтверджені 3-голосною adversarial-верифікацією (3-0) переважно за першоджерелами `wiki.wayforpay.com`, `help.wayforpay.com` та офіційним PHP SDK. Розділ «Відкриті питання до sandbox» перелічує те, що дока не закриває і що треба підтвердити у тестовому середовищі/договорі ПЕРЕД фіналізацією контракту.

## TL;DR (головний висновок)

WayForPay закриває потребу Finly у білінгу власної підписки для українського ФОП/ТОВ і, на відміну від Stripe, приймає UA ФОП і UA банк-рахунок. Він пропонує **два незалежні механізми рекурентів**, і вибір між ними — ключове рішення спринту:

- **Модель A, нативні «Regular payments»** (`POST /regularApi`): WayForPay сам списує за збереженим у нього розкладом. **Власний шедулер списань не потрібен.** Провайдер сам робить ретраї. Керування — один endpoint через `requestType` (`STATUS/SUSPEND/RESUME/REMOVE/CHANGE`). Ключова можливість: `CHANGE` міняє суму, інтервал і дату наступного списання активної підписки на льоту за тим самим `orderReference` — без cancel+create і без повторного вводу картки клієнтом.
- **Модель B, токенізація** (`recToken` + `Charge` host2host): `recToken` видається після успішного `Purchase` з повними реквізитами картки **або** `Verify`; дає списання без CVV і без 3-D Secure. Кожне списання мерчант ініціює сам через `Charge` (push). Повний контроль, але шедулер і обробку невдач будуємо самі.

**Провідна гіпотеза** («підписка керується провайдером») підтверджується для Моделі A: нативний режим покриває і скасування, і зміну суми/інтервалу штатно. Резерв B лишаємо на випадок, якщо нативний режим у sandbox виявиться обмеженим або потребуватиме довгого lead-time активації.

**Блокери, які треба запустити негайно (lead-time до коду):**
- **Активація рекурентів/токенізації.** Пряма згадка в доці: «нативний режим зазвичай потребує активації з боку WayForPay» — увімкнення Regular payments та/або токенізації може потребувати окремого запиту в підтримку. Подати першим, ще до коду шедулера/нативного режиму. Точний lead-time дока не фіксує — питання до sandbox/support.
- **Договір з WayForPay.** Укладається в кабінеті (розділ «Відшкодування» → «Мої реквізити» → «Договір»), Дія.Підпис + пакет верифікаційних документів. Це календарний, не кодовий блокер — стартувати паралельно.

**Спростоване твердження (важливо не переплутати):** «recToken — це і є нативний рекурент» — **СПРОСТОВАНО (0-3)**. `recToken+Charge` дає лише merchant-driven push (свій шедулер). Provider-driven розклад — це окремий сервіс Regular payments. Дві різні речі.

## Підтверджені факти

### Автентифікація і підпис запитів

- Підпис **усіх** запитів — `HMAC-MD5` над полями, зʼєднаними роздільником `;` (UTF-8), ключ = `merchantSecretKey` (у SDK — `merchant_password`). Параметри мерчанта: `merchantAccount` + `merchantSecretKey`.
  - SDK: `const FIELDS_DELIMITER = ';'`; `hash_hmac('md5', implode(';', $data), $merchant_password)`.
  - Джерела: [wiki 852102](https://wiki.wayforpay.com/en/view/852102), [wiki 852194](https://wiki.wayforpay.com/en/view/852194), [WayForPay/PHP SDK](https://github.com/wayforpay/PHP/blob/master/WayForPay.php).
- **Purchase і Charge — ідентичний набір і порядок полів підпису:** `merchantAccount, merchantDomainName, orderReference, orderDate, amount, currency`, далі **всі** `productName[]`, потім **всі** `productCount[]`, потім **всі** `productPrice[]` (згруповано по типу, не interleaved). Джерело: [wiki 852102](https://wiki.wayforpay.com/en/view/852102) / [852194](https://wiki.wayforpay.com/en/view/852194).
- **CHECK_STATUS — асиметричний підпис** (не плутати request і response):
  - request-підпис = `HMAC-MD5(merchantAccount;orderReference)` — 2 поля;
  - response-підпис покриває 8 полів `merchantAccount;orderReference;amount;currency;authCode;cardPan;transactionStatus;reasonCode`.
  - Джерело: [wiki 852117](https://wiki.wayforpay.com/en/view/852117).

> ⚠️ Розбіжність із нашою доменною моделлю: `amount` у Purchase/Charge передається як **decimal-сума у валюті** (напр. `1547.36`), а не в копійках-integer, як зберігаємо ми (`Invoice.amount` у копійках). Конверсія копійки↔decimal — обовʼязковий крок payload-mapper. (Підтвердити точний формат — десяткові коми/крапки, к-ть знаків — у sandbox.)

### Модель A — нативні Regular payments

- **Провайдер сам списує** за збереженим розкладом: «Payment is made automatically, according to the specified payment schedule»; при невдачі — ретрай наступного дня. Джерело: [wiki 852496](https://wiki.wayforpay.com/en/view/852496).
- `regularMode` (інтервали): `once, daily, weekly, monthly, quarterly, bimonthly, halfyearly, yearly` (+ `client`, `none` як службові). Джерело: [wiki 852102](https://wiki.wayforpay.com/en/view/852102).
- **Керування — один endpoint** `POST https://api.wayforpay.com/regularApi`, операція задається `requestType`:
  - `STATUS` — стан підписки; повертає lifecycle `Active/Suspended/Created/Removed/Confirmed/Completed` + `dateBegin/dateEnd/lastPayedDate/nextPaymentDate`. [wiki 852526](https://wiki.wayforpay.com/en/view/852526)
  - `SUSPEND` / `RESUME` — пауза / відновлення. [wiki 852506](https://wiki.wayforpay.com/en/view/852506) / [852513](https://wiki.wayforpay.com/en/view/852513)
  - `REMOVE` — дострокове припинення «без можливості відновлення»; поля `merchantAccount, merchantPassword, orderReference`. [wiki 852521](https://wiki.wayforpay.com/en/view/852521)
  - `CHANGE` — змінює `AMOUNT, CURRENCY, regularMode, DATEBEGIN, DATEEND` за `ORDERREFERENCE`: «Change the debit amount, debit frequency or date of next payment, or end date». [wiki 13271051](https://wiki.wayforpay.com/en/view/13271051)
- Стан підписки WayForPay **зберігає на своєму боці** — наш `STATUS`-poll або вебхук тримають нас у синхроні.

### Модель B — токенізація (recToken + Charge)

- `recToken` видається після успішного `Purchase` (повні реквізити картки) **або** `Verify` (верифікація з блокуванням коштів): «the card will be assigned with token recTocken… non-acceptance payment without input of CVV and without 3-D Secure». Джерело: [wiki 852175](https://wiki.wayforpay.com/en/view/852175), [852189](https://wiki.wayforpay.com/en/view/852189).
- `Charge` (host2host) — «quick payment making in one action», один запит = одне списання; приймає card-поля **або** `recToken`. Шедулер і ретраї — на боці мерчанта. Джерело: [wiki 852194](https://wiki.wayforpay.com/en/view/852194).

### Вебхук serviceUrl + handshake

- Вхідний колбек підписаний `HMAC-MD5(merchantAccount;orderReference;amount;currency;authCode;cardPan;transactionStatus;reasonCode)`.
- **Мерчант ЗОБОВʼЯЗАНИЙ відповісти підписаним accept-handshake** JSON:
  ```json
  {"orderReference":"DH783023","status":"accept","time":1415379863,"signature":"<HMAC-MD5(orderReference;status;time)>"}
  ```
  Без цієї відповіді WayForPay **повторює доставку події**. Джерело: [wiki 852102](https://wiki.wayforpay.com/en/view/852102).
- **Idempotency / guard проти подій не в порядку дока НЕ описує** — інженерна відповідальність мерчанта (див. відкриті питання). У кодовій базі вже є будівельні блоки: `ProcessedWebhookEvent` (two-phase pending→applied) і патерн `lastProviderEventAt: $lt`.

### Разові платежі (пакети executions)

- Метод `Purchase` — форма/redirect на WayForPay; поля `merchantAccount, merchantDomainName, orderReference, orderDate, amount, currency, productName[]/productCount[]/productPrice[]` + `merchantSignature`. Статус приходить на той самий `serviceUrl`. Джерело: [wiki 852102](https://wiki.wayforpay.com/en/view/852102).

### Sandbox / тест

- Публічні тестові креденшали: `merchantAccount = test_merch_n1`, `secretKey = flk3409refn54t54t*FNJRET`. Джерело: [wiki 852472](https://wiki.wayforpay.com/en/view/852472) (відтворено у численних сторонніх SDK).

### Підключення UA ФОП/ТОВ

- WayForPay **реально онбордить UA ФОП** і приймає **UA банк-рахунок** — прямий контраст зі Stripe.
- Договір: кабінет → «Відшкодування» → «Мої реквізити» → «Договір»; генерується документ під підпис (зокрема Дія.Підпис). Джерело: [help 1737806](https://help.wayforpay.com/view/1737806).
- Пакет документів ([help 13730003](https://help.wayforpay.com/view/13730003)):
  - **ФОП:** виписка з ЄДР, паспорт (книжечка або ID-картка з обох боків), довідка про місце проживання, ІПН.
  - **ТОВ:** установчий документ, паспорт директора, ІПН, наказ про призначення директора, протокол, банківська виписка, фінансова звітність за останній звітній період.

### Customer portal / повернення

- **Готового self-service customer-portal рівня Stripe Billing Portal немає.** Керування підпискою кінцевим користувачем (пауза/скасування/зміна плану) будуємо самі поверх `regularApi`. Джерела вказують лише на API, не на готовий portal.
- Повернення коштів — окремий Refund-флоу (метод reverse/refund; деталі підпису підтвердити у sandbox).

## Порівняльна нотатка: WayForPay vs Stripe (чинний)

Stripe — інкумбент, якого замінюємо; таблиця показує, що міняється для нас.

| Ось | WayForPay | Stripe (чинний) |
| --- | --- | --- |
| **UA ФОП/ТОВ + UA рахунок** | ✅ так, приймає | ❌ не обслуговує UA sole proprietors |
| **Нативні рекуренти** | ✅ Regular payments (provider-driven), `CHANGE` міняє суму+інтервал на льоту | ✅ зрілі Subscriptions |
| **Підпис** | HMAC-**MD5**, `;`-конкатенація, response-handshake обовʼязковий | `stripe-signature` header |
| **Customer portal** | ❌ будуємо самі поверх `regularApi` | ✅ готовий Billing Portal (втрачаємо) |
| **Комісія UA** | ❓ не підтверджено цифрами (треба договір/прайс) | n/a для UA ФОП |
| **Lead-time блокер** | активація рекурентів/токенізації + договір (Дія.Підпис) | — |

> Комісію WayForPay цей раунд **не** підтвердив конкретними відсотками — підтвердити в договорі/прайсі.

## Відкриті питання до sandbox

1. **Тарифи й терміни.** Точний % за транзакцію (UAH) і lead-time верифікації/підключення для UA ФОП/ТОВ — verified-claim'и цифр не дали. Підтвердити в договорі / напряму у WayForPay.
2. **Активація рекурентів.** Чи увімкнені Regular payments і токенізація (`Verify`/`recToken`) на `test_merch_n1` за замовчуванням, чи треба окремий запит у підтримку — і який lead-time активації на проді. Це блокер перед вибором A vs B і перед кодом.
3. **Idempotency / out-of-order для serviceUrl.** Дока не описує. Чи приходять дублі/застарілі статуси, за яким ключем дедуплікувати (`orderReference` + `transactionStatus` + processingDate?). Спроєктувати поверх наявних `ProcessedWebhookEvent` + `lastProviderEventAt`.
4. **Customer portal.** Підтвердити, що self-service порталу немає і весь UI керування підпискою (пауза/скасування/зміна плану) будуємо поверх `regularApi`.
5. **Формат `amount`.** Decimal-сума у валюті vs наші копійки-integer: точний формат (роздільник, к-ть знаків) і правила округлення — перевірити на живому Purchase, щоб підпис не ламався.
6. **Refund.** Точний метод і набір полів підпису повернення — підтвердити у sandbox.

## Першоджерела

- Платіж/підпис/вебхук: [wiki 852102](https://wiki.wayforpay.com/en/view/852102), [852117 CHECK_STATUS](https://wiki.wayforpay.com/en/view/852117), [852194 Charge](https://wiki.wayforpay.com/en/view/852194), [852175 recToken](https://wiki.wayforpay.com/en/view/852175), [852189 Verify](https://wiki.wayforpay.com/en/view/852189)
- Regular payments: [852496](https://wiki.wayforpay.com/en/view/852496), [852506 SUSPEND](https://wiki.wayforpay.com/en/view/852506), [852513 RESUME](https://wiki.wayforpay.com/en/view/852513), [852521 REMOVE](https://wiki.wayforpay.com/en/view/852521), [852526 STATUS](https://wiki.wayforpay.com/en/view/852526), [13271051 CHANGE](https://wiki.wayforpay.com/en/view/13271051)
- Sandbox: [852472](https://wiki.wayforpay.com/en/view/852472) · SDK: [WayForPay/PHP](https://github.com/wayforpay/PHP/blob/master/WayForPay.php)
- Онбординг: [help 1737806](https://help.wayforpay.com/view/1737806), [13730003 документи](https://help.wayforpay.com/view/13730003)
