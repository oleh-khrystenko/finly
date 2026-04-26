# Automated Tests — Auth

> Опис покриття та структури автоматизованих тестів для auth flow. Всі тести реалізовані та проходять. Source of truth для auth сценаріїв — `docs/architecture/auth-flow/`.

---

## Покриття

Unit, integration (e2e) та frontend unit тести для повного покриття авторизаційного потоку CyanShip.

**Scope:**

- Backend unit тести (services, controllers)
- Backend e2e тести (HTTP endpoints через Supertest)
- Frontend unit тести (api client, stores, components, middleware)

---

## Порядок виконання

Виконуй задачі послідовно. Кожен крок залежить від попереднього.

### Крок 1: Вивчи кодову базу

Перш ніж писати будь-який тест — прочитай і зрозумій:

1. **Специфікацію:** `docs/architecture/auth-flow/` — повний опис всіх auth flows, edge cases, security mechanisms
2. **Існуючі тести** — зрозумій patterns мокування, структуру, стиль assertions:
   - `apps/api/src/modules/auth/auth.service.spec.ts` (~77 тестів)
   - `apps/api/src/modules/users/users.service.spec.ts` (~24 тести)
   - `apps/api/src/modules/auth/services/email.service.spec.ts` (~9 тестів)
   - `apps/api/src/modules/users/cleanup.service.spec.ts` (~5 тестів)
   - `apps/api/test/app.e2e-spec.ts` (~6 тестів)
3. **Імплементацію** — зрозумій реальні сигнатури методів, логіку, edge cases:
   - `apps/api/src/modules/auth/auth.service.ts`
   - `apps/api/src/modules/auth/auth.controller.ts`
   - `apps/api/src/modules/users/users.service.ts`
   - `apps/api/src/modules/users/users.controller.ts`
   - `apps/api/src/modules/auth/services/email.service.ts`
   - `apps/api/src/modules/auth/strategies/jwt.strategy.ts`
   - `apps/api/src/modules/auth/strategies/google.strategy.ts`
4. **Frontend auth код:**
   - `apps/web/src/shared/api/client.ts` — axios interceptors, in-memory token
   - `apps/web/src/shared/api/auth.ts` — всі auth API функції
   - `apps/web/src/shared/api/mapApiCode.ts` — response code → i18n key
   - `apps/web/src/entities/user/authStore.ts` — Zustand store
   - `apps/web/src/features/auth/AuthInitializer.tsx`
   - `apps/web/src/features/auth/AuthGuard.tsx`
   - `apps/web/src/middleware.ts`

### Крок 2: Backend unit тести

### Крок 3: Backend e2e тести

### Крок 4: Frontend unit тести

---

## Constraints (обов'язкові правила)

1. **НЕ змінюй існуючі тести.** Тільки додавай нові `describe`/`it` блоки або нові файли.
2. **Дотримуйся існуючих patterns.** Мокування Redis, bcrypt, Mongoose, Resend — копіюй з існуючих spec файлів. НЕ вигадуй нові підходи.
3. **Читай реальний код перед написанням тесту.** Перевіряй сигнатури методів, назви параметрів, Redis ключі, HTTP статуси — бери з імплементації, а не з цього документа.
4. **Один тест = одна поведінка.** Не перевіряй кілька речей в одному `it()`.
5. **Слідуй проектним конвенціям** — прочитай `CLAUDE.md` в корені проекту.
6. **Запускай тести після кожного файлу.** Переконайся, що нові тести проходять, перш ніж переходити до наступного файлу.
7. **Не додавай нові залежності до API** без необхідності. Все потрібне вже є.
8. **Frontend:** потрібно налаштувати тестову інфраструктуру з нуля (jest/vitest, jsdom, testing-library). Зараз `apps/web` не має тестів взагалі.

---

## Крок 2: Backend Unit Tests — що додати

### 2.1 `apps/api/src/modules/auth/auth.service.spec.ts`

Прочитай існуючий файл. Додай тести для сценаріїв, які ЩЕ НЕ покриті. Перед додаванням кожного тесту — перевір, чи він вже не існує.

**Метод `handleGoogleAuth`:**
- Google login з deleted user → повертає `accountDeleted: true` + tokens (для recovery flow)
- Перевір, що `findOrCreateByGoogle` викликається з правильними аргументами

**Метод `sendDeletionConfirmationEmail`:**
- Виклик `emailService.sendDeletionConfirmation` з правильними аргументами (email, дата = now + grace period, lang)
- Перевір обчислення дати: `now + ACCOUNT_DELETION_GRACE_DAYS` днів
- Fallback мови до 'uk' якщо не передано

**Метод `loginWithPassword`:**
- Email normalization (trim + toLowerCase) — перевір, що `findByEmail` отримує нормалізований email

**Метод `checkEmail`:**
- Перевір, що pipeline `incr` + `expire` викликаються при першому запиті (коли `get` повертає null) — для ініціалізації rate limit лічильника

**Метод `rotateRefreshToken`:**
- Перевір grace period: якщо Redis повертає `"rotated"` для jti — це легітимний concurrent request, не reuse attack. Токен має бути прийнятий.

### 2.2 `apps/api/src/modules/users/users.service.spec.ts`

Прочитай існуючий файл. Додай:

**Метод `updateLang`:**
- Оновлює `preferredLang` для існуючого user
- Перевір правильний виклик `findByIdAndUpdate`

**Метод `setPasswordHash`:**
- Зберігає hash через `findByIdAndUpdate`
- Перевір що передається `{ passwordHash: hash }`

**Метод `findOrCreateByGoogle` (enrichment):**
- Existing user БЕЗ name/avatar → Google дані записуються (enrichment)
- Existing user З name/avatar → Google дані НЕ перезаписують існуючі (no-overwrite)
- Перевір що `provider` встановлюється якщо його немає

### 2.3 `apps/api/src/modules/auth/services/email.service.spec.ts`

Прочитай існуючий файл. Додай:

**Метод `sendDeletionConfirmation`:**
- UK template: правильний subject, email, дата в HTML
- EN template: правильний subject, email
- HTML містить link на WEB_URL (для recovery)
- HTML містить відформатовану дату видалення
- Fallback до 'uk' для невідомої мови
- Resend error → throws

**Метод `sendMagicLink` (доповнення):**
- EN template для `reset-password` — перевір subject
- EN template для `delete-account` — перевір subject

### 2.4 `apps/api/src/modules/auth/auth.controller.spec.ts`

Файл покриває:
- Які endpoints є
- Як встановлюються cookies
- Як формуються response objects
- Де береться IP (для rate limiting)

**Тестуй controller-level логіку (НЕ service логіку, вона вже покрита):**

| Endpoint | Що тестувати |
|---|---|
| `POST /auth/check-email` | Правильний виклик service, response format `{ data: { hasPassword, isNewUser } }`, передача IP |
| `POST /auth/login/password` | Cookie `bid_refresh` встановлюється (httpOnly, path=/), response містить `accessToken` + user, передача IP |
| `POST /auth/magic-link/send` | Response `{ data: { code: RESPONSE_CODE.MAGIC_LINK_SENT } }` |
| `POST /auth/magic-link/verify` | Cookie встановлюється для login/register/reset-password; cookie НЕ встановлюється для delete-account; response format |
| `GET /auth/google/callback` | Redirect URL містить `WEB_URL/auth/callback`, якщо `accountDeleted` — додає `?account_deleted=true` |
| `POST /auth/password/set` | Response з `RESPONSE_CODE.PASSWORD_SET` |
| `POST /auth/password/change` | Нова cookie + новий accessToken в response |
| `POST /auth/password/verify` | Response `{ data: { isValid: boolean } }` |
| `POST /auth/refresh` | Нова cookie + новий accessToken; при помилці — очищує cookie |
| `POST /auth/logout` | Cookie очищується (maxAge=0), response з `RESPONSE_CODE.LOGGED_OUT` |

**Мокування:** Mock `AuthService` повністю. Mock `Request` та `Response` objects (cookie, ip, headers).

### 2.5 `apps/api/src/modules/users/users.controller.spec.ts`

Файл покриває:

| Endpoint | Що тестувати |
|---|---|
| `GET /users/me` | Response format: id, email, profile, credits, hasPassword, deletedAt, preferredLang |
| `PATCH /users/me` | Виклик `usersService.updateProfile`, response з оновленим user |
| `PATCH /users/me/lang` | Виклик `usersService.updateLang`, response з `RESPONSE_CODE.LANG_UPDATED` |
| `POST /users/account/delete` | З паролем → `{ requiresPassword: true }`. Без пароля → `{ requiresMagicLink: true }` + виклик `authService.sendMagicLink` з purpose `delete-account` |
| `POST /users/account/delete/confirm` | Виклик `authService.verifyPassword` → `usersService.softDelete` → `authService.revokeAllUserTokens` → очищення cookie |
| `POST /users/account/restore` | Виклик `usersService.restore`, response з `RESPONSE_CODE.ACCOUNT_RESTORED` |

**Мокування:** Mock `UsersService` та `AuthService`. Mock `@CurrentUser()` decorator через request.user.

---

## Крок 3: Backend E2E Tests

### Файл: `apps/api/test/app.e2e-spec.ts`

Прочитай існуючий файл. Зрозумій:
- Як налаштований `MongoMemoryServer`
- Як мокується Redis (`REDIS_CLIENT` provider override)
- Як ініціалізується NestJS app
- Які хелпери вже є

**Додай хелпер-функції** (в тому ж файлі або окремому test utils файлі):

```
createUserWithPassword(email, password) → створює user з bcrypt-хешованим паролем в MongoDB
createUserWithoutPassword(email) → створює user без passwordHash
softDeleteUser(email) → встановлює deletedAt на user
loginWithPassword(email, password) → POST /auth/login/password, повертає { accessToken, refreshCookie }
loginAsMagicLink(email) → створює magic token в Redis, POST /auth/magic-link/verify, повертає { accessToken, refreshCookie }
createMagicLinkToken(email, purpose) → зберігає token в mocked Redis, повертає token string
```

**ВАЖЛИВО:** Redis в e2e мокований. Перед написанням хелперів перевір, як саме мокується Redis в існуючому e2e файлі — чи це повноцінний ioredis mock з state, чи jest.fn() без state. Від цього залежить, чи працюватимуть flows з Redis (rate limiting, magic links, refresh tokens). Якщо Redis mock не має state — потрібно або додати in-memory state до моку, або тестувати тільки ті flows, які не залежать від Redis state.

### Сценарії (згруповані по auth flows з auth-flow.md)

**А. Check Email flow:**
- Новий email → `{ hasPassword: false, isNewUser: true }`
- Існуючий з паролем → `{ hasPassword: true, isNewUser: false }`
- Існуючий без пароля → `{ hasPassword: false, isNewUser: false }`
- Невалідний email → 400
- Rate limit per IP → 429 після 10 запитів

**Б. Password Login flow:**
- Валідні credentials → 200, accessToken, user, cookie `bid_refresh`
- Невірний пароль → 401
- Неіснуючий email → 401
- User без пароля → 401
- Progressive lockout → 429 після 5 спроб
- Успішний login очищує лічильник спроб
- Deleted account → 200, `accountDeleted: true`, tokens видаються (для recovery)

**В. Magic Link flow:**
- Send з default purpose → 200
- Send з кожним purpose (login, register, reset-password, delete-account) → 200
- Rate limit → 429 після 3 запитів для одного email
- Dedup → повторний запит протягом 60s → 200 без відправки email
- Verify з purpose=login → user + accessToken + purpose + cookie
- Verify з purpose=register → створює нового user
- Verify з purpose=reset-password → повертає purpose для frontend
- Verify з purpose=delete-account → soft delete + revoke tokens + НЕ видає нові tokens
- Невалідний/expired token → 401

**Г. Password Management (потребує JWT):**
- `POST /auth/password/set` — без існуючого пароля → 200; з існуючим → 400; без auth → 401
- `POST /auth/password/change` — валідний current → 200 + нові tokens; невірний current → 401; без auth → 401; session invalidation (старий refresh token перестає працювати)
- `POST /auth/password/verify` — вірний → `{ isValid: true }`; невірний → `{ isValid: false }`; без auth → 401

**Д. User Profile (потребує JWT):**
- `GET /users/me` — авторизований → повний профіль (id, email, profile, credits, hasPassword, preferredLang); без auth → 401
- `PATCH /users/me` — оновлення name, avatar, preferredLang; partial update; без auth → 401
- `PATCH /users/me/lang` — оновлення мови; без auth → 401

**Е. Account Deletion flow:**
- User з паролем → `{ requiresPassword: true }`
- User без пароля → `{ requiresMagicLink: true }` (+ magic link відправлений)
- Confirm з валідним паролем → soft delete + cookie очищена
- Confirm з невірним паролем → 401
- Без auth → 401

**Ж. Account Restore flow:**
- Deleted user → restore → 200
- Active user → 400
- Без auth → 401

**З. Token Lifecycle (regression):**
- Refresh → 200 + нові tokens + нова cookie
- Refresh без cookie → 401
- Logout → 200 + cookie очищена
- GET /users/me з expired JWT → 401

**І. Response format (cross-cutting):**
- Success responses: `{ data: { ... } }`
- Error responses: `{ error: { code: string, message: string } }`
- Validation errors (невалідний body) → 400 з правильним форматом

---

## Крок 4: Frontend Unit Tests

### 4.1 Налаштування тестової інфраструктури

`apps/web` зараз НЕ має тестів. Потрібно налаштувати:

1. Встанови залежності: `jest`, `ts-jest` (або `@swc/jest`), `@testing-library/react`, `@testing-library/jest-dom`, `jest-environment-jsdom`
2. Створи `apps/web/jest.config.ts` (або `.js`)
3. Додай `test` скрипт в `apps/web/package.json`
4. Налаштуй path aliases (`@/*` → `./src/*`)
5. Налаштуй мокування Next.js modules (`next/navigation`, `next/headers`, `next-intl`)

**ВАЖЛИВО:** Перевір `apps/web/tsconfig.json` та `apps/web/next.config.ts` для правильних path aliases. Переконайся, що jest конфіг резолвить `@cyanship/types` правильно (може потребувати `moduleNameMapper`).

### 4.2 `apps/web/src/shared/api/client.spec.ts`

Тестуй axios interceptors та token management:

**Token management:**
- `setAccessToken(token)` зберігає token
- `getAccessToken()` повертає збережений token
- `setAccessToken(null)` очищує token

**Request interceptor:**
- Якщо є token → додає `Authorization: Bearer {token}` header
- Якщо немає token → НЕ додає header

**Response interceptor (401 auto-refresh):**
- На 401 → викликає `POST /auth/refresh` → retry original request з новим token
- НЕ retry для `/auth/refresh` endpoint (уникає infinite loop)
- НЕ retry для `/auth/logout` endpoint
- НЕ retry якщо запит вже був retried (`_retry` flag)
- Concurrent 401s → дедупліковані через shared promise (тільки один refresh request)
- Refresh failure → очищує token + очищує auth store + reject original request
- Refresh success → зберігає новий token + retry

**Мокування:** Mock `axios.create`, mock `axios.post` для refresh endpoint.

### 4.3 `apps/web/src/shared/api/auth.spec.ts`

Тестуй кожну функцію. Mock `apiClient` (з `./client`).

| Функція | Що перевірити |
|---|---|
| `checkEmail(email)` | POST `/auth/check-email`, повертає `data.data` |
| `loginWithPassword(email, password)` | POST `/auth/login/password`, викликає `setAccessToken`, повертає `data.data` |
| `sendMagicLink(email, lang?, purpose?)` | POST `/auth/magic-link/send` з правильним body |
| `verifyMagicLink(token)` | POST `/auth/magic-link/verify`, викликає `setAccessToken` |
| `setPassword(password)` | POST `/auth/password/set` |
| `changePassword(current, new)` | POST `/auth/password/change`, викликає `setAccessToken` |
| `verifyPassword(password)` | POST `/auth/password/verify`, повертає `{ isValid }` |
| `updateProfile(dto)` | PATCH `/users/me` |
| `deleteAccount()` | POST `/users/account/delete`, повертає `{ requiresPassword?, requiresMagicLink? }` |
| `confirmDeleteAccount(password)` | POST `/users/account/delete/confirm` |
| `restoreAccount()` | POST `/users/account/restore` |
| `refreshToken()` | POST `/auth/refresh`, викликає `setAccessToken` |
| `logout()` | POST `/auth/logout`, викликає `setAccessToken(null)` |
| `getMe()` | GET `/users/me`, повертає `data.data` |
| `updatePreferredLang(lang)` | PATCH `/users/me/lang` |

### 4.4 `apps/web/src/shared/api/mapApiCode.spec.ts`

| Сценарій | Input | Expected output |
|---|---|---|
| Success code + module | `getApiMessageKey('MAGIC_LINK_SENT', 'auth')` | `'notifications.auth.magic_link_sent'` |
| Error code + module | `getApiMessageKey('UNAUTHORIZED', 'auth')` | `'errors.auth.unauthorized'` |
| Error code без module | `getApiMessageKey('UNAUTHORIZED')` | `'errors.generic.unauthorized'` |
| Невідомий code без module | `getApiMessageKey('UNKNOWN_CODE')` | `'errors.generic.unknown_code'` |

**Мокування:** Потрібно мокнути `RESPONSE_CODE_TYPE` з `@cyanship/types`.

### 4.5 `apps/web/src/entities/user/authStore.spec.ts`

- Initial state: `user: null`, `isAuthenticated: false`, `isLoading: true`
- `setUser(user)` → `user` встановлено, `isAuthenticated: true`, `isLoading: false`
- `clearUser()` → `user: null`, `isAuthenticated: false`, `isLoading: false`
- `setLoading(false)` → `isLoading: false`
- `setLoading(true)` → `isLoading: true`

**Без мокування.** Zustand працює без Provider.

### 4.6 `apps/web/src/features/auth/AuthGuard.spec.tsx`

Тестуй з `@testing-library/react`:

- `isLoading: true` → рендерить spinner (UiSpinner)
- `isAuthenticated: false`, `isLoading: false` → рендерить null + викликає `router.replace` з `/auth/signin`
- `isAuthenticated: true`, `isLoading: false` → рендерить children

**Мокування:** Mock `useAuthStore`, mock `next/navigation` (`useRouter`, `useParams`).

### 4.7 `apps/web/src/features/auth/AuthInitializer.spec.tsx`

- На звичайному шляху → викликає `refreshToken()` → `getMe()` → `setUser()`
- На `/auth/callback` або `/auth/verify` → НЕ викликає refresh (SELF_AUTH_PATHS)
- Якщо refresh/getMe кидає error → викликає `clearUser()`
- Виконується тільки один раз (useRef guard)

**Мокування:** Mock `@/shared/api` (refreshToken, getMe), mock `useAuthStore`, mock `next/navigation` (usePathname).

### 4.8 `apps/web/src/middleware.spec.ts`

Тестуй Next.js middleware:

- Protected path (`/profile`) без cookie → redirect на `/auth/signin`
- Protected path (`/pay`) без cookie → redirect на `/auth/signin`
- Protected path з cookie → pass through (intlMiddleware)
- Auth path (`/auth/signin`) з cookie → redirect на `/profile`
- Auth path без cookie → pass through
- Public path → pass through
- Locale stripping: `/uk/profile` → strip `/uk` → check `/profile`

**Мокування:** Mock `NextRequest` (cookies, nextUrl, url), mock `next-intl/middleware`.

---

## Верифікація

Після завершення всіх кроків:

```bash
# 1. Backend unit tests
pnpm --filter api test

# 2. Backend e2e tests
pnpm --filter api test:e2e

# 3. Frontend unit tests
pnpm --filter web test

# 4. Coverage report
pnpm --filter api test:cov
# Target: >80% coverage для auth + users modules

# 5. Full build (переконатися що нічого не зламано)
pnpm build
```

**Критерії успіху:**
- Всі тести проходять (exit code 0)
- Нові тести покривають всі auth flows з `docs/architecture/auth-flow/`
- Існуючі тести не змінені та все ще проходять
- Жоден тест не залежить від зовнішніх сервісів (Redis, MongoDB Atlas, Google, Resend)
- Coverage auth + users modules > 80%
