# Профіль після magic link

Файли:
- `apps/web/src/app/[locale]/(protected)/profile/page.tsx`
- `apps/web/src/features/profile/ProfileForm.tsx`
- `apps/web/src/features/profile/SecuritySection.tsx`

Після успішного переходу по magic link юзер автентифікується (отримує tokens) і потрапляє на `/profile`.

## Як працює profile page

Profile page приймає query param `?mode=` (`ProfileMode`):

| Mode | Опис |
|------|------|
| `new` | Новий юзер — форма профілю editable, ім'я обов'язкове |
| `set-password` | Встановлення пароля |
| `reset-password` | Скидання пароля |
| `null` (без mode) | Звичайний перегляд з можливістю редагування |

**Важливо:** Verify page (`/auth/verify`) робить redirect на `/profile` без query param для всіх purposes (login, register, reset-password). Тому після magic link завжди `mode=null`.

## Поведінка при mode=null

**ProfileForm:**
- `editable=true` (форма редагується)
- Ім'я завжди обов'язкове
- Два поля: Ім'я та Прізвище (frontend розділяє `profile.name` на частини, зберігає як єдиний рядок)

**SecuritySection:**
- Якщо `hasPassword=false` -> показує форму "Встановити пароль" (необов'язкове)
- Якщо `hasPassword=true` -> показує форму "Змінити пароль" (поточний + новий)

**DangerZone:**
- Показується тільки при `mode=null`
- Кнопка "Видалити акаунт" (див. [Видалення акаунту](./10-account-deletion.md))
