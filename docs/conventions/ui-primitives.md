# UI Primitives Policy

> Проєкт використовує єдиний набір UI-примітивів (`apps/web/src/shared/ui/`).
> Прямий рендер нативних HTML-елементів, які мають Ui-обгортку, **заборонений** за межами `shared/ui/`.

## Принцип

```
Feature / Page / Widget code
        |
        v
   shared/ui/Ui*       <-- єдина точка контакту з DOM-примітивами
        |
        v
   Native HTML / Headless UI / Next.js Link
```

Ui-компоненти інкапсулюють:

- **Візуальні варіанти** (variant, size) -- єдине джерело дизайн-токенів
- **Accessibility** (aria-атрибути, keyboard navigation, focus management)
- **Поліморфізм** (button / link / anchor в одному API -- UiButton)
- **Консистентність** (disabled state, transition, cursor) across всього застосунку

Код за межами `shared/ui/` працює виключно з Ui-компонентами і ніколи не рендерить їхні нативні аналоги напряму.

## Поточний реєстр примітивів

| Ui-компонент       | Замінює нативний елемент                                                 | Варіанти                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UiButton`         | `<button>`, `<a>`, Next.js `<Link>`                                      | `filled`, `outline`, `soft`, `text`, `icon`, `icon-compact`, `link`; polymorphic: `as="button"` / `as="link"` / `as="a"`                                       |
| `UiInput`          | `<input>` (text, email, number, etc.)                                    | `outlined`, `filled`                                                                                                                                           |
| `UiPasswordInput`  | `<input type="password">` + show/hide toggle                             | композиція UiInput + UiButton; внутрішній стан visibility                                                                                                      |
| `UiSelect`         | `<select>`                                                               | `outlined`, `filled`                                                                                                                                           |
| `UiSwitch`         | `<input type="checkbox">` (toggle)                                       | -- (sizes: sm/md/lg)                                                                                                                                           |
| `UiSpinner`        | Кастомні loading-індикатори                                              | -- (sizes: sm/md/lg)                                                                                                                                           |
| `UiDropdownMenu`   | Context menus, action menus, option pickers                              | align: `start`/`end`; sizes: sm/md/lg                                                                                                                          |
| `UiFullPageLoader` | Full-screen centered spinner з optional message                          | композиція UiSpinner; для Suspense fallback та loading states                                                                                                  |
| `UiConfirmDialog`  | `window.confirm()`, кастомні confirmation modals                         | `default`, `destructive`; controlled (open/onOpenChange); Radix AlertDialog                                                                                    |
| `UiTextarea`       | `<textarea>`                                                             | `outlined`, `filled`                                                                                                                                           |
| `UiChipGroup`      | Radio-style inline chip selector                                         | -- (sizes: sm/md/lg); Headless UI RadioGroup                                                                                                                   |
| `UiRadioCardGroup` | Radio-style grid cards з title + description (+ optional icon)           | -- ; responsive `columns: { mobile: 1\|2, desktop: 2\|3\|4 }`; Headless UI RadioGroup; built-in arrow-key + roving tabindex; generic `<TValue extends string>` |
| `UiModal`          | Centered modal / bottom sheet dialogs                                    | controlled (open/onOpenChange); mobile bottom sheet, desktop centered; hideOverlay, hideCloseButton; Radix Dialog                                              |
| `UiHeaderShell`    | Структурна обгортка header-зони (`<header>` + container h-16)            | -- ; className override                                                                                                                                        |
| `UiEditableField`  | Inline-edit per field (read mode → "олівець" → edit mode з ✓/✗ кнопками) | Generic над `TValue`; renderer-props (`renderRead`/`renderEdit`); async `onSave`; optional `validate`; `disabled`                                              |

## Rules

### 1. Заборонені нативні елементи

Наступні HTML-елементи **заборонено** використовувати напряму в коді features, widgets, entities та pages:

| Заборонено                         | Використовувати                            |
| ---------------------------------- | ------------------------------------------ |
| `<button>`                         | `UiButton` (default, `as="button"`)        |
| `<a>`                              | `UiButton as="a"` (зовнішні посилання)     |
| `<Link>` (next/link)               | `UiButton as="link"` (внутрішня навігація) |
| `<input>` (text/email/number)      | `UiInput`                                  |
| `<input type="password">`          | `UiPasswordInput`                          |
| `<select>`                         | `UiSelect`                                 |
| `<input type="checkbox">` (toggle) | `UiSwitch`                                 |
| `<textarea>`                       | `UiTextarea`                               |
| `window.confirm()`                 | `UiConfirmDialog`                          |

**Винятки:**

- `<input type="hidden">`, `<input type="file">` та інші спеціалізовані input-типи, для яких ще не створено Ui-обгортку, дозволені до появи відповідного примітиву.
- `<a href="#section">` — anchor links для навігації по секціях тієї самої сторінки. Не потребують UiButton обгортки, бо це не інтерактивний елемент з варіантами/розмірами, а простий scroll anchor.
- `<a>` всередині prose-контенту (юридичні сторінки, статті, markdown-контент) — inline-посилання в суцільному тексті, де UiButton порушив би flow тексту. Стилізуються через батьківський CSS-клас (наприклад `.prose-legal a`).

### 2. Єдина точка стилізації

Візуальна кастомізація примітивів відбувається через:

1. **variant / size props** -- для стандартних варіацій
2. **className prop** -- для контекстно-специфічних override-ів (позиціонування, кольори)

Заборонено дублювати базові стилі примітивів (padding, transition, cursor, disabled state) у className. Якщо стандартних варіантів недостатньо -- додай новий variant до компонента.

### 3. Розширення реєстру

При появі нового повторюваного UI-патерну:

1. Створи компонент у `shared/ui/Ui{Name}/` зі структурою `{Name}.tsx` + `types.ts` + `index.ts`
2. Додай рядок у таблицю реєстру цього документа
3. Заміни всі існуючі нативні аналоги у кодовій базі
4. Дотримуйся конвенцій існуючих компонентів: `forwardRef`, `composeClasses`, `data-variant`/`data-size`, sizes sm/md/lg

### 4. Scope правила

Правило діє для всього коду **за межами** `shared/ui/`:

```
apps/web/src/
  app/           -- заборонено нативні
  features/      -- заборонено нативні
  entities/      -- заборонено нативні
  widgets/       -- заборонено нативні
  shared/ui/     -- ДОЗВОЛЕНО (тут живуть самі примітиви)
  shared/icons/  -- дозволено (SVG, не інтерактивні елементи)
```

Всередині `shared/ui/` нативні елементи -- це implementation detail, і вони дозволені та очікувані.
