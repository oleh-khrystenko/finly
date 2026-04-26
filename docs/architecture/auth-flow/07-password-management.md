# Управління паролем у профілі

Файл: `apps/web/src/features/profile/SecuritySection.tsx`

На сторінці профілю є секція "Безпека" (SecuritySection):

## Юзер без пароля (`hasPassword=false`)

- Показується форма "Встановити пароль"
- Одне поле: новий пароль (з toggle show/hide)
- Endpoint: `POST /api/auth/password/set`
- Після збереження: toast success, оновлення store через `getMe()`

## Юзер з паролем (`hasPassword=true`)

- Показується форма "Змінити пароль"
- Два поля: поточний пароль + новий пароль (з toggle show/hide)
- Endpoint: `POST /api/auth/password/change`
- Після збереження: backend ревокує всі refresh tokens (`revokeAllUserTokens()`), видає нову пару tokens для поточної сесії
