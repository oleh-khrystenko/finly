# Responsive & Mobile-First Policy

> **Залізобетонне правило.** Всі сторінки в Finly — адаптивні під **mobile + tablet + desktop**. Дизайн і верстка робляться **mobile-first**: спочатку мобільний layout, потім розширюємо для більших екранів.

## Принцип

**Mobile-first** означає:

- Базові стилі компонента — для мобільного.
- Tailwind-модифікатори (`sm:`, `md:`, `lg:`, `xl:`) додають / змінюють поведінку для більших екранів.
- НЕ навпаки (десктоп-стилі за замовчуванням, потім `max-md:` для мобільного — заборонено).

```tsx
// ✅ Правильно (mobile-first)
<div className="flex flex-col gap-4 md:flex-row md:gap-8">

// ❌ Неправильно (desktop-first з override на мобільне)
<div className="flex flex-row gap-8 max-md:flex-col max-md:gap-4">
```

## Чому mobile-first

1. **Публічна сторінка `pay.finly.com.ua/{slug}`** — клієнт сканує QR з телефону, потім тапає по кнопках банків. Це **завжди мобільний пристрій**. Десктоп для публічної сторінки — рідкісний edge-case.
2. **Кабінет** — ФОП часто перевіряє стан зі смартфона (на касі, в дорозі). Десктоп — основний робочий сценарій, але мобільний — обов'язковий.
3. **CSS cascading** — додавати стилі простіше, ніж їх перевизначати. Mobile-first дає більш передбачуваний CSS.

## Стандартні breakpoints

Використовуємо стандартні Tailwind v4 breakpoints плюс один санкціонований custom (`xs`):

| Префікс   | Min-width | Цільові пристрої                                       |
| --------- | --------- | ------------------------------------------------------ |
| (default) | 0px       | Малі mobile portrait (iPhone SE / mini, ≤429px)        |
| `xs:`     | 430px     | Великі mobile portrait (iPhone Pro Max та ширші)       |
| `sm:`     | 640px     | Mobile landscape, малі планшети                        |
| `md:`     | 768px     | Tablet portrait (iPad mini, iPad)                      |
| `lg:`     | 1024px    | Tablet landscape, малі ноутбуки                        |
| `xl:`     | 1280px    | Desktop                                                |
| `2xl:`    | 1536px    | Великі desktop-монітори                                |

**`xs` (430px)** — єдиний custom breakpoint, заведений у `apps/web/src/shared/styles/themes.css`
(`--breakpoint-xs`). Призначення: тонкий адаптив у межах телефонів, де `sm` (640px) надто
далеко — коли елемент влазить на ширших телефонах (≥430), але не на вузьких (375). Типовий
кейс: компактний попап на 375px, що виростає до повного розміру від 430px.

**Інших custom breakpoints не вводити без сильного обґрунтування** — фрагментація шкали
ускладнює QA. Якщо реально потрібен новий — додавати у `themes.css` через `@theme` і
обовʼязково оновлювати цю таблицю.

## Обов'язкові правила

### 1. Жодного horizontal scroll на мобільному

При ширині 320px (найвужчий iPhone SE 1-го покоління) сторінка **не повинна** мати горизонтального скролу. Тестується через DevTools "Responsive" 320×568.

Типові порушники:

- Великі таблиці без `overflow-x-auto` обгортки.
- Inline-зображення з фіксованою шириною (`w-[800px]`).
- `whitespace-nowrap` на довгих рядках без `overflow-hidden text-ellipsis`.

### 2. Touch targets ≥ 44×44 px

Всі клікабельні елементи (кнопки, посилання, чекбокси) на мобільному мають розмір touch-target ≥ 44×44 px (Apple HIG / Material Design). Маленькі іконки обгортаються у padding.

**`UiButton variant="icon"` enforces 44×44 baseline на рівні примітиву** (`min-h-11 min-w-11` у `apps/web/src/shared/ui/UiButton/UiButton.tsx`). Будь-який `size` (`sm`/`md`/`lg`) гарантовано дає touch-target ≥ 44×44 px без додаткового `className` від caller-а:

```tsx
// ✅ Touch-friendly за замовчуванням — primitive сам тримає 44×44 мінімум
<UiButton variant="icon" aria-label="Закрити">
  <CloseIcon />
</UiButton>

// ❌ Native <button> заборонено за ui-primitives.md
<button className="p-3" aria-label="Закрити">
  <CloseIcon className="size-4" />
</button>

// ⚠️ icon-compact — навмисний виняток, нульовий padding, **без** 44×44 baseline.
//    Допустиме лише в dense desktop UI (toolbars, table-rows), де поруч ≥ 8 px gap
//    і primary-input — миша. Не використовуйте на mobile-flow.
<UiButton variant="icon-compact" aria-label="Закрити">
  <CloseIcon />
</UiButton>
```

Якщо в callsite потрібен touch-friendly icon-button — використовуйте `variant="icon"` без думання про розміри. Якщо `variant="icon-compact"` — це свідома відмова від 44×44 для dense desktop-патерну, з відповідальністю caller-а перевірити, що елемент не з'являється на mobile flow.

> Native HTML-елементи (`<button>`, `<a>`, `<input>`) поза `shared/ui/` заборонені — див. [ui-primitives.md](ui-primitives.md). У цьому документі позитивні приклади використовують `Ui*` примітиви; native-теги з'являються лише у `❌`-прикладах щоб явно показати заборонене.

### 3. Текст читабельний без zoom

Базовий розмір тексту на мобільному — не менше 14px (Tailwind `text-sm`). Дрібніше — лише для абсолютно вторинної інформації (timestamps, метадані).

### 4. Форми працюють із virtual keyboard

- `inputMode` атрибут для числових / телефонних полів (`inputMode="numeric"`, `inputMode="tel"`, `inputMode="email"`).
- `autocomplete` для polifill з браузерним autofill.
- Поле в фокусі при відкритті модалки — лише на десктопі. На мобільному — не автофокусуємо, бо викликає клавіатуру і ламає layout.

### 5. Модалки і sheets

На мобільному (`<sm`) модалки рендеряться як **bottom sheet** (висовується знизу). На десктопі — centered modal. Це вже реалізовано в `UiModal` (див. [ui-primitives.md](ui-primitives.md)) — використовуємо без замін.

### 6. Hover-стани не несуть критичної інформації

На мобільному hover не існує. Будь-який UI-елемент з hover-tooltip / hover-меню повинен мати **альтернативу для тапу** (long-press / окремий tap-handler / inline-індикатор).

```tsx
// ✅ Завжди видимий inline-опис (працює однаково на mobile і desktop)
<div>
  <span>Bookkeeper-режим</span>
  <p className="text-xs text-muted-foreground">
    Вести бізнеси клієнтів
  </p>
</div>

// ❌ Hover-only tooltip — інформація недоступна на mobile
<div>
  Bookkeeper-режим
  <Tooltip content="Вести бізнеси клієнтів">
    <InfoIcon />
  </Tooltip>
</div>
```

Якщо інформація **дійсно вторинна** (advanced-деталі для power-юзера) і tooltip є кращим UX за inline-текст — використовуй click-trigger через існуючий popover-примітив (`UiDropdownMenu` або `UiSheet`), не hover-only. Окремого `UiTooltip` примітива в репо немає; якщо він знадобиться у майбутньому — додаємо за паттерном з [ui-primitives.md](ui-primitives.md) (Radix Tooltip wrapped як `Ui*`), і одразу з обов'язковим click-fallback для mobile.

### 7. Тестові viewport-и

Перед merge кожна нова сторінка / суттєво зміна layout перевіряється на трьох viewport-ах через DevTools:

| Viewport | Розмір   | Цільовий пристрій            |
| -------- | -------- | ---------------------------- |
| Mobile   | 375×667  | iPhone SE 2nd gen / iPhone 8 |
| Tablet   | 768×1024 | iPad portrait                |
| Desktop  | 1440×900 | Ноутбук / середній монітор   |

## Винятки

Жодних "ця сторінка тільки для десктопу" — усе адаптивне.

Єдиний legitimate-кейс десктоп-only — це **dev-utility сторінки** (внутрішні admin-панелі, debug-вікна). На MVP таких немає; коли з'являться — вони повинні бути в окремому `/admin` префіксі і явно поміченими як "desktop only" у заголовку.

## Scope

Правило діє для всього фронтенду:

```
apps/web/src/
  app/           -- усі сторінки адаптивні
  features/      -- усі компоненти адаптивні
  widgets/       -- усі widgets адаптивні
  entities/      -- усі компоненти адаптивні
  shared/ui/     -- примітиви адаптивні (mobile-first defaults)
```

## Чек-лист для PR

При створенні / зміні UI-компонента:

- [ ] Перевірено на 320px (iPhone SE 1) — нема horizontal scroll.
- [ ] Перевірено на 375×667 (iPhone SE 2) — основний flow працює.
- [ ] Якщо компонент використовує `xs:` — перевірено перемикання на межі 430px (375 vs 430).
- [ ] Перевірено на 768×1024 (iPad portrait) — layout масштабується.
- [ ] Перевірено на 1440×900 (desktop) — layout не "розтягнутий" (max-width контейнери де треба).
- [ ] Touch targets ≥ 44×44 px на мобільному.
- [ ] Hover-tooltip має fallback-альтернативу для тапу.
- [ ] Mobile-first Tailwind (без `max-*:` префіксів).
