# Manual E2E Test Plan: повний auth flow

> Покрокові сценарії для ручного тестування. Покриває ВСЮ авторизацію: існуючу (Google OAuth, Magic Link, Token Lifecycle) та нову (Password Auth, Progressive Disclosure, Profile, Account Deletion).

Дата: 2026-02-24

---

## Підготовка

- DevTools відкриті (вкладки: `Network`, `Application -> Cookies`, `Console`)
- У `Network` увімкнути `Preserve log`
- Базовий locale для тестів: `uk` (default)
- Response format: `{ data: { ... } }` для success, `{ error: { code, message } }` для errors
- API має глобальний префікс `/api`
- Маршрути локалізовані (`/{locale}/...`)

### Для тестів Token Lifecycle (секція C)

Тимчасово змінити TTL:
- `apps/api/src/modules/auth/auth.service.ts`: access token: `'1m'`, refresh token: `'2m'`
- Після тестів повернути дефолт: `'1h'` і `'7d'`

---

## A. Auth Flows — Google OAuth

### Тест A1: Google OAuth — повний flow

**Мета:** Перевірити авторизацію через Google

**Precondition:** Не авторизований (немає cookie `bid_refresh`)

**Steps:**
1. Перейти на `/{locale}/auth/signin`
2. Натиснути `Продовжити з Google`
3. Пройти Google consent screen
4. Дочекатись redirect

**Expected:**
- [ ] Browser переходить на `accounts.google.com`
- [ ] Після consent API встановлює `bid_refresh` cookie → redirect на `/auth/callback`
- [ ] Network: `POST /api/auth/refresh` → `200`
- [ ] Network: `GET /api/users/me` → `200`
- [ ] Redirect на `/{locale}/profile`
- [ ] `Application -> Cookies`: `bid_refresh` (httpOnly, path=/, sameSite=lax)
- [ ] Header показує ім'я/email, avatar, кредити

---

### Тест A2: Google OAuth — відмова consent

**Precondition:** Не авторизований

**Steps:**
1. Натиснути `Продовжити з Google`
2. На consent screen натиснути "Відхилити"

**Expected:**
- [ ] `bid_refresh` cookie НЕ встановлено
- [ ] Redirect на `/{locale}/auth/signin`

---

## B. Auth Flows — Progressive Disclosure

### Тест B1: Progressive disclosure — Сценарій A (юзер з паролем)

**Мета:** Email → password form → login

**Precondition:** Існуючий юзер з паролем

**Steps:**
1. Перейти на `/{locale}/auth/signin`
2. Ввести email, натиснути "Продовжити"
3. Побачити password form

**Expected:**
- [ ] Network: `POST /api/auth/check-email` → `200`, `{ hasPassword: true, isNewUser: false }`
- [ ] UI: email з кнопкою "Змінити" (readonly) + password field з toggle show/hide + "Забули пароль?" + "Увійти"
- [ ] Password field: натиснути іконку ока → пароль видимий, повторно → прихований
- [ ] "Змінити" біля email → повернення до кроку email

---

### Тест B2: Progressive disclosure — Сценарій B (існуючий юзер без пароля)

**Мета:** Email → "Перевірте пошту" → magic link

**Precondition:** Існуючий юзер створений через Google OAuth (без пароля)

**Steps:**
1. Ввести email юзера, натиснути "Продовжити"

**Expected:**
- [ ] Network: `POST /api/auth/check-email` → `200`, `{ hasPassword: false, isNewUser: false }`
- [ ] Network: `POST /api/auth/magic-link/send` → `200` (purpose: `login`)
- [ ] UI: "Перевірте пошту" з email юзера + "Інший email"
- [ ] Email отримано з subject "Вхід до CyanShip" (uk) або "Sign in to CyanShip" (en)

---

### Тест B3: Progressive disclosure — Сценарій C (новий юзер)

**Мета:** Email → "Перевірте пошту" → magic link → реєстрація

**Precondition:** Email ще не існує в системі

**Steps:**
1. Ввести новий email, натиснути "Продовжити"

**Expected:**
- [ ] Network: `POST /api/auth/check-email` → `200`, `{ hasPassword: false, isNewUser: true }`
- [ ] Network: `POST /api/auth/magic-link/send` → `200` (purpose: `register`)
- [ ] UI: "Перевірте пошту" (ідентичний Сценарію B)
- [ ] Email отримано з subject "Ласкаво просимо до CyanShip" (uk) або "Welcome to CyanShip" (en)

---

### Тест B4: "Змінити email" на кроці пароля

**Precondition:** Сценарій A (password form відкрита)

**Steps:**
1. На password form натиснути "Змінити" біля email

**Expected:**
- [ ] UI повертається до кроку вводу email
- [ ] Поле email порожнє або з попереднім значенням (editable)
- [ ] Password field зникає

---

## C. Password Auth

### Тест C1: Успішний вхід з паролем

**Precondition:** Юзер з паролем

**Steps:**
1. Email → "Продовжити" → password form
2. Ввести вірний пароль, натиснути "Увійти"

**Expected:**
- [ ] Network: `POST /api/auth/login/password` → `200`
- [ ] `bid_refresh` cookie встановлено
- [ ] Redirect на `/{locale}/check`
- [ ] Header показує профіль

---

### Тест C2: Невірний пароль

**Steps:**
1. Password form → ввести невірний пароль → "Увійти"

**Expected:**
- [ ] Network: `POST /api/auth/login/password` → `401`
- [ ] Поле пароля підсвічується червоним
- [ ] Toast/повідомлення: "Невірний email або пароль"
- [ ] Залишається на password form

---

### Тест C3: Progressive lockout — 5 спроб (1 хв)

**Steps:**
1. 5 разів ввести невірний пароль

**Expected:**
- [ ] Перші 4 → `401` з повідомленням "Невірний email або пароль"
- [ ] 5-й → `429`
- [ ] UI: "Забагато спроб. Спробуйте через 1 хвилин або скористайтесь посиланням «Забули пароль?»"
- [ ] Redis: key `login_attempts:{ip}:{email}` = 5

---

### Тест C4: Progressive lockout — 10 спроб (5 хв)

**Steps:**
1. Почекати 1+ хв (скид блоку після C3) або використати новий IP
2. 10 разів ввести невірний пароль

**Expected:**
- [ ] 10-й → `429` з блоком 5 хвилин

---

### Тест C5: Progressive lockout — різні IP не блокують одне одного

**Steps:**
1. З IP1: 5 невірних спроб → `429`
2. З IP2 (або Incognito/інший прокси): ввести того ж email

**Expected:**
- [ ] IP2: `POST /api/auth/check-email` → `200` (не заблоковано)
- [ ] IP2: `POST /api/auth/login/password` → працює (свій лічильник)

---

### Тест C6: Успішний вхід скидає лічильник

**Steps:**
1. 3 невірних спроби
2. 1 вірна спроба
3. Ще 4 невірних спроби

**Expected:**
- [ ] Крок 2: login → `200`, лічильник скидається
- [ ] Крок 3: перші 4 невірні → `401` (ще не дійшли до 5)

---

## D. Forgot Password

### Тест D1: Forgot password — повний flow

**Precondition:** Юзер з паролем

**Steps:**
1. Email → password form → "Забули пароль?"
2. Перевірити toast
3. Відкрити email → клікнути посилання
4. На сторінці профілю ввести новий пароль → зберегти

**Expected:**
- [ ] Network: `POST /api/auth/magic-link/send` → `200` (purpose: `reset-password`)
- [ ] Toast: "Якщо акаунт з цією адресою існує, ми надіслали посилання для зміни пароля"
- [ ] Email subject: "Скидання пароля" (uk)
- [ ] Verify → redirect на `/profile?mode=reset-password`
- [ ] Profile: password field з show/hide toggle, **обов'язковий** (інші поля view-only)
- [ ] Після збереження: `revokeAllUserTokens()` — інші пристрої відключено
- [ ] Наступний вхід з новим паролем → `200`
- [ ] Старий пароль → `401`

---

### Тест D2: Forgot password — неіснуючий email

**Steps:**
1. Ввести email що не існує → password form не з'явиться (isNewUser=true → magic link)
2. АБО: напряму викликати API `sendMagicLink(email, 'reset-password')`

**Expected:**
- [ ] Backend повертає `200` (той самий response що й при існуючому email)
- [ ] Toast: "Якщо акаунт з цією адресою існує, ми надіслали посилання для зміни пароля" (ідентичний D1)
- [ ] Email НЕ надсилається (email не існує)

---

## E. Magic Link

### Тест E1: Magic link — новий юзер → профіль

**Steps:**
1. Сценарій C → отримати email → клікнути посилання

**Expected:**
- [ ] Network: `POST /api/auth/magic-link/verify` → `200`, purpose: `register`
- [ ] Redirect на `/profile?mode=new`
- [ ] Профіль: ім'я (required), прізвище, пароль (optional, show/hide toggle)
- [ ] Після заповнення та збереження → redirect на `/check`

---

### Тест E2: Magic link — існуючий юзер → профіль

**Steps:**
1. Сценарій B → email → клік

**Expected:**
- [ ] Verify → purpose: `login`
- [ ] Redirect на `/profile?mode=set-password`
- [ ] Профіль: поля view-only + password (optional, show/hide toggle)

---

### Тест E3: Magic link — невалідний/використаний token

**Steps:**
1. Відкрити `/{locale}/auth/verify?token=fakeinvalidtoken123`

**Expected:**
- [ ] `POST /api/auth/magic-link/verify` → `401`
- [ ] UI: "Посилання недійсне або прострочене"
- [ ] Кнопка "Спробувати знову" → `/{locale}/auth/signin`

---

### Тест E4: Magic link — verify без token

**Steps:**
1. Відкрити `/{locale}/auth/verify` (без `?token=`)

**Expected:**
- [ ] Жодного запиту до API
- [ ] Одразу error UI
- [ ] Кнопка → signin

---

### Тест E5: Magic link — прострочений (>15 хв)

**Steps:**
1. Надіслати magic link
2. Почекати 16+ хвилин
3. Клікнути

**Expected:**
- [ ] `POST /api/auth/magic-link/verify` → `401`
- [ ] UI: помилка

---

### Тест E6: Magic link — one-time use

**Steps:**
1. Надіслати magic link → клік → успіх
2. Logout
3. Відкрити той самий link повторно

**Expected:**
- [ ] Крок 1: verify → `200`
- [ ] Крок 3: verify → `401` (token видалено з Redis)

---

### Тест E7: Magic link — rate limit (3/15хв)

**Steps:**
1. Надіслати magic link 3 рази (перезавантажувати сторінку між запитами)
2. Надіслати 4-й раз

**Expected:**
- [ ] 1-3: `POST /api/auth/magic-link/send` → `200`
- [ ] 4-й: → `429`

---

### Тест E8: Magic link — anti-spam dedup

**Steps:**
1. Надіслати magic link
2. Протягом 60 секунд надіслати ще раз (той самий email, той самий purpose)

**Expected:**
- [ ] Обидва запити → `200`
- [ ] Але email надіслано тільки 1 раз (перевірити inbox)
- [ ] Redis: `magic_dedup:{email}:{purpose}` існує

---

## F. Token Lifecycle

> **Увага:** Для тестів F1-F5 тимчасово змінити TTL: access=1m, refresh=2m.

### Тест F1: Access token expiry + refresh

**Precondition:** Авторизований, access TTL=1m

**Steps:**
1. Зафіксувати `accessToken` з Network
2. Почекати 1+ хв
3. Console: `fetch('/api/users/me', { headers: { Authorization: 'Bearer <old>' } })`
4. Console: `fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })`
5. Використати новий accessToken

**Expected:**
- [ ] Крок 3: `GET /api/users/me` → `401`
- [ ] Крок 4: `POST /api/auth/refresh` → `200`, новий `accessToken`
- [ ] Крок 5: `GET /api/users/me` → `200`
- [ ] `bid_refresh` cookie оновлюється (rotation)

---

### Тест F2: Refresh token expiry

**Precondition:** access=1m, refresh=2m

**Steps:**
1. Авторизуватись
2. Почекати 2+ хв
3. F5 на `/{locale}/check`

**Expected:**
- [ ] `POST /api/auth/refresh` → `401`
- [ ] `bid_refresh` cookie видалено
- [ ] Redirect на `/{locale}/auth/signin`

---

### Тест F3: Token rotation — cookie змінюється

**Steps:**
1. Зафіксувати `bid_refresh` (`cookie_old`)
2. F5 (тригерить AuthInitializer → refresh)
3. Зафіксувати нову `bid_refresh` (`cookie_new`)

**Expected:**
- [ ] `cookie_new` != `cookie_old`
- [ ] `POST /api/auth/refresh` → `200`

---

### Тест F4: Token rotation — reuse detection

**Steps:**
1. Скопіювати `bid_refresh` (`cookie_old`)
2. F5 → нова cookie (`cookie_new`)
3. Почекати 11+ сек (grace period 10s)
4. Вручну підставити `cookie_old` в `Application -> Cookies`
5. F5

**Expected:**
- [ ] `POST /api/auth/refresh` → `401` ("Refresh token reuse detected")
- [ ] `revokeAllUserTokens()` — ВСІ токени юзера видалено (включно з `cookie_new`)
- [ ] Потрібен повний повторний логін

---

### Тест F5: Token rotation — grace period (concurrent tabs)

**Steps:**
1. Відкрити два таби на `/{locale}/check`
2. В обох — однакова cookie
3. Таб A: F5 (refresh)
4. Таб B: F5 протягом 10 сек після кроку 3

**Expected:**
- [ ] Таб A: `POST /api/auth/refresh` → `200`
- [ ] Таб B: `POST /api/auth/refresh` → `200` (grace period — Redis key `rotated`)

**Negative branch (окремий прогін):**
5. Таб B: F5 через 11+ сек

- [ ] Таб B: → `401` (reuse detected)

---

## G. Route Protection

### Тест G1: Protected routes — неавторизований

**Precondition:** Немає `bid_refresh`

**Steps:**
1. Відкрити `/{locale}/check`
2. Відкрити `/{locale}/profile`

**Expected:**
- [ ] Middleware redirect на `/{locale}/auth/signin` (server-side)
- [ ] Protected контент не рендериться

---

### Тест G2: Auth route — авторизований

**Precondition:** Є `bid_refresh`

**Steps:**
1. Відкрити `/{locale}/auth/signin`

**Expected:**
- [ ] Middleware redirect на `/{locale}/check`
- [ ] Signin форма не рендериться

---

### Тест G3: Публічні сторінки

**Не авторизований:**
- [ ] `/` або `/{locale}` — landing доступний
- [ ] `/{locale}/auth/signin` — доступний
- [ ] Header: кнопка "Увійти"

**Авторизований:**
- [ ] `/{locale}` — landing доступний
- [ ] Header: профіль юзера

---

### Тест G4: Auth utility routes (verify/callback)

**Precondition:** Не авторизований

**Steps:**
1. Відкрити `/{locale}/auth/verify?token=test123`
2. Відкрити `/{locale}/auth/callback`

**Expected:**
- [ ] `/auth/verify` — рендериться (показує error для невалідного token)
- [ ] `/auth/callback` — рендериться, fail → redirect на signin
- [ ] Ці шляхи НЕ блокуються middleware

---

## H. Session Management

### Тест H1: Logout — повний flow

**Precondition:** Авторизований

**Steps:**
1. Натиснути іконку logout в Header
2. Спробувати перейти на `/{locale}/check`

**Expected:**
- [ ] Network: `POST /api/auth/logout` → `200`
- [ ] `bid_refresh` cookie видалено
- [ ] Hard navigation на `/{locale}` (landing)
- [ ] `/{locale}/check` → redirect на signin

---

### Тест H2: Logout — старий token + reuse detection

**Steps:**
1. Скопіювати `bid_refresh` (`cookie_old`)
2. Logout
3. Залогінитись знову (нова сесія)
4. Підставити `cookie_old` в Cookies
5. F5

**Expected:**
- [ ] `POST /api/auth/refresh` з `cookie_old` → `401`
- [ ] `revokeAllUserTokens()` — нова сесія також невалідна
- [ ] Потрібен повторний логін

---

### Тест H3: Session persistence — F5

**Precondition:** Авторизований

**Steps:**
1. F5 на `/{locale}/check`

**Expected:**
- [ ] `POST /api/auth/refresh` → `200`
- [ ] `GET /api/users/me` → `200`
- [ ] Header: спочатку skeleton → профіль
- [ ] Cookie ротується

---

### Тест H4: Concurrent refresh dedup

**Статус:** `BLOCKED` для ручного тестування (потрібна debug-кнопка або automated test).

**Поведінка (для перевірки):**
- `refreshPromise` shared між interceptors — лише один `POST /api/auth/refresh`
- Другий 401-запит чекає на результат першого refresh

---

## I. Profile

### Тест I1: Новий юзер (mode=new)

**Precondition:** Magic link verify з purpose=register

**Steps:**
1. Після verify → redirect на `/profile?mode=new`
2. Заповнити ім'я (обов'язкове), прізвище (optional), пароль (optional)
3. Зберегти

**Expected:**
- [ ] Ім'я: required — без нього форма не submit
- [ ] Пароль: show/hide toggle, optional
- [ ] Network: `PATCH /api/users/me` → `200` (якщо пароль — ще `POST /auth/password/set`)
- [ ] Toast: "Профіль оновлено"
- [ ] Redirect на `/check`

---

### Тест I2: Set password (mode=set-password)

**Precondition:** Magic link verify з purpose=login

**Steps:**
1. Після verify → `/profile?mode=set-password`
2. Ввести пароль (optional) з show/hide toggle
3. Зберегти

**Expected:**
- [ ] Password field: optional, з toggle
- [ ] Інші поля: view-only
- [ ] Якщо пароль введено: `POST /auth/password/set` → `200`

---

### Тест I3: Reset password (mode=reset-password)

**Precondition:** Magic link verify з purpose=reset-password

**Steps:**
1. `/profile?mode=reset-password`
2. Ввести новий пароль (обов'язковий)
3. Зберегти

**Expected:**
- [ ] Password field: **required**, show/hide toggle
- [ ] Інші поля: view-only
- [ ] Network: `POST /auth/password/set` або `POST /auth/password/change` → `200`
- [ ] Toast: "Пароль змінено. Інші пристрої було відключено"
- [ ] Інші сесії ревоковані

---

### Тест I4: Default profile — change password

**Precondition:** Авторизований, юзер з паролем

**Steps:**
1. Перейти на `/profile` (default mode)
2. Security → "Змінити пароль"
3. Ввести поточний пароль + новий (обидва з show/hide toggle)
4. Зберегти

**Expected:**
- [ ] Network: `POST /api/auth/password/change` → `200` + новий `accessToken`
- [ ] Cookie оновлюється (нова пара токенів)
- [ ] Toast: "Пароль змінено. Інші пристрої було відключено"
- [ ] На іншому пристрої: наступний refresh → `401` → redirect на signin

---

### Тест I5: Default profile — update profile

**Steps:**
1. Змінити ім'я → зберегти
2. Змінити мову → зберегти

**Expected:**
- [ ] Network: `PATCH /api/users/me` → `200`
- [ ] Toast: "Профіль оновлено"
- [ ] Зміна мови → UI перемикається

---

## J. Account Deletion

### Тест J1: Видалення — юзер з паролем

**Precondition:** Юзер з паролем, авторизований

**Steps:**
1. Profile → Danger Zone → "Видалити акаунт"
2. Modal: ввести пароль → "Видалити акаунт"

**Expected:**
- [ ] Крок 1: `POST /api/users/account/delete` → `200`, `{ requiresPassword: true }`
- [ ] Крок 2: `POST /api/users/account/delete/confirm` → `200`
- [ ] `bid_refresh` cookie видалено
- [ ] Email: confirmation з датою остаточного видалення (30 днів)
- [ ] Redirect на `/{locale}/auth/signin`
- [ ] Toast: "Акаунт деактивовано"

---

### Тест J2: Видалення — юзер без пароля

**Precondition:** Юзер без пароля

**Steps:**
1. Profile → Danger Zone → "Видалити акаунт"
2. Toast: "Посилання для підтвердження надіслано на пошту"
3. Відкрити email → клікнути

**Expected:**
- [ ] Крок 1: `POST /api/users/account/delete` → `200`, `{ requiresMagicLink: true }`
- [ ] Крок 3: verify → purpose=delete-account → soft delete + revoke + email
- [ ] Redirect на signin + toast

---

### Тест J3: Видалення — невірний пароль у modal

**Steps:**
1. Modal → ввести невірний пароль → підтвердити

**Expected:**
- [ ] `POST /api/users/account/delete/confirm` → `401`
- [ ] Modal: "Невірний пароль" (поле підсвічується)
- [ ] Акаунт НЕ видалено

---

### Тест J4: Account recovery — login після deletion

**Precondition:** Акаунт деактивовано (deletedAt != null)

**Steps:**
1. Ввести email → password form → вірний пароль

**Expected:**
- [ ] `POST /api/auth/login/password` → `200`, `{ accountDeleted: true, deletedAt: ... }`
- [ ] UI: Recovery screen — "Акаунт деактивовано", дата видалення, кількість днів
- [ ] "Відновити акаунт" → `POST /api/users/account/restore` → `200`
- [ ] Toast: "Акаунт відновлено!"
- [ ] Redirect на `/check` — normal app

---

### Тест J5: Account recovery — відмова відновлення

**Precondition:** Акаунт деактивовано

**Steps:**
1. Recovery screen → "Вийти"

**Expected:**
- [ ] Redirect на `/{locale}/auth/signin`
- [ ] Акаунт залишається деактивованим

---

### Тест J6: Деактивований акаунт — email зайнятий

**Steps:**
1. Деактивувати акаунт user@test.com
2. Спробувати зареєструватися з тим самим email

**Expected:**
- [ ] `POST /api/auth/check-email` → `{ hasPassword: ..., isNewUser: false }` (не true)
- [ ] Акаунт існує, email зайнятий

---

## K. Email Templates

### Тест K1: Register email (UK + EN)

**Steps:**
1. Зареєструвати нового юзера (preferredLang=uk)
2. Зареєструвати нового юзера (preferredLang=en)

**Expected:**
- [ ] UK: subject "Ласкаво просимо до CyanShip", CTA "Завершити реєстрацію"
- [ ] EN: subject "Welcome to CyanShip", CTA "Complete Registration"
- [ ] HTML: CyanShip брендинг, лінк з token, "Посилання дійсне 15 хвилин"

---

### Тест K2: Login email (UK + EN)

- [ ] UK: subject "Вхід до CyanShip", CTA "Увійти"
- [ ] EN: subject "Sign in to CyanShip", CTA "Sign In"

---

### Тест K3: Reset password email (UK + EN)

- [ ] UK: subject "Скидання пароля", CTA "Скинути пароль"
- [ ] EN: subject "Reset Your Password", CTA "Reset Password"

---

### Тест K4: Delete account email (UK + EN)

- [ ] UK: subject "Підтвердження видалення акаунту", CTA "Підтвердити видалення"
- [ ] EN: subject "Confirm Account Deletion", CTA "Confirm Deletion"
- [ ] Містить попередження про 30-денний grace period

---

### Тест K5: Deletion confirmation email

- [ ] Надсилається після деактивації акаунту
- [ ] Містить дату остаточного видалення
- [ ] Містить інструкцію відновлення
- [ ] CTA: посилання на сторінку авторизації

---

## L. Security — cross-cutting

### Тест L1: check-email rate limit (10 req/min per-IP)

**Steps:**
1. 10 разів `POST /api/auth/check-email` з одного IP
2. 11-й запит

**Expected:**
- [ ] 1-10: → `200`
- [ ] 11-й: → `429`

---

### Тест L2: Anti-spam dedup — подвійний клік

**Steps:**
1. Натиснути "Продовжити" (email submit)
2. Протягом 60 сек натиснути ще раз (перезавантажити сторінку)

**Expected:**
- [ ] Обидва → `200`
- [ ] Але лише 1 email в inbox

---

### Тест L3: Session invalidation після зміни пароля

**Steps:**
1. Авторизуватись на двох пристроях (2 таби = 2 різні refresh tokens)
2. На пристрої A: змінити пароль
3. На пристрої B: спробувати будь-яку дію

**Expected:**
- [ ] Пристрій A: отримує новий accessToken + refreshToken
- [ ] Пристрій B: наступний `POST /api/auth/refresh` → `401`
- [ ] Пристрій B: redirect на signin

---

### Тест L4: Cookie attributes

**Steps:**
1. Авторизуватись → перевірити `bid_refresh` в DevTools

**Expected:**
- [ ] `httpOnly: true` (не доступна через JS)
- [ ] `path: /`
- [ ] `sameSite: lax`
- [ ] `secure: true` (тільки в production/HTTPS)
- [ ] `maxAge: ~7 days`

---

### Тест L5: i18n — всі нові ключі

**Steps:**
1. Пройти flows в UK locale
2. Перемкнути на EN → пройти ті ж flows

**Expected:**
- [ ] Всі toast повідомлення перекладені
- [ ] Password form: label, placeholder, errors — перекладені
- [ ] Profile page: всі секції перекладені
- [ ] Recovery screen: перекладена
- [ ] Delete modal: перекладена

---

## Зведений чеклист

| # | Тест | Категорія | Статус |
|---|------|-----------|--------|
| A1 | Google OAuth flow | Auth Flow | [ ] |
| A2 | Google OAuth — відмова | Auth Flow | [ ] |
| B1 | Progressive disclosure — Сценарій A | Auth Flow | [ ] |
| B2 | Progressive disclosure — Сценарій B | Auth Flow | [ ] |
| B3 | Progressive disclosure — Сценарій C | Auth Flow | [ ] |
| B4 | "Змінити email" | Auth Flow | [ ] |
| C1 | Успішний вхід з паролем | Password Auth | [ ] |
| C2 | Невірний пароль | Password Auth | [ ] |
| C3 | Progressive lockout — 5 спроб | Password Auth | [ ] |
| C4 | Progressive lockout — 10 спроб | Password Auth | [ ] |
| C5 | Різні IP не блокують | Password Auth | [ ] |
| C6 | Успішний вхід скидає лічильник | Password Auth | [ ] |
| D1 | Forgot password — повний flow | Forgot Password | [ ] |
| D2 | Forgot password — неіснуючий email | Forgot Password | [ ] |
| E1 | Magic link — новий юзер → профіль | Magic Link | [ ] |
| E2 | Magic link — існуючий юзер → профіль | Magic Link | [ ] |
| E3 | Magic link — невалідний token | Magic Link | [ ] |
| E4 | Magic link — verify без token | Magic Link | [ ] |
| E5 | Magic link — прострочений | Magic Link | [ ] |
| E6 | Magic link — one-time use | Magic Link | [ ] |
| E7 | Magic link — rate limit | Magic Link | [ ] |
| E8 | Magic link — anti-spam dedup | Magic Link | [ ] |
| F1 | Access token expiry + refresh | Token Lifecycle | [ ] |
| F2 | Refresh token expiry | Token Lifecycle | [ ] |
| F3 | Token rotation — cookie | Token Lifecycle | [ ] |
| F4 | Token rotation — reuse detection | Token Lifecycle | [ ] |
| F5 | Token rotation — grace period | Token Lifecycle | [ ] |
| G1 | Protected routes (unauth) | Route Protection | [ ] |
| G2 | Auth route (auth user) | Route Protection | [ ] |
| G3 | Public pages | Route Protection | [ ] |
| G4 | Auth utility routes | Route Protection | [ ] |
| H1 | Logout flow | Session Management | [ ] |
| H2 | Logout — token invalidation | Session Management | [ ] |
| H3 | Session persistence (F5) | Session Management | [ ] |
| H4 | Concurrent refresh dedup | Session Management | [BLOCKED] |
| I1 | Profile — новий юзер (mode=new) | Profile | [ ] |
| I2 | Profile — set password | Profile | [ ] |
| I3 | Profile — reset password | Profile | [ ] |
| I4 | Profile — change password | Profile | [ ] |
| I5 | Profile — delete password | Profile | [ ] |
| I6 | Profile — update profile | Profile | [ ] |
| J1 | Deletion — з паролем | Account Deletion | [ ] |
| J2 | Deletion — без пароля | Account Deletion | [ ] |
| J3 | Deletion — невірний пароль | Account Deletion | [ ] |
| J4 | Recovery — login після deletion | Account Deletion | [ ] |
| J5 | Recovery — відмова відновлення | Account Deletion | [ ] |
| J6 | Deleted account — email зайнятий | Account Deletion | [ ] |
| K1 | Register email (UK + EN) | Email Templates | [ ] |
| K2 | Login email (UK + EN) | Email Templates | [ ] |
| K3 | Reset password email (UK + EN) | Email Templates | [ ] |
| K4 | Delete account email (UK + EN) | Email Templates | [ ] |
| K5 | Deletion confirmation email | Email Templates | [ ] |
| L1 | check-email rate limit | Security | [ ] |
| L2 | Anti-spam dedup | Security | [ ] |
| L3 | Session invalidation | Security | [ ] |
| L4 | Cookie attributes | Security | [ ] |
| L5 | i18n — всі ключі | Security | [ ] |

---

## Після тестування — повернути TTL

Після завершення секції C (Token Lifecycle) відновити production-значення у `apps/api/src/modules/auth/auth.service.ts`:

| Що | Тестове | Production |
|----|---------|------------|
| `REFRESH_TOKEN_TTL` | `2 * 60` | `7 * 24 * 60 * 60` |
| `accessToken expiresIn` | `'1m'` | `'1h'` |
| `refreshToken expiresIn` | `'2m'` | `'7d'` |

**Total: 52 тести** (51 active + 1 blocked)
