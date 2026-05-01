# Finly — План спринтів MVP (Phase 1)

> Короткий tree-overview спринтів MVP. Кожен спринт планується далі окремим документом у цій папці.
>
> **Статус:** working draft, 2026-05-01.

---

## [1. Архітектурний фундамент](01-foundation/README.md)

- [ ] Схеми БД (closed-end, без UI там, де "заготовка")
  - [ ] `User`: `lastName` required, `role` enum, `worksAsBookkeeper`
  - [ ] `Business`: `type`, nullable `ownerId`, `managers`, реквізити
  - [ ] `Invoice`: належить бізнесу, slug, lock-поля
- [ ] Юридичні сторінки (TOS / Privacy під Finly)

## 2. QR-ядро (генерація + валідація)

- [ ] Генератор формату **003** (основний)
- [ ] Генератор формату **002** (fallback)
- [ ] Валідатори реквізитів (IBAN checksum, ІПН, довжини за версіями)

## 3. Кабінет бізнесу + публічна вивіска

- [ ] Кабінет на `finly.com.ua/business/{slug}`
  - [ ] CRUD бізнесу з урахуванням `worksAsBookkeeper`
  - [ ] Авто-генерація slug
- [ ] Публічна сторінка `pay.finly.com.ua/{slug}`
  - [ ] Список банків (UI-кнопки, тимчасово через universal-link НБУ)
  - [ ] Кнопка "Інший банк"

## 4. Інвойси

- [ ] CRUD інвойсу під бізнесом
  - [ ] 4 пресети slug-а + явний/дефолтний режими
  - [ ] Lock суми / `valid_until` / призначення
- [ ] Публічна сторінка `pay.finly.com.ua/{slug}/{invoice-slug}`

## 5. Per-bank deep links (research-driven)

- [ ] Research-spike по 11 банках (iOS+Android, payload, fallback)
- [ ] Імплементація per-bank кнопок + policy для непокритих банків

## 6. Монетизація + лонч

- [ ] Free vs Paid гейти (ліміт бізнесів)
- [ ] Paid-фічі (vanity slug, custom logo у QR)
- [ ] Preview-режим у кабінеті + onboarding (2 landing)

---

## Примітки до структури

- **Спринт 5 — кандидат на паралельний запуск зі Спринтом 3.** Research-spike не блокує верстку публічної сторінки (валідно живе на universal-fallback), але блокує маркетингову обіцянку "тицяй свій банк".
- **Спринт 1 свідомо великий** — економимо на майбутніх міграціях (ролі, ownerless-бізнеси, тип бізнесу).
- **Що навмисне НЕ окремий спринт:** vanity-slug squatting policy, модерація логотипів, preview-деталі, перемикання 002↔003 per-bank — підпункти у відповідних спринтах.
- **Phase 1.5 (трекінг оплат, delegated managers, KYC) і Phase 2 (документи + AI)** свідомо поза цим деревом.
