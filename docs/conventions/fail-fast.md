# Fail Fast & Env Sync Policy

> Кожна env var — required. Жодних дефолтів в коді. Всі значення живуть в `.env`.
> Якщо змінна відсутня — застосунок МУСИТЬ впасти на старті.

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
