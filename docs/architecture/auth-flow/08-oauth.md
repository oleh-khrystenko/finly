# OAuth (Google)

Файли:
- `apps/api/src/modules/auth/strategies/google.strategy.ts`
- `apps/api/src/modules/auth/auth.controller.ts` (googleAuth, googleCallback)
- `apps/web/src/app/[locale]/auth/callback/page.tsx`

## Флоу

1. Юзер натискає "Увійти з Google" — пряме посилання на `{API_URL}/auth/google`
2. Passport redirect на Google consent screen (scope: email, profile)
3. Google callback -> `GET /api/auth/google/callback`
4. GoogleStrategy: перевіряє наявність email і що email verified
5. `AuthService.handleGoogleAuth()` -> `findOrCreateByGoogle()`
6. Якщо юзера немає — створюється з email, profile.name, profile.avatar з Google
7. Якщо юзер існує — оновлюється: додається provider (якщо відсутній), заповнюються пусті name/avatar
8. Генерація tokens -> set `bid_refresh` cookie -> redirect на `{WEB_URL}/auth/callback`

## Callback page

9. Web callback page: `refreshToken()` -> отримує access token
10. Перевірка `?account_deleted=true`:
    - Якщо так: показує UI відновлення акаунту (заголовок + кнопка "Відновити" + опис)
    - Якщо ні: `getMe()` -> оновлення store -> redirect на `/profile`
11. При помилці: redirect на `/auth/signin`

## Деактивований акаунт через Google

Якщо юзер з деактивованим акаунтом входить через Google:
- Backend повертає `accountDeleted: true` (бо `user.deletedAt !== null`)
- Redirect на `{WEB_URL}/auth/callback?account_deleted=true`
- Callback page показує UI відновлення з кнопкою "Відновити акаунт"
- "Відновити" -> `POST /api/users/account/restore` -> `getMe()` -> `/profile`
