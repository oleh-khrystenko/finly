# User-Facing Message Tone & Style

> Це правило стосується ВСІХ текстів, які бачить кінцевий користувач:
> toast-повідомлення, нотифікації, підтвердження, помилки, placeholder-тексти, email-листи.

## Current Tone

<!-- ======================== TONE VARIABLE ======================== -->
<!-- Зміни значення нижче, щоб глобально переключити стиль проєкту. -->
<!-- Після зміни — онови таблицю прикладів.                         -->

**TONE: classic-polite**

Класичний, ввічливий стиль. Без панібратства, без надлишкової емоційності.

<!-- =============================================================== -->

## Rules (залізобетонні, незалежні від тону)

1. **Звертання на "ви"** (формальне), навіть якщо тон зміниться
2. **Без емодзі в тексті** повідомлень (іконки в UI — окремо)
3. **Лаконічно**: максимум 1-2 речення на повідомлення
4. **Дієслово у минулому часі** для success-підтверджень: "Звіт створено", "Посилання надіслано"
5. **Без знаку оклику** в success-повідомленнях
6. **Однакова структура** для однотипних повідомлень (створення, видалення, оновлення)
7. **i18n**: кожне повідомлення має бути в `messages/uk.json` та `messages/en.json`, ніколи hardcoded. Виняток: текст, що стосується лише одного locale (наприклад, примітка "документ доступний лише англійською" для UK) — hardcoded допустимий, бо переклад на інші мови семантично безглуздий

## Examples (для поточного тону: classic-polite)

| Контекст | Мова | Correct | Wrong |
|----------|------|---------|-------|
| Success (створення) | UK | Звіт успішно створено | Ура! Звіт створено! |
| Success (створення) | EN | Report created successfully | Yay! Report created! |
| Success (видалення) | UK | Запис видалено | Готово, видалили! |
| Success (видалення) | EN | Record deleted | Done, deleted! |
| Success (відправка) | UK | Посилання надіслано на вашу пошту | Лист полетів! |
| Success (відправка) | EN | Link sent to your email | Email is on its way! |
| Error (загальна) | UK | Не вдалося зберегти. Спробуйте пізніше | Ой, щось пішло не так |
| Error (загальна) | EN | Failed to save. Please try again later | Oops, something went wrong |
| Error (валідація) | UK | Введіть коректну email-адресу | Неправильний email!!! |
| Error (валідація) | EN | Please enter a valid email address | Wrong email!!! |
| Confirmation | UK | Ви впевнені, що хочете видалити цей звіт? | Точно видаляємо? |
| Confirmation | EN | Are you sure you want to delete this report? | Delete it for real? |
| Loading | UK | Завантаження... | Зачекай... |
| Loading | EN | Loading... | Hold on... |
| Empty state | UK | Звітів поки немає | Тут пусто :( |
| Empty state | EN | No reports yet | Nothing here :( |

## Patterns для i18n ключів

Повідомлення зберігаються в `messages/{locale}.json` за патерном:

```
"notifications.{entity}.{action}": "Текст повідомлення"
```

Приклади:
- `notifications.report.created` → "Звіт успішно створено"
- `notifications.report.deleted` → "Звіт видалено"
- `notifications.auth.magic_link_sent` → "Посилання надіслано на вашу пошту"
- `errors.generic.save_failed` → "Не вдалося зберегти. Спробуйте пізніше"
- `errors.validation.invalid_email` → "Введіть коректну email-адресу"

## Як змінити тон

1. Зміни значення `TONE:` вище (наприклад, `casual-friendly`, `formal-corporate`)
2. Онови таблицю прикладів відповідно до нового тону
3. Онови `messages/uk.json` та `messages/en.json`
4. Правила з секції "Rules" залишаються незмінними
