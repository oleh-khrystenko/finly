# Modular Boundaries

Web (`apps/web`) дотримується Feature-Sliced Design layering. Усі залежності спрямовані лише вниз; вищі шари можуть імпортувати з нижчих, ніколи навпаки.

## Шари (від нижчого до вищого)

```
shared → entities → features → widgets → app
```

| Шар        | Призначення                                                                              | Шлях                     |
| ---------- | ---------------------------------------------------------------------------------------- | ------------------------ |
| `shared`   | Базові примітиви: API client, UI kit, конфіг, lib helpers, ікони, шрифти                 | `apps/web/src/shared/`   |
| `entities` | Модельні стори/типи окремих доменних об'єктів (наприклад, поточний користувач)           | `apps/web/src/entities/` |
| `features` | Юзкейси, що володіють своїм UI/state (auth flows, billing dialogs, profile actions тощо) | `apps/web/src/features/` |
| `widgets`  | Композитні UI-блоки, що збираються з features (header, sheet menu)                       | `apps/web/src/widgets/`  |
| `app`      | Next.js App Router, root providers, overlay registry                                     | `apps/web/src/app/`      |

## Правила

- `shared/` — найнижчий шар, не імпортує з `entities/`, `features/`, `widgets/`, `app/`. Якщо нижчий шар потребує реакції від вищого — використовується інверсія через event bus у `shared/lib/` (див. `authEvents`).
- Глобального `src/stores/` шару не існує. Кожен store живе всередині slice (entity / feature / widget), що ним володіє.
- Cross-slice imperative-дії, що не вкладаються в layering (рідко), теж робляться через event bus у `shared/lib/`, а не прямим імпортом.

## Enforcement (ESLint)

Правила в `apps/web/eslint.config.mjs`:

- `NO_GLOBAL_STORES_LAYER` — забороняє будь-який імпорт з `@/stores/**` (static і dynamic).
- `SHARED_MUST_NOT_IMPORT_HIGHER_LAYERS` — забороняє `shared/` імпортувати з `entities/`, `features/`, `widgets/`, `app/` (static і dynamic).

API (`apps/api`) дотримується стандартного NestJS-моделювання: модулі реєструються в `AppModule`, шарова межа задається через `imports`/`exports` модуля. Жодних специфічних шарових ESLint правил для бекенду немає.
