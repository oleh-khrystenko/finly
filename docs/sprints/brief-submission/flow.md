# Brief Submission: Flow

> Форма збору лідів на agency лендінгу. Користувач заповнює бриф, дані зберігаються в базу, користувач отримує confirmation email, власник отримує notification email з деталями запиту.

---

## Що бачить користувач

### 1. Відкриття форми

На лендінгу є два CTA, що ведуть до форми:
- **HeroSection** — primary кнопка "Request a Technical Estimate"
- **FooterCtaSection** — кнопка "Submit Your Idea"

Натискання відкриває форму в:
- **Bottom sheet** на мобільних (viewport < 768px) — знизу, як нативний mobile sheet
- **Модальне вікно** на десктопі (viewport >= 768px) — по центру екрана

Використовується компонент `UiModal` (новий UI primitive на Radix Dialog) з responsive поведінкою через Tailwind breakpoints. `UiModal` — окремий компонент від `UiSheet`, бо modal і sheet це різні UX паттерни з різними анімаціями.

### 2. Заповнення форми

Поля:
- **Name** — текстове, обов'язкове
- **Email** — текстове, обов'язкове, валідація email формату
- **Project description** — textarea, обов'язкове, опис ідеї або проєкту
- **Budget** — select, обов'язковий:
  - < $2,500 (Consulting only)
  - $2,500 - $5,000
  - $5,000 - $10,000
  - $10,000+
- **Deadline** — select, опціональний:
  - ASAP
  - 1-3 months
  - Flexible

Приховане поле (automated):
- **Source** — визначається програмно при першому візиті:
  - UTM-мітка з URL (`?utm_source=linkedin`) — зберігається as-is
  - Або `document.referrer` — зберігається як повний домен без www (e.g., `linkedin.com`, `t.co`, `news.ycombinator.com`)
  - Або `"direct"` якщо обидва відсутні
  - Кешується в `sessionStorage` щоб не втратити при навігації по лендінгу

### 3. Захист від ботів (Cloudflare Turnstile)

Перед відправкою форми спрацьовує Cloudflare Turnstile — невидимий для користувача challenge. Turnstile widget рендериться в прихованому контейнері при відкритті форми. Після проходження challenge фронтенд отримує `captchaToken`, який додається до payload і верифікується на бекенді.

### 4. Відправка

Користувач натискає "Submit". Кнопка переходить в loading стан. Бекенд:
1. Верифікує Turnstile token через Cloudflare API
2. Валідує дані через Zod schema
3. Зберігає Brief документ в MongoDB зі статусом `new`
4. Відправляє confirmation email користувачу
5. Відправляє notification email власнику
6. Повертає success response

Після успіху:
- Форма закривається
- Показується toast: "Request submitted. We will respond within 24 hours."

При помилці:
- Toast з описом проблеми
- Форма залишається відкритою, дані збережені

### 5. Confirmation email (користувачу)

Лист в стилі існуючих CyanShip email (BaseLayout):
- Тема: "We received your project request"
- Тіло: "Thank you, {name}. We have received your project brief and will review it within 24 hours. You will receive a detailed response to this email address."
- Без CTA кнопки — це чисте підтвердження
- Footer: стандартний CyanShip footer

Email відправляється мовою браузера користувача (визначається через `navigator.language`, передається в payload як `lang`).

### 6. Notification email (власнику)

Внутрішній лист на `BRIEF_NOTIFICATION_EMAIL` (env var):
- Тема: "New brief: {name} — {budget}"
- Тіло: всі поля брифу в читабельному форматі
- Завжди англійською (internal communication)

---

## Статуси брифу

| Статус | Значення |
|--------|----------|
| `new` | Щойно надіслано, не переглянуто |
| `in_review` | Взято в роботу |
| `responded` | Відповідь надіслано клієнту |
| `rejected` | Неадекватний запит або нецільовий лід |
| `archived` | Завершена або відкладена комунікація |

Перехід статусів поки що ручний (через MongoDB або майбутню адмінку). В MVP немає UI для управління статусами.

---

## Модульна структура

Brief — це agency фіча. Відповідно до `modular-boundaries.md`:
- API: `apps/api/src/modules/agency/` — AgencyModule з BriefService, BriefController, Brief schema
- Web: `apps/web/src/features/agency/brief/` — BriefForm компонент, API wrapper, source tracking
- Types: `packages/types/src/agency/` — Zod schema, enums, types

Agency модуль залежить від core (EmailModule), але core не імпортує agency.

---

## Що не входить в scope

- Адмін-панель для управління брифами
- Slack/Telegram нотифікації (email достатньо для MVP)
- Автовідповіді або follow-up sequences
- Файлові вкладення до брифу
- A/B тестування форми
- Analytics events (окремий sprint)
