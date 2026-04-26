# Magic Link

Файл: `apps/api/src/modules/auth/auth.service.ts` (sendMagicLink, verifyMagicLink)

## Генерація

- Token: `randomBytes(32).toString('hex')` — 32 байти рандому, 64 hex-символів
- Зберігається в Redis як `magic:{token}` -> `{ email, purpose }` (JSON)
- TTL: 15 хвилин (конфігурується через `AUTH_MAGIC_LINK_TTL_MIN`)
- Rate limit: 3 запити на email за 15 хвилин (ключ: `ratelimit:magic:{email}`)
- Одноразовий: після використання видаляється з Redis через GETDEL (атомарно)
- **Anti-spam dedup:** Перед генерацією нового токену перевіряється ключ `magic_dedup:{email}:{purpose}`. Якщо є — новий лист не відправляється, фронту повертається успішна відповідь (silent dedup). TTL dedup: 60 секунд (конфігурується через `AUTH_MAGIC_LINK_DEDUP_SEC`).

## Верифікація

Файл: `apps/web/src/app/[locale]/auth/verify/page.tsx`

1. Юзер натискає magic link -> `GET {WEB_URL}/auth/verify?token=XXX`
2. Verify page робить `POST /api/auth/magic-link/verify` з токеном
3. Backend: Redis GETDEL -> парсить `{ email, purpose }` -> обробляє по purpose

### Обробка по purpose:

| Purpose | Дія на backend | Redirect на frontend |
|---------|----------------|---------------------|
| `login` | `findOrCreateByEmail()` -> tokens | `/profile` |
| `register` | `findOrCreateByEmail()` -> tokens | `/profile` |
| `reset-password` | `findOrCreateByEmail()` -> tokens | `/profile` |
| `delete-account` | `softDelete()` -> `revokeAllUserTokens()` -> deletion email | Показує екран "Акаунт видалено" inline |

## Помилки (token не знайдено)

Коли token невалідний (вже використаний, прострочений, або хибний):

1. Backend повертає 401 "Invalid or expired magic link token"
2. Verify page показує помилку inline з кнопкою "Спробувати знову" (веде на `/auth/signin`)

> **Примітка:** Backend не розрізняє expired та reused magic link — обидва випадки повертають однакову помилку (token не знайдено в Redis).
