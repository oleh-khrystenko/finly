# Захист від brute force

Файл: `apps/api/src/modules/auth/auth.service.ts` (checkBruteForce, checkEmailRateLimit)

## Невірний пароль — progressive lockout

Прогресивне блокування по ключу `login_attempts:{ip}:{email}`:

| Невдалих спроб | Блокування |
|----------------|------------|
| 5              | 1 хвилина  |
| 10             | 5 хвилин   |
| 20             | 15 хвилин  |

- **Ключ:** `login_attempts:{ip}:{email}` — зв'язка IP + email, щоб зловмисник не міг заблокувати вхід для легітимного юзера з іншого IP
- **TTL:** Лічильник спроб скидається після 15 хвилин неактивності (`AUTH_LOGIN_ATTEMPTS_TTL_MIN`)
- **Скидання при успіху:** Після успішного логіну лічильник очищується (`clearLoginAttempts`)
- **HTTP response:** 429 Too Many Requests з повідомленням "Too many login attempts. Try again in {N} minutes"
- **Frontend:** При 429 показує повідомлення з кількістю хвилин (парсить Retry-After header) + кнопку "Увійти через email-посилання" (`showMagicLinkSuggestion`)

## Rate limit для check-email

- **Ключ:** `check_email:{ip}` — per-IP rate limit
- **Ліміт:** 10 запитів на IP за 60 секунд
- **HTTP response:** 429 Too Many Requests

## Rate limit для magic link

- **Ключ:** `ratelimit:magic:{email}` — per-email rate limit
- **Ліміт:** 3 запити за 15 хвилин (`AUTH_MAGIC_LINK_RATE_LIMIT`, `AUTH_MAGIC_LINK_RATE_WINDOW_MIN`)
- **HTTP response:** 429 Too Many Requests

## Конфігурація

```
AUTH_LOCKOUT_THRESHOLDS=5:1,10:5,20:15   # спроби:хвилини_блоку
AUTH_LOGIN_ATTEMPTS_TTL_MIN=15
AUTH_MAGIC_LINK_TTL_MIN=15
AUTH_MAGIC_LINK_RATE_LIMIT=3
AUTH_MAGIC_LINK_RATE_WINDOW_MIN=15
AUTH_MAGIC_LINK_DEDUP_SEC=60
```
