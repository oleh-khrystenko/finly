# Design Tokens Policy

> Всі кольори, шрифти та візуальні параметри стилізації мають використовувати дизайн-токени,
> визначені в `apps/web/src/shared/styles/`. Хардкоджені значення за межами цих файлів **заборонені**.

## Принцип

```
Feature / Page / Widget / shared/ui/
        |
        v
  Tailwind theme tokens    <-- bg-primary, text-muted-foreground, border-border ...
        |
        v
  CSS custom properties    <-- var(--primary), var(--muted-foreground) ...
        |
        v
  shared/styles/themes.css <-- single source of truth
```

Дизайн-токени -- єдине джерело правди для всього візуального оформлення.
Це гарантує консистентну підтримку light/dark теми, можливість глобальної зміни палітри
з одного місця та запобігає візуальним розбіжностям між компонентами.

## Реєстр токенів

Файл: `apps/web/src/shared/styles/themes.css`

Формат: `{color}` + `{color}-foreground` пари.

**Нейтрали — inverted-paper схема на одній tone-axis (hue 65 ↔ 85), дзеркальна за темою.** Розподіл за **роллю токена**, не за L:

| Роль                                                                                  | Light hue              | Dark hue             | L-поведінка                  |
| ------------------------------------------------------------------------------------- | ---------------------- | -------------------- | ---------------------------- |
| **Surfaces** (background, card, muted, secondary, accent, border, input)              | **85** (paper-cream)   | **65** (warm-brown)  | Світлі у light, темні у dark |
| **Text** (foreground, muted-foreground, card/secondary/accent/muted-foreground)       | **65** (warm-brown)    | **85** (paper-cream) | Темні у light, світлі у dark |
| **`primary-foreground`** (CTA-button label)                                           | **85** (paper, L≈0.99) | **65** (brown, L≈0.18) | Інверсія за темою          |
| **`success-foreground`** (success-state label)                                        | **85** (paper, L≈0.99) | **65** (brown, L≈0.18) | Інверсія за темою          |
| **`destructive-foreground`** (alarm-button label)                                     | **85** (paper, L≈0.99) | **85** (paper, L≈0.98) | **Завжди світлий**           |

Chroma нейтралів ≤ 0.018 — ледь-помітний tint без cafe-yellow агресії.

**Чому `primary-foreground` і `destructive-foreground` різні**: `primary` — CTA (нейтральний бренд-acent), його label інвертується за темою як звичайний foreground. `destructive` — **alarm-signal**, де червоно-теракотовий fill повинен зберігати максимальну впізнаваність у обох темах. Темний brown-текст на теракоті у dark гасив би «гучність» сигналу — Linear, Stripe, GitHub, Tailwind UI тримають destructive label завжди-світлим саме з цієї причини. Це навмисний виняток з inverse-логіки, а не помилка.

**Акцентні кольори насичені:** `primary` (emerald hue 158), `destructive` (теракот hue 25), `success` (pure-green hue 145), `warning` (amber hue 75).

| Група           | Tailwind-клас                                                       | CSS-змінна                                            | Призначення                                 |
| --------------- | ------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------- |
| **Background**  | `bg-background`                                                     | `var(--background)`                                   | Фон сторінки                                |
| **Foreground**  | `text-foreground`, `bg-foreground`                                  | `var(--foreground)`                                   | Основний текст, інвертовані елементи        |
| **Card**        | `bg-card`, `text-card-foreground`                                   | `var(--card)`, `var(--card-foreground)`               | Фон карток, текст на картках                |
| **Primary**     | `bg-primary`, `text-primary`, `text-primary-foreground`             | `var(--primary)`, `var(--primary-foreground)`         | CTA кнопки, акценти                         |
| **Secondary**   | `bg-secondary`, `text-secondary-foreground`                         | `var(--secondary)`, `var(--secondary-foreground)`     | Subtle surfaces (icon badges, hover states) |
| **Muted**       | `bg-muted`, `text-muted-foreground`                                 | `var(--muted)`, `var(--muted-foreground)`             | Muted surfaces, другорядний текст           |
| **Accent**      | `bg-accent`, `text-accent-foreground`                               | `var(--accent)`, `var(--accent-foreground)`           | Accent surfaces (hover states)              |
| **Destructive** | `bg-destructive`, `text-destructive`, `text-destructive-foreground` | `var(--destructive)`, `var(--destructive-foreground)` | Помилки, деструктивні дії                   |
| **Border**      | `border-border`                                                     | `var(--border)`                                       | Межі, роздільники                           |
| **Input**       | `bg-input`, `border-input`                                          | `var(--input)`                                        | Input borders/bg                            |
| **Ring**        | `ring-ring`                                                         | `var(--ring)`                                         | Focus rings                                 |
| **Success**     | `text-success`, `bg-success`, `text-success-foreground`             | `var(--success)`, `var(--success-foreground)`         | Успішні стани, toast notifications, label на success-fill |
| **Warning**     | `text-warning`, `bg-warning`                                        | `var(--warning)`                                      | Попередження, toast notifications           |

**Utility tokens:**

| Токен      | Значення   | Tailwind-клас         | Призначення        |
| ---------- | ---------- | --------------------- | ------------------ |
| `--radius` | `0.625rem` | `rounded-sm/md/lg/xl` | Base border-radius |

## Rules

### 1. Заборонені сирі значення кольорів

Наступне **заборонено** у всіх `.tsx`, `.ts` та `.css` файлах за межами `shared/styles/`:

| Заборонено                                                                  | Використовувати                                                          |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Сирі палітри Tailwind (`bg-red-500`, `text-neutral-300`, `border-blue-200`) | Токени теми (`bg-destructive`, `text-muted-foreground`, `border-border`) |
| Hex-значення (`#3b82f6`, `#f9fafb`)                                         | CSS-змінні (`var(--primary)`, `var(--background)`)                       |
| `rgb()` / `rgba()` / `hsl()` / `hsla()`                                     | CSS-змінні або opacity-модифікатори (`bg-primary/20`)                    |

### 2. Відсутній токен -- не привід для хардкоду

Якщо потрібний візуальний варіант не покритий існуючими токенами:

1. Додай нову CSS-змінну в `themes.css` (в обидва блоки: `:root` та `.dark`)
2. Додай Tailwind-прив'язку в блок `@theme inline`
3. Оновити реєстр токенів у цьому документі
4. Використовуй новий токен у компоненті

Ніколи не пропускай цей процес заради "швидкості" -- хардкоджене значення зламає тему.

### 3. Шрифти

Проєкт використовує єдиний шрифт Mulish, підключений в `layout.tsx` через `next/font`.
Прямі `font-family` декларації в CSS чи inline-стилях **заборонені**.

Дозволено лише Tailwind-утиліти для характеристик шрифту: `font-bold`, `text-sm`, `tracking-wide` тощо.

### 4. Анімації

Кастомні анімації визначаються в `shared/styles/animations.css`.
Нові `@keyframes` додаються туди ж -- ніколи не в компонентні файли чи inline-стилі.

### 5. Opacity-модифікатори

Для напівпрозорих варіантів використовуй Tailwind opacity syntax з токенами теми:

```
bg-destructive/10  -- замість bg-red-50
text-success/80    -- замість text-green-600
border-primary/30  -- замість border-blue-200
```

## Винятки

| Контекст                              | Що дозволено                             | Причина                                                                     |
| ------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------- |
| `shared/styles/`                      | oklch-значення в CSS-змінних             | Тут визначаються самі токени                                                |
| `shared/icons/`                       | Hex-значення у SVG `fill`/`stroke`       | Брендові іконки (Google, Stripe) з офіційними кольорами                     |
| `white` / `black`                     | `text-white`, `bg-black/50`              | Універсальні константи (контрастний текст, overlay backdrop)                |
| Inline `style` для динамічних значень | `style={{ backgroundColor: userColor }}` | Runtime-значення, що не можуть бути токеном (user avatar color, chart data) |

## Scope

Правило діє для всього коду фронтенду:

```
apps/web/src/
  app/           -- заборонені сирі кольори
  features/      -- заборонені сирі кольори
  entities/      -- заборонені сирі кольори
  widgets/       -- заборонені сирі кольори
  shared/ui/     -- заборонені сирі кольори (примітиви теж використовують токени)
  shared/styles/ -- ДОЗВОЛЕНО (тут визначаються токени)
  shared/icons/  -- ДОЗВОЛЕНО (брендові SVG)
```
