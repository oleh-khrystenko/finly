# Sprint 15 — Editable nested slugs (Account + Invoice): питання планування

Контекст: Business уже має редаговуваний vanity-slug з history-fallback + 308-redirect + anti-squatting + self-revert + cascade-cleanup (Sprint 14). Цей спринт дзеркалить патерн на nested-сутності Account і Invoice. Нижче — продуктові розвилки, що впливають на форму плану.

## Q1. Форма редаговуваного slug

Зараз:

- Account slug: рівно 8 символів `[A-Za-z0-9]`, system-generated, без людської частини.
- Invoice slug: `{людська-частина-kebab}-{8-char-tail}` або просто `{8-char-tail}`.
- Business slug (еталон): вільний kebab `[A-Za-z0-9]+(-...)*`, 3..63, без обов'язкового tail.

Питання: на редагуванні який формат дозволяємо?

- (A) Повний вільний vanity-string як у Business (kebab, без обов'язкового хвоста). Користувач сам відповідає за унікальність, на колізію — помилка SLUG_TAKEN.
- (B) Лишаємо system tail обов'язковим, редагується лише людський префікс (унікальність майже гарантована хвостом).

Відповідь: (A) Повний вільний vanity як у Business. Унікальність на самому slug, на колізію SLUG_TAKEN.

## Q2. Чутливість до регістру

Business uniqueness — case-insensitive (поле slugLower). Account/Invoice зараз case-sensitive без slugLower.

Питання: переводимо Account/Invoice на case-insensitive модель як у Business (нове поле slugLower + унікальність на ньому), чи лишаємо case-sensitive?

Відповідь: (A) Case-insensitive як Business. Нове поле slugLower + унікальність/пошук на ньому + міграція наявних записів.

## Q3. Invoice rename × нумерація (preset/counter)

Invoice має slugPreset + slugCounter/slugCounterScope (монотонна нумерація per-account, окрема collection захищає від reuse). Зараз slugPreset immutable.

Питання: коли ФОП вручну перейменовує інвойс, що з прив'язкою до пресету-нумерації?

- (A) Лишаємо preset/counter недоторканими як історичний слід (counter не звільняється, лишається монотонним), просто оновлюємо slug.
- (B) Manual rename відв'язує інвойс від пресету (slugPreset стає null).

Відповідь: (A) Preset і лічильник недоторкані. Counter лишається монотонним, slugPreset як історичний маркер. Оновлюємо лише видимий slug (+ slugLower).

## Q4. Чи редагування доступне у null-owner режимі (бухгалтер-менеджер)

Account/Invoice сторінки доступні і власнику, і менеджерам через guard-ланцюг. Slug — частина публічного посилання.

Питання: дозволяємо slug-rename і менеджерам (як решту edit-полів), чи owner-only?

Відповідь: (A) І власник, і менеджери, як решта edit-полів. Без спецкейсу авторизації на рівні поля.
