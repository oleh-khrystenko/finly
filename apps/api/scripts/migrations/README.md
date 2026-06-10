# API migrations journal

Цей каталог тримає одноразові DB-міграції, що **не вкладаються у Mongoose
`syncIndexes()` / schema-default flow**: drop старих index-ів, backfill полів
існуючих документів, конверсії формату.

Кожна міграція — окремий standalone TS-script + `*.spec.ts` + npm-script у
`apps/api/package.json`. Виконується **один раз** на середовище (staging,
production); подальші запуски ідемпотентні (no-op). Реєстр виконань ведеться
у таблиці нижче, щоб через рік було видно, що де прокатано.

## Принципи

1. **Idempotency** — повторний запуск повинен бути безпечний (no-op після
   успішного first-run-у). Тестується явно у `*.spec.ts`.
2. **Не залежить від NestJS DI** — script стартує своїм mongoose-connect,
   щоб running у CLI / Docker-profile / test-MongoMemoryServer був
   симетричним. Імпорт NestJS-bootstrap-у тут — overkill і тягне за собою
   повну залежну графу модулів.
3. **Failure блокує deploy.** CI step запускає migration ДО `docker compose up`
   API; ненульовий exit-code → SSH-script через `set -euo pipefail` зупиняє
   deploy + rollback на попередній commit (див. `.github/workflows/deploy.yml`).
4. **Production runtime image обрізаний (`pnpm deploy --prod`)** — без
   ts-node/dev-deps. Тому migrations крутяться на окремому Dockerfile target
   `migrations` (extends build stage, де ts-node живий). Service у
   `docker-compose.yml` з profile `migrations`.

## Як запустити

### Local dev (проти власного Mongo)

```bash
# .env має бути заповнений (MONGODB_URI вказує на локальний / staging Mongo)
pnpm --filter api migration:slug-lower
```

### Production deploy (CI)

Виконується автоматично у `.github/workflows/deploy.yml`:

```bash
docker compose --profile migrations run --rm api-migrations
```

Контейнер виконує `pnpm run migration:all` (Dockerfile CMD) — chain усіх
міграцій chronologically. Кожна ідемпотентна, тож вже-прокатані no-op-ляться;
нові додаються через `migration:all` у `apps/api/package.json` без зміни
Dockerfile/deploy.yml.

Перед `docker compose up -d api`. Exit-code != 0 → deploy abort + rollback.

### Manual override (operational, якщо CI не спрацював)

```bash
ssh deployer@vps
cd /path/to/finly
docker compose --profile migrations run --build --rm api-migrations
```

## Реєстр виконань

| Скрипт                                  | Створено   | Навіщо                                                                                                                                                                                                                                                                                                                                                  | Staging | Production |
| --------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------- |
| `2026-05-03-businesses-slug-lower.ts`   | 2026-05-03 | Sprint 3 §3.1: перенесення unique-index `slug` → `slugLower` (case-preserved display + case-insensitive uniqueness, рішення E1). Drop `{slug:1}_unique` → backfill `slugLower=$toLower($slug)` → create `{slugLower:1}_unique`.                                                                                                                         | ⬜      | ⬜         |
| `2026-05-08-invoices-payee-snapshot.ts` | 2026-05-08 | Sprint 4 review fix: backfill `Invoice.payeeSnapshot` (recipientName + iban + taxId + resolved paymentPurpose) для existing invoices. Public NBU/QR payload тепер будується зі snapshot-у; legacy invoices без snapshot fallback-лять на live business у `payload-mapper`. Two-pass: load businesses у map → bulkWrite invoices з resolved snapshot.    | ⬜      | ⬜         |
| `2026-06-02-accounts-null-auto-name.ts` | 2026-06-02 | Account-name design-fix: `Account.name` став nullable (display-лейбл деривується через `deriveAccountLabel`). Занулює existing документи, де `name` дослівно дорівнює старому авто-формату `"{BANK_LABEL} •{last4}"` / `"Банк •{last4}"` (перерахунок з stored `bankCode` + `iban`); власні назви preserved. Прибирає дубль bank/mask у картці рахунку. | ⬜      | ⬜         |
| `2026-06-03-nested-slug-lower.ts`       | 2026-06-03 | Sprint 15: редаговувані vanity-slug-и Account+Invoice. Перенесення unique-index `accounts (businessId, slug)` → `(businessId, slugLower)` і `invoices (accountId, slug)` → `(accountId, slugLower)` (case-insensitive uniqueness). Drop старого compound-unique → backfill `slugLower=$toLower($slug)` → create нового. Порядок: backfill ДО create.    | ⬜      | ⬜         |
| `2026-06-10-slug-customized-backfill.ts` | 2026-06-10 | Sprint 19 review fix: backfill `slugCustomized` для pre-Sprint-19 документів (business/account/invoice). Slug-rent реконсиляція скидає лише `slugCustomized: true`, а прапорець ставиться тільки runtime-PATCH-ем — старі vanity-rename без backfill-у назавжди оминали б rent. Евристика: усе, що не могло вийти з генератора (8-char tail; invoice — tail або `*-tail`), мітиться customized; решта без поля отримує явний false. Працює лише по `$exists: false` — idempotent.                                                | ⬜      | ⬜         |

**Заповнення колонок Staging/Production:** виконавець ставить ✅ + дату при
успішному run-і. Якщо run упав — записує причину у Notes-секцію нижче, fix-ить,
переналаштовує. Не видаляти script після successful run — лишається як
історичний artifact.

## Notes

(порожньо)
