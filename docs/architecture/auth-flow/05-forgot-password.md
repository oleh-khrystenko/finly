# Forgot Password

## Флоу

1. Юзер на сторінці авторизації бачить поле пароля (Сценарій A)
2. Натискає "Забув пароль?"
3. Frontend відправляє `POST /api/auth/magic-link/send` з purpose `reset-password`
4. Toast: "Якщо акаунт з цією адресою існує, ми надіслали посилання для зміни пароля"
5. Стан переходить у `magic-link-sent` (показує "Перевірте пошту")

**Важливо:** Frontend завжди показує однаковий success toast і переходить у `magic-link-sent`, навіть якщо backend повернув помилку. Це запобігає user enumeration.

6. Юзер натискає magic link -> verify page -> `POST /api/auth/magic-link/verify`
7. Backend: `findOrCreateByEmail()` -> tokens -> cookie
8. Redirect на `/profile` (без query param `?mode=`)

## На сторінці профілю

Після редіректу юзер потрапляє на profile з `mode=null`. SecuritySection визначає стан за даними юзера:

- Якщо `hasPassword: true` -> показує форму "Змінити пароль" (поточний пароль + новий пароль)
- Якщо `hasPassword: false` -> показує форму "Встановити пароль"

> **Обмеження поточної реалізації:** Verify page не передає `?mode=reset-password` на profile page. Тому юзер з існуючим паролем після forgot password побачить стандартну форму зміни пароля, яка вимагає ввести поточний пароль.

## Email

Шаблон RESET_PASSWORD — "Натисніть кнопку нижче, щоб скинути пароль." Листи на двох мовах (uk, en), визначається за `preferredLang` юзера.
