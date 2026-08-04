# Fail Fast & Env Sync Policy

> Кожна env var — required. Жодних дефолтів в коді. Всі значення живуть в `.env`.
> Якщо змінна відсутня — застосунок МУСИТЬ впасти на старті.

## Що взагалі є env var

`.env` — це конфігурація СЕРЕДОВИЩА: секрети, адреси хостів, рядки підключення, прапорці режиму (demo/prod). Тільки те, що справді різне у dev, staging і проді.

Продуктові налаштування — ціни, ліміти, пороги, терміни чисток — env var НЕ є: вони однакові скрізь, тож живуть у коді (`apps/api/src/config/{billing,auth,cleanup,help-chat}.config.ts`, `apps/web/src/shared/config/api.ts`) і змінюються деплоєм. Крос-полеві інваріанти таких констант перевіряються там же, на старті, тією ж fail-fast дисципліною.

## Rules

1. **НІКОЛИ** не додавати fallback в `getEnvVar()` / `assertEnv()` — жодного другого аргументу
2. **НІКОЛИ** не використовувати `??`, `||`, default params для env vars
3. Якщо env var відсутня — app МУСИТЬ впасти з повідомленням: `Environment variable "X" is not defined`
4. Це стосується ОБОХ файлів:
    - `apps/api/src/config/env.ts`
    - `apps/web/src/shared/config/env.ts`
5. Виняток: `apps/api/src/test-setup.ts` — тестові placeholder значення через `??=`

## Як додати нову env var

1. Додай в відповідний `config/env.ts` через `getEnvVar('NAME')` (без fallback)
2. Додай в `.env.example` з placeholder значенням
3. Додай в `.env` з реальним значенням для локальної розробки
4. Додай в `apps/api/src/test-setup.ts` з тестовим placeholder
