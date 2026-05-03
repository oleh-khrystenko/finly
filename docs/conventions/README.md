# Project Conventions

Єдине джерело правил та конвенцій для всіх AI-агентів та розробників.

Агент-специфічні файли (`CLAUDE.md`, `AGENTS.md`) посилаються на ці правила —
**не дублюй** їх в інших місцях.

## Index

| Конвенція | Файл | Опис |
|-----------|------|------|
| Tone & Style | [tone.md](tone.md) | Тон та стиль user-facing повідомлень |
| Fail Fast & Env Sync | [fail-fast.md](fail-fast.md) | Політика обов'язкових env vars + синхронізація між env.ts, .env та .env.example |
| Modular Boundaries | [modular-boundaries.md](modular-boundaries.md) | FSD layering для web, ESLint guardrails |
| UI Primitives | [ui-primitives.md](ui-primitives.md) | Заборона нативних HTML-елементів, єдиний набір Ui-компонентів |
| Design Tokens | [design-tokens.md](design-tokens.md) | Заборона хардкоджених кольорів/шрифтів, використання дизайн-токенів |
| Overlays | [overlays.md](overlays.md) | Модалки, sheets, confirm dialogs — примітиви, Zustand store, layout mount |
| Responsive & Mobile-First | [responsive.md](responsive.md) | Усі сторінки адаптивні (mobile + tablet + desktop), mobile-first як залізобетонне правило |

## Як додати нове правило

1. Створи файл `docs/conventions/<rule-name>.md`
2. Додай рядок в таблицю Index вище
3. Правило автоматично підхоплюється через посилання в `CLAUDE.md` / `AGENTS.md`
