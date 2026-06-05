# Sprint 16 — Стан реалізації (handoff)

Цей файл фіксує поточний стан робіт, щоб нова сесія орієнтувалась без контексту попередньої розмови. План (куди йдемо) у `README.md`, бізнес-рішення у `planning-questions.md`.

Гілка: `feature/design`.

## Зроблено

- **План + ревʼю** (`plan-review`: чисто). Коміти плану.
- **Фронтенд help-center** (`a3866fb`): публічні роути `/help` (індекс) і `/help/[slug]` (стаття), сайдбар, breadcrumb, картки, CTA, footer, SEO-метатеги/canonical через `fetchMetadata`. Тіло статей через `react-markdown` + `.prose-help`.
- **UI публічного AI-чату** (`a3866fb`): `apps/web/src/features/help-chat`, вбудований у сторінку (`/help#assistant`). Стани: empty, streaming, off-topic-як-повідомлення, rate-limit, degradation-бюджет.
- **Бекенд AI-помічника** (`0b0837d`): `POST /ai/help/chat` (anon, без auth/executions/БД), `HelpChatRateLimitGuard` (per-IP 24h + глобальний денний бюджет), окремий throttle-бакет, заземлений системний промпт зі строгим скоупом і anti-hallucination. Кабінетний `/ai/chat` не зачеплено.

## Залишилось

1. **Прод-env (операційне, не код).** Додати на сервер: `HELP_CHAT_MAX_TOKENS`, `HELP_CHAT_IP_LIMIT`, `HELP_CHAT_DAILY_BUDGET` (див. `.env.example`). Без них API падає на fail-fast.

## Зроблено (продовження)

- **Копірайтинг статей.** Усі 9 статей у `packages/types/src/help/articles.ts` переписано і звірено з кодом як джерелом правди (типи бізнесу, формати taxId, реальні підписи кнопок «Створити бізнес»/«Додати рахунок»/«Виставити інвойс», семантика перемикача суми, 4 формати нумерації з реальним slug `inv-001-{код}`, маска IBAN, grace-період 30 днів). Рішення власника: білінг згадано загально без цін; кабінетний AI-чат і «виконання» у публічній довідці не описуються; термін «рахунок клієнту» збережено з містком до реального «інвойс». Пройдено `code-review`. `@finly/types` зібрано.
- **SEO sitemap + robots.** `apps/web/src/app/sitemap.ts` (landing, `/help`, усі статті через `getAllArticleSlugs()`, `/privacy`, `/terms`) і `apps/web/src/app/robots.ts` (allow public, disallow `/auth/` і приватні cabinet-сегменти, sitemap-посилання). Метатеги/canonical вже були в `a3866fb`.

## Інваріанти, які не можна порушувати

- **Single source of truth контенту.** Текст статей живе тільки в `packages/types/src/help`. Не дублювати у веб чи в промпт. Веб додає лише icon-mapping (`entities/help-article/model/categoryIcons.ts`).
- **Не чіпати кабінетний `/ai/chat`** (JwtActive + executions). Help-чат це окремий endpoint/guard/throttle-бакет.
- **Slug-и стабільні** після публікації (ламають зовнішні посилання і SEO).
- **Бекенд-endpoint анонімний** через native `fetch` `credentials:'omit'` на фронті; не пускати через axios-клієнт кабінету.

## Не плутати зі Sprint 16

У working tree є незавершені зміни в `apps/web/src/features/account-edit` і `UiDropdownMenu` — це **інша робота**, не чіпати при роботі над довідкою.
