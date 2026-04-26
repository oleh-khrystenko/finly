# Видалення акаунту

Файли:
- `apps/api/src/modules/users/users.controller.ts` (deleteAccount, confirmDeleteAccount, restoreAccount)
- `apps/web/src/features/profile/DangerZone.tsx`
- `apps/web/src/features/profile/DeleteAccountModal.tsx`
- `apps/api/src/modules/users/cleanup.service.ts`

## Де знаходиться

Сторінка профілю -> секція "Небезпечна зона" (DangerZone), показується тільки при `mode=null`. Червона рамка, заголовок "Видалення акаунту", опис "Після видалення у вас є 30 днів для відновлення акаунту", червона кнопка "Видалити акаунт".

## Що означає видалення

Soft-delete: акаунт деактивується (`deletedAt` = поточна дата). Протягом 30 днів можна відновити. Після 30 днів — hard-delete через CleanupService.

---

## Шлях А — Акаунт із паролем

**Крок 1.** Юзер натискає "Видалити акаунт".

**Крок 2.** Frontend: `POST /api/users/account/delete` -> backend повертає `{ requiresPassword: true }` -> відкривається модальне вікно (DeleteAccountModal).

**Крок 3.** Модальне вікно: заголовок, опис, поле пароля (з auto-focus), кнопки "Скасувати" і "Видалити акаунт". Закривається по Escape або кліку на backdrop.

**Крок 4.** Юзер вводить пароль -> `POST /api/users/account/delete/confirm`:
- Backend: `verifyPassword()` -> якщо невірний, 401 -> показ помилки під полем пароля
- Якщо вірний: `softDelete()` -> `revokeAllUserTokens()` -> `sendDeletionConfirmationEmail()` -> clear cookie

**Крок 5.** Frontend: toast success -> redirect на `/auth/signin`.

---

## Шлях Б — Акаунт без пароля (тільки Google або magic link)

**Крок 1.** Юзер натискає "Видалити акаунт".

**Крок 2.** Frontend: `POST /api/users/account/delete` -> backend:
- Відправляє magic link з purpose `delete-account`
- Встановлює `accountDeletionRequestedAt` на юзері
- Повертає `{ requiresMagicLink: true }`

**Крок 3.** Frontend оновлює store (`accountDeletionRequestedAt`), показує інформаційний блок:

```
┌─────────────────────────────────────────────────────────┐
│  Небезпечна зона                                        │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Видалення акаунту                              │    │
│  │  Після видалення у вас є 30 днів для            │    │
│  │  відновлення акаунту.                           │    │
│  │                                                 │    │
│  │  ┌──────────────────────────────────────────┐  │    │
│  │  │  [Інформаційний блок]                    │  │    │
│  │  │  Посилання для підтвердження видалення   │  │    │
│  │  │  надіслано на вашу адресу.               │  │    │
│  │  └──────────────────────────────────────────┘  │    │
│  │                                                 │    │
│  │  [ Надіслати повторно (60с) ]                   │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

**Кнопка "Надіслати повторно":** Після відправки кнопка на 60 секунд стає неактивною з відліком. Стан `isPendingDeletion` визначається за `accountDeletionRequestedAt` — якщо менше 15 хвилин тому, блок показується. Після 15 хвилин повертається початковий стан.

**Крок 4.** Юзер натискає посилання в email -> verify page:
- Backend: `handleDeleteAccountVerification()` -> `softDelete()` -> `revokeAllUserTokens()` -> `sendDeletionConfirmationEmail()`
- Frontend: verify page показує екран "Акаунт видалено" з кнопкою "Увійти" (веде на `/auth/signin`)

---

## Confirmation email (обидва шляхи)

Файл: `apps/api/src/modules/auth/services/email.service.ts` (sendDeletionConfirmation)

Після деактивації на пошту надходить лист з:
- Підтвердженням що акаунт деактивовано
- Датою остаточного видалення (поточна дата + 30 днів)
- Інструкцією як відновити: увійти протягом 30 днів
- Кнопкою "Увійти" (веде на WEB_URL)

---

## Grace period — 30 днів для відновлення

Після деактивації акаунт існує в системі ще 30 днів (`ACCOUNT_DELETION_GRACE_DAYS`).

Зайти на платформу та користуватися нею неможливо — `JwtActiveGuard` відхиляє юзерів з `deletedAt !== null`.

Але увійти через форму авторизації можна. Поведінка залежить від методу:

### Відновлення через пароль (signin page)

1. Юзер вводить email + пароль на signin page
2. `loginWithPassword()` повертає `accountDeleted: true`
3. Frontend розраховує дату видалення та залишок днів
4. Стан переходить в `recovery` — показує "Акаунт деактивовано" з датою та кнопками "Відновити акаунт" / "Вийти"
5. "Відновити" -> `POST /api/users/account/restore` (guard: `JwtAuthGuard`, дозволяє deleted users) -> toast success -> `getMe()` -> `/profile`

### Відновлення через Google OAuth (callback page)

1. Google OAuth -> `handleGoogleAuth()` -> `accountDeleted: true` (бо `deletedAt !== null`)
2. Redirect на `{WEB_URL}/auth/callback?account_deleted=true`
3. Callback page показує UI відновлення
4. "Відновити" -> `POST /api/users/account/restore` -> `/profile`

### Відновлення через magic link (verify page)

1. Magic link (login/register purpose) -> `verifyMagicLink()` -> `accountDeleted: true`
2. Verify page отримує `accountDeleted` в response — але поточна реалізація не обробляє це окремо, редіректить на `/profile`
3. На profile `JwtActiveGuard` блокує доступ (user deleted) -> middleware redirect на signin

---

## Остаточне видалення після 30 днів

Файл: `apps/api/src/modules/users/cleanup.service.ts`

`@Cron(EVERY_DAY_AT_3AM)` — перевіряє акаунти де `deletedAt <= (now - 30 days)`. Для кожного:
1. `revokeAllUserTokens()` — очищує Redis
2. `findByIdAndDelete()` — hard-delete з MongoDB

Логує кількість видалених акаунтів.

---

## Magic link purposes

| Purpose | Сценарій | Результат після кліку |
|---------|----------|---------------------|
| `login` | Існуючий юзер без пароля | Вхід -> `/profile` |
| `register` | Новий юзер | Вхід -> `/profile` |
| `reset-password` | Забув пароль | Вхід -> `/profile` |
| `delete-account` | Підтвердження видалення | Деактивація -> екран "Акаунт видалено" -> кнопка "Увійти" |

---

## User schema поля

```
deletedAt: Date | null               // null = активний, Date = деактивований (soft-delete)
accountDeletionRequestedAt: Date | null  // null = не запитував, Date = чекає підтвердження email
```
