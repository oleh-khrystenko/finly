# Account Linking

Файл: `apps/api/src/modules/users/users.service.ts` (findOrCreateByGoogle)

## Правило

Один email = один акаунт. Провайдер не створює окремий акаунт.

## Сценарії

| Перша реєстрація | Друга дія | Результат |
|------------------|-----------|-----------|
| Google (user@gmail.com) | Email вхід user@gmail.com | Той самий акаунт, magic link для входу (пароля немає) |
| Magic link (user@gmail.com) | Google OAuth з user@gmail.com | Той самий акаунт, Google provider додається до акаунту, заповнюються пусті name/avatar |
| Email + пароль (user@gmail.com) | Google OAuth з user@gmail.com | Той самий акаунт, Google provider додається, пароль зберігається |

## Реалізація в findOrCreateByGoogle

Якщо юзер з таким email вже існує:
1. Оновлюється `lastLoginAt`
2. Якщо `provider` відсутній — додається `{ name: 'google', id: providerId }`
3. Якщо `profile.name` порожній — заповнюється з Google `displayName`
4. Якщо `profile.avatar` порожній — заповнюється з Google `photos`
