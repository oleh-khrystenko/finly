# Sprint 16 — Стан реалізації (handoff)

Цей файл фіксує поточний стан робіт, щоб нова сесія орієнтувалась без контексту попередньої розмови. План (куди йдемо) у `README.md`, бізнес-рішення у `planning-questions.md`.

Гілка: `feature/design`.

## Зроблено

- **План + ревʼю** (`plan-review`: чисто). Коміти плану.
- **Фронтенд help-center** (`a3866fb`): публічні роути `/help` (індекс) і `/help/[slug]` (стаття), сайдбар, breadcrumb, картки, CTA, footer, SEO-метатеги/canonical через `fetchMetadata`. Тіло статей через `react-markdown` + `.prose-help`.
- **UI публічного AI-чату** (`a3866fb`): `apps/web/src/features/help-chat`, вбудований у сторінку (`/help#assistant`). Стани: empty, streaming, off-topic-як-повідомлення, rate-limit, degradation-бюджет.
- **Бекенд AI-помічника** (`0b0837d`): `POST /ai/help/chat` (anon, без auth/executions/БД), `HelpChatRateLimitGuard` (per-IP 24h + глобальний денний бюджет), окремий throttle-бакет, заземлений системний промпт зі строгим скоупом і anti-hallucination. Кабінетний `/ai/chat` не зачеплено.

## Залишилось

1. **Копірайтинг статей.** Зараз чорновий scaffold. Канонічний контент: `packages/types/src/help/articles.ts` (і описи категорій у `categories.ts`). Це **єдине джерело правди**: правка там оновлює і сторінку, і базу знань AI. Після правок обовʼязково `pnpm --filter @finly/types build`, щоб бекенд підхопив. Запускати скіл `copywriter`.
2. **SEO sitemap.** Додати `apps/web/src/app/sitemap.ts` для `/help` і `/help/<slug>` (за бажанням `robots.ts`). Slug-и брати з `getAllArticleSlugs()` у `@finly/types`. Робити ПІСЛЯ копірайтингу (якщо він переназве slug-и).
3. **Прод-env (операційне, не код).** Додати на сервер: `HELP_CHAT_MAX_TOKENS`, `HELP_CHAT_IP_LIMIT`, `HELP_CHAT_DAILY_BUDGET` (див. `.env.example`). Без них API падає на fail-fast.

## Інваріанти, які не можна порушувати

- **Single source of truth контенту.** Текст статей живе тільки в `packages/types/src/help`. Не дублювати у веб чи в промпт. Веб додає лише icon-mapping (`entities/help-article/model/categoryIcons.ts`).
- **Не чіпати кабінетний `/ai/chat`** (JwtActive + executions). Help-чат це окремий endpoint/guard/throttle-бакет.
- **Slug-и стабільні** після публікації (ламають зовнішні посилання і SEO).
- **Бекенд-endpoint анонімний** через native `fetch` `credentials:'omit'` на фронті; не пускати через axios-клієнт кабінету.

## Не плутати зі Sprint 16

У working tree є незавершені зміни в `apps/web/src/features/account-edit` і `UiDropdownMenu` — це **інша робота**, не чіпати при роботі над довідкою.
