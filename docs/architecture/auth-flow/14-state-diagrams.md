# Діаграма станів

## Signin page — state machine

```
                        ┌──────────────┐
                        │    email     │
                        │ (email поле  │
                        │ + Google)    │
                        └──────┬───────┘
                               │
                        ввів email +
                        натиснув "Продовжити"
                               │
                        ┌──────▼───────┐
                        │   loading    │
                        │  (check-     │
                        │   email)     │
                        └──────┬───────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
       ┌──────▼──────┐ ┌──────▼──────┐ ┌───────▼──────┐
       │  Сценарій A │ │ Сценарій B  │ │  Сценарій C  │
       │  hasPassword │ │ !hasPassword│ │  isNewUser   │
       │  = true     │ │ !isNewUser  │ │              │
       └──────┬──────┘ └──────┬──────┘ └───────┬──────┘
              │               │                │
       стан: password   sendMagicLink     sendMagicLink
              │          (login)           (register)
              │               │                │
      ┌───────▼───────┐      │                │
      │  password     │      │                │
      │ [Забув пароль?│      │                │
      │  Змінити]     │      │                │
      └───┬───────┬───┘      │                │
          │       │          │                │
      вірний  невірний       │                │
          │       │          │                │
   ┌──────▼──┐  помилка     │                │
   │ getMe() │  під полем   │                │
   │ /profile│              │                │
   └─────────┘              │                │
                     ┌──────▼────────────────▼──────┐
                     │      magic-link-sent         │
                     │   "Перевірте пошту"           │
                     │   <- Інший email              │
                     └──────────────────────────────┘
```

## Verify page

```
  GET /auth/verify?token=XXX
       │
  POST /auth/magic-link/verify
       │
  ┌────▼────────────┐
  │ purpose?        │
  └──┬──────┬───┬───┘
     │      │   │
  login  register  reset-password
     │      │   │
     └──────┼───┘
            │
     getMe() + setUser
     redirect /profile
                        delete-account
                            │
                     softDelete + revoke
                            │
                     екран "Акаунт видалено"
                     кнопка -> /auth/signin
```

## Відновлення деактивованого акаунту

```
  Деактивований акаунт
       │
  ┌────▼─────────────┐
  │ Метод входу?     │
  └──┬──────────┬────┘
     │          │
  Пароль     Google OAuth
     │          │
  signin page  callback page
  стан:        ?account_deleted
  recovery     =true
     │          │
  ┌──▼──────────▼───────┐
  │ UI відновлення:     │
  │ "Відновити акаунт"  │
  │ "Вийти"             │
  └──┬──────────┬───────┘
   Так         Ні
     │          │
  POST /users/  вийти зі
  account/      системи
  restore
     │
  /profile
```
