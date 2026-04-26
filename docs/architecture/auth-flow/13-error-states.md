# Error States

| Ситуація | UI поведінка | Повідомлення |
|----------|-------------|-------------|
| Невірний пароль | Помилка під полем пароля (signin page) | i18n `auth_page.signin.invalid_credentials` |
| Progressive lockout (429) | Помилка + показ кнопки "Увійти через email" | i18n `auth_page.signin.too_many_attempts` з кількістю хвилин |
| Невалідний/прострочений magic link | Verify page: помилка inline + кнопка "Спробувати знову" | i18n `auth_page.verify.error_heading` + API error code mapping |
| Rate limit magic link (429) | Toast error | i18n `delete_account_modal.rate_limit` або generic |
| Google OAuth помилка | Redirect на `/auth/signin` (callback page catch) | - |
| check-email помилка | Стан `error` з кнопкою повернення | Mapped API error code або generic |
| Сервер недоступний | Стан `error` | i18n `auth_page.signin.error_generic` |
| Невірний пароль (видалення акаунту) | Помилка під полем пароля в модальному вікні | i18n `delete_account_modal.invalid_password` |
| Акаунт деактивовано (пароль) | Signin page: стан `recovery` з датою і кнопками | i18n `auth_page.recovery.*` |
| Акаунт деактивовано (Google) | Callback page: UI відновлення | i18n `auth_page.recovery.*` |
| Password set вже існує | Toast error на profile | Backend: 400 "Password already set" |
| Password change невірний поточний | Toast error на profile | i18n `profile_page.security.password_invalid` |
