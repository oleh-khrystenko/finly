# Зведена таблиця: куди потрапляє юзер після авторизації

| Метод входу | Стан юзера | Redirect після входу |
|------------|------------|---------------------|
| Пароль (Сценарій A) | Існуючий + з паролем | `/profile` |
| Magic link (Сценарій B) | Існуючий + без пароля | `/profile` (verify page) |
| Magic link (Сценарій C) | Новий юзер | `/profile` (verify page) |
| Forgot password | Існуючий + з паролем | `/profile` (verify page) |
| Google OAuth | Новий або існуючий | `/profile` (через callback page) |
| Пароль (деактивований) | Існуючий + deleted | signin page: стан `recovery` |
| Google OAuth (деактивований) | Існуючий + deleted | callback page: UI відновлення |
