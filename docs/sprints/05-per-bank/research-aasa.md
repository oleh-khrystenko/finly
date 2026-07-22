# Sprint 5 — Research логи: Apple App Site Association (AASA) для українських банків

> **Дата дослідження:** 2026-05-05.
> **Метод:** перевірка публічних `/.well-known/apple-app-site-association` файлів на офіційних доменах банків. Нічого не зламано / не реверс-інженерено — це публічні файли, які iOS читає при встановленні додатку.
> **Контекст:** Sprint 5 §3.1 (`docs/product/qr-decisions.md`). Шукаємо спосіб відкривати конкретний банк замість системного пікера ОС.

---

## Висновок одним абзацом

Раніше припущення "публічних deep-link шляхів у Privat/Mono/PUMB немає" виявилось **хибним** для двох з трьох банків. Privat24 і Monobank виставляють публічні AASA-файли з паттернами шляхів, які виглядають як платіжні (`/send/*`, `/qr/*`, `/pay/*`, `/transfers_iban/*`). Це означає, що `https://privat24.ua/...` і `https://monobank.ua/...` **технічно можуть** відкривати банк-додаток напряму, без пікера. ПУМБ файлу не виставляє — для нього шлях лише через офіційну партнерську інтеграцію.

Залишається з'ясувати **формат параметрів**, що ці шляхи приймають (наш NBU-payload Base64URL чи власний формат банку). Це наступний крок research-spike.

---

## Перевірені URL (зафіксовано результати)

| URL                                                               | Статус                  | Знайдено                                      |
| ----------------------------------------------------------------- | ----------------------- | --------------------------------------------- |
| `https://privat24.ua/.well-known/apple-app-site-association`      | 200 OK                  | 540+ paths, два appID                         |
| `https://www.monobank.ua/.well-known/apple-app-site-association`  | 200 OK                  | 9+ paths, appID `com.ftband.mono`             |
| `https://send.monobank.ua/.well-known/apple-app-site-association` | 200 OK                  | 5 paths, той же appID                         |
| `https://next.privat24.ua/.well-known/apple-app-site-association` | 200 OK                  | appID той самий, але `paths: []` (не активно) |
| `https://www.pumb.ua/.well-known/apple-app-site-association`      | 404                     | —                                             |
| `https://pumb.ua/.well-known/apple-app-site-association`          | 404                     | —                                             |
| `https://retail.pumb.ua/.well-known/apple-app-site-association`   | 301 → www.pumb.ua → 404 | —                                             |

---

## Privat24 — приватбанк

**App ID (primary):** `QE23YWVJ9G.ua.pb.privat24`
**App ID (secondary, paths empty):** `34BZ2BPNN5.ua.privatbank.p24`
**Активний домен:** `privat24.ua`

### Шляхи, що виглядають релевантними для платежів на IBAN

```
/send/*
/rd2/send_qr
/rd2/send_qr/*
/rd/send_qr
/rd/send_qr/*
/rd2/sendmoney
/rd2/sendmoney/*
/rd/sendmoney
/rd/sendmoney/*
/rd2/transfers_iban
/rd2/transfers_iban/*
/rd/transfers_iban
/rd/transfers_iban/*
/rd2/transfers_ukr
/rd2/transfers_ukr/*
/rd/transfers_ukr
/rd/transfers_ukr/*
/rd2/r2p_pay
/rd2/r2p_pay/*
/rd/r2p_pay
/rd/r2p_pay/*
/rd2/openbanking-pay
/rd2/openbanking-pay/*
/rd/openbanking-pay
/rd/openbanking-pay/*
/rd2/transfers_express
/rd2/transfers_express/*
/rd2/transfers_swift
/rd2/transfers_swift/*
/rd2/pay_mob
/rd2/pay_mob/*
```

### Інше цікаве (для контексту)

- `/env/share/*` — поділитися чимось через додаток.
- `/rd2/auth`, `/rd/auth/*` — авторизаційні шляхи.
- `/rd2/back_to_source_app`, `/rd2/back_to_source_app/*` — повернення у застосунок-джерело (підтверджує, що Privat вміє bidirectional flow з зовнішніми додатками).
- `/rd2/ext_app_callback/*` — callback від зовнішнього додатку.
- `/rd2/ppcheckout/*` — checkout-flow.

### Найбільш імовірні кандидати для нашого use-case

1. **`https://privat24.ua/rd2/send_qr/...`** — буквальна назва "send via QR". Найочевидніший кандидат.
2. **`https://privat24.ua/send/...`** — короткий шлях, можливо успадкований з legacy.
3. **`https://privat24.ua/rd2/transfers_iban/...`** — прямий переказ на IBAN.

---

## Monobank

**App ID:** `LK7J8D2SS7.com.ftband.mono`

### Домен `www.monobank.ua` — основний

```
/s/*       — короткі посилання
/l/*       — l = link?
/a/*
/r/*
/q/*       — q = QR? (одно-літерне)
/m/*
/p/*       — p = pay?
/get/*     — з винятками /get/bnpl, /get/invest, /get/bond
/get
/qr/*      ← ЦЕ — наш кандидат №1
/call/*
NOT /market/*
NOT /market
```

### Домен `send.monobank.ua` — окремий, для переказів

```
/*           — кореневі лінки відкривають Mono
/auth/*
/pay/*       ← кандидат для переказу
/jar/*       — банки (jars), збори
/e/*
```

### Найбільш імовірні кандидати

1. **`https://www.monobank.ua/qr/{payload}`** — буквальний QR-шлях. Можливо приймає той самий Base64URL payload, що і `qr.bank.gov.ua` (якщо Mono просто розпарсить Base64URL).
2. **`https://send.monobank.ua/pay/{...}`** — окремий домен для платежів.
3. **`https://www.monobank.ua/pay/{...}`** — теж можливо (в `paths` його немає, але `send.` має).

---

## ПУМБ — нічого знайдено

- Жоден з типових доменів (`pumb.ua`, `www.pumb.ua`, `retail.pumb.ua`) не повертає AASA-файл.
- Це означає одне з:
    - Універсальні посилання у ПУМБ налаштовані лише для своїх внутрішніх піддоменів, які ми ще не знайшли.
    - ПУМБ не підтримує Universal Links взагалі (старіша архітектура).
    - Партнерська інтеграція є, але виключно через закриту угоду.
- **Дія:** розслідуємо окремо. Кандидати наступних доменів для перевірки: `online.pumb.ua`, `business.pumb.ua`, можливо APK-декомпіл для пошуку intent-filter-ів. У разі тотального fail — пишемо ПУМБ-у напряму у бізнес-підтримку.

---

## Що це **не дає** автоматично

- AASA-файл — це **тільки список шляхів, які ОС віддасть додатку замість браузера**. Він **не каже**, який формат параметрів додаток приймає у тому шляху. Можна тапнути по `https://privat24.ua/rd2/send_qr/123` — Privat відкриється, але швидше за все покаже помилку "невідомий формат" або переадресує на головну.
- Юридичний бік не змінився: те, що шлях технічно існує, не дає автоматичного дозволу його використовувати у власному продукті. Приват/Mono можуть мати в правилах "тільки для офіційних партнерів". Перевіряти прийдеться.

---

## Наступні кроки research

1. **Згенерувати ~6 тестових URL** (3 на Privat, 3 на Mono), різних форм, з реальним NBU-payload або з мінімальним набором параметрів. Тапнути з телефона і записати, що сталось.
2. Якщо хоч одна форма дала "відкрив банк з заповненими реквізитами" — зафіксувати точний URL-template і перейти до коду.
3. Якщо всі дали "відкрив банк, але порожній екран" — спробувати реверс-інженерити .ipa/.apk цих банків, щоб знайти URL-схему через `Info.plist` / `AndroidManifest.xml`.
4. Для ПУМБ — окремий research-вектор (інші домени, APK-декомпіл, бізнес-підтримка).

---

## Журнал

| Дата       | Дія                                                                                                                                                                                                                                                            | Хто           |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 2026-05-05 | Створено артефакт з результатами AASA-перевірки 3 банків (Privat ✅ 540+ paths, Mono ✅ 9+ paths, PUMB ❌ 404).                                                                                                                                                | Oleh + Claude |
| 2026-06-02 | **Механізм розгадано** (підміна `https`→приватна схема на iOS / `intent://package=` на Android). Реалізовано на public-сторінках рахунку + інвойсу. Деталі — [`implementation.md`](./implementation.md); статус банків — [`bank-status.md`](./bank-status.md). | Oleh + Claude |
