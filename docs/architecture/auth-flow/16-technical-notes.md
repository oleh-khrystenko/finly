# Технічні нотатки

## Endpoints авторизації

| Method | Path | Guard | Опис |
|--------|------|-------|------|
| GET | `/api/auth/google` | Passport | Redirect на Google consent |
| GET | `/api/auth/google/callback` | Passport | OAuth callback -> cookie -> redirect |
| POST | `/api/auth/check-email` | - | `{ hasPassword, isNewUser }` (rate limit per IP) |
| POST | `/api/auth/login/password` | - | Login з password (brute force protection) |
| POST | `/api/auth/magic-link/send` | - | Відправка magic link |
| POST | `/api/auth/magic-link/verify` | - | Верифікація token -> cookie + user + accessToken |
| POST | `/api/auth/password/set` | JwtActiveGuard | Встановити пароль (якщо ще немає) |
| POST | `/api/auth/password/change` | JwtActiveGuard | Змінити пароль (revoke all + new tokens) |
| POST | `/api/auth/password/verify` | JwtActiveGuard | Перевірити пароль (boolean) |
| POST | `/api/auth/refresh` | Cookie | Ротація refresh token |
| POST | `/api/auth/logout` | Cookie | Очистка cookie + revoke token |

## Magic link purposes

```typescript
MAGIC_LINK_PURPOSE = {
    LOGIN: 'login',
    REGISTER: 'register',
    RESET_PASSWORD: 'reset-password',
    DELETE_ACCOUNT: 'delete-account',
}
```

Контекст (email + purpose) зберігається в Redis як JSON разом з token.

## Redis keys

```
magic:{token64hex}                    -> { email, purpose } JSON    TTL = AUTH_MAGIC_LINK_TTL_MIN (15 min)
magic_dedup:{email}:{purpose}         -> token                      TTL = AUTH_MAGIC_LINK_DEDUP_SEC (60s)
ratelimit:magic:{email}               -> count                      TTL = AUTH_MAGIC_LINK_RATE_WINDOW_MIN (15 min)
check_email:{ip}                      -> count                      TTL = 60s
login_attempts:{ip}:{email}           -> count                      TTL = AUTH_LOGIN_ATTEMPTS_TTL_MIN (15 min)
refresh:{jti}                         -> userId / "rotated"          TTL = 7d / 10s (grace)
refresh_family:{userId}               -> Set[jti]                   TTL = 7d
```

## Token refresh rotation

Файл: `apps/api/src/modules/auth/auth.service.ts`

1. Verify JWT -> extract `jti`
2. GETDEL `refresh:{jti}` — атомарне видалення
3. Якщо значення відсутнє — reuse detection -> `revokeAllUserTokens()` -> 401
4. Якщо `"rotated"` — grace period (concurrent tab), дозволяється одне використання
5. Якщо `userId` — нормальна ротація: mark old as `"rotated"` з TTL 10s, видати нову пару

## User schema поля (auth-related)

```
email: string (unique, lowercase, trim)
provider: { name: string, id: string } | null
passwordHash: string | null               // bcrypt hash, null = немає пароля
deletedAt: Date | null                    // null = активний, Date = soft-deleted
accountDeletionRequestedAt: Date | null   // Date = чекає підтвердження email
lastLoginAt: Date | null
preferredLang: string (default: 'uk')
```

## Cookie

- Name: `bid_refresh`
- httpOnly: true
- secure: тільки в production
- sameSite: lax
- path: /
- maxAge: 7 днів

## Access token

- Зберігається в closure variable (не localStorage)
- TTL: 1 година
- Secret: `JWT_ACCESS_SECRET`
- Payload: `{ sub: userId, email }`

## Refresh token

- Зберігається як httpOnly cookie
- TTL: 7 днів
- Secret: `JWT_REFRESH_SECRET`
- Payload: `{ sub: userId, email, jti }`

## Email templates

Файл: `apps/api/src/modules/auth/services/email.service.ts`

4 magic link templates x 2 мови (uk, en) + 1 deletion confirmation template x 2 мови. Сервіс: Resend. Мова визначається за `preferredLang` юзера (fallback: uk).
