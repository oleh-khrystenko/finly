# Auth Testing: повне покриття auth flow тестами

## Контекст

Комплексне тестування всього auth flow: automated (unit + integration) та manual E2E тести. Всі автоматизовані тести реалізовані та проходять.

Покриває всю авторизацію: Google OAuth, Magic Link, Token Lifecycle, Password Auth, Progressive Lockout, Magic Link Purpose, Password Management, Account Deletion, Profile.

## Документи

| Файл | Опис |
|------|------|
| [automated-tests.md](./automated-tests.md) | Опис покриття: unit, e2e та frontend тести (всі реалізовані) |
| [manual-test-plan.md](./manual-test-plan.md) | Покрокові сценарії для ручного тестування з чеклистами |

## Scope

### automated-tests.md

Опис покриття та структури автоматизованих тестів.

- **Backend unit тести:** auth.service, users.service, email.service, auth.controller (новий), users.controller (новий)
- **Backend e2e тести:** всі auth + users endpoints, rate limiting, cookies, error format
- **Frontend unit тести:** axios interceptors, auth API functions, Zustand store, AuthGuard, AuthInitializer, middleware

### manual-test-plan.md

- **A. Auth Flows** — Google OAuth, Magic Link (5 scenarios), Progressive Disclosure
- **B. Password Auth** — login, progressive lockout, forgot password, show/hide toggle
- **C. Token Lifecycle** — access/refresh expiry, rotation, grace period, reuse detection
- **D. Route Protection** — protected/public/auth routes, middleware
- **E. Session Management** — logout, session persistence, concurrent refresh dedup
- **F. Profile** — new user, set/change/delete password, session invalidation
- **G. Account Deletion** — with password, with magic link, recovery
- **H. Email Templates** — 5 templates x 2 languages
- **I. Security** — anti-spam dedup, check-email rate limit, IP+email lockout

## Verification

1. `pnpm --filter @cyanship/types build` — types компілюються
2. `pnpm --filter api test` — всі backend unit тести pass
3. `pnpm --filter api test:e2e` — всі backend e2e тести pass
4. `pnpm --filter web test` — всі frontend unit тести pass
5. `pnpm build` — повний build без помилок
6. Manual: пройти весь чеклист з manual-test-plan.md
