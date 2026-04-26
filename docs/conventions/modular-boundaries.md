# Modular Boundaries (Core / Agency)

Проєкт побудований як Modular Monolith з жорстким розділенням на **Core** (SaaS boilerplate) та **Agency** (бізнес-логіка агенції: лендінг, маркетинг, SEO, ліди).

Головна мета: форк репозиторію + видалення agency-модуля за 15 хвилин = чистий core для нового клієнта без зламу інфраструктури.

## Принцип

```
agency --> core    (OK: agency імпортує з core)
core  -/-> agency  (ЗАБОРОНЕНО: core ніколи не імпортує з agency)
```

## Фізичні шляхи

### Core (все, що вже існує)

Core -- це весь поточний код: auth, users, payments, shared UI, config, common guards/filters/providers. Він не виділяється в окрему директорію -- це **default scope**.

### Agency (ізольований скоуп)

| Шар | Шлях |
|-----|------|
| API module | `apps/api/src/modules/agency/` |
| Web routes | `apps/web/src/app/[locale]/(agency)/` |
| Web features | `apps/web/src/features/agency/` |
| Web entities | `apps/web/src/entities/agency/` |
| Web widgets | `apps/web/src/widgets/agency/` |
| Shared types | `packages/types/src/agency/` |

### packages/types розділення

```
packages/types/src/
  index.ts          # Реекспортує всі модулі, включаючи agency
  agency/           # Agency-specific schemas, enums, contracts
```

Agency-типи експортуються через головний `@cyanship/types` — окремий subpath не потрібен, бо `moduleResolution: "node"` не підтримує `exports` map.

## Однонаправлений потік залежностей

### Дозволено

- `modules/agency/` -> `modules/users/` (UsersService для роботи з користувачами)
- `modules/agency/` -> `modules/payments/` (PaymentsService для білінгу)
- `modules/agency/` -> `common/` (guards, filters, decorators)
- `features/agency/` -> `shared/` (UI kit, API client, stores)
- `packages/types/src/agency/` -> `packages/types/src/` (core schemas)

### Заборонено

- `modules/auth/` -> `modules/agency/`
- `modules/users/` -> `modules/agency/`
- `modules/payments/` -> `modules/agency/`
- `common/` -> `modules/agency/`
- `shared/` -> `features/agency/`
- `shared/` -> `entities/agency/`
- `packages/types/src/index.ts` -> `packages/types/src/agency/`

## Enforcement (ESLint)

Правило `no-restricted-imports` налаштовано в обох apps для автоматичної перевірки на CI:

**apps/api** -- заборона імпорту `**/modules/agency/**` з будь-якого файлу поза `modules/agency/`.

**apps/web** -- заборона імпорту `**/agency/**` (features, entities, widgets) з файлів поза agency scope.

## Що залишається в Core (навіть якщо стосується agency)

- Stripe/payments logic -- agency-specific тарифи додаються через конфігурацію (env vars, feature flags), а не код
- Email templates -- agency додає нові шаблони у свій модуль, не модифікує існуючі core шаблони
- Auth flow -- ніяких agency-specific guards чи strategies
- Base UI kit (`shared/ui/`) -- agency використовує, не розширює core компоненти
- i18n namespaces -- agency додає свої namespace-файли, не модифікує core ключі

## Підключення Agency модуля

### NestJS (apps/api)

Agency реєструється як один рядок в `app.module.ts`:

```typescript
imports: [
    // ... core modules
    AgencyModule,  // <-- видалити цей рядок при форку
]
```

### Next.js (apps/web)

Agency routes ізольовані через route group `(agency)` -- видалення директорії не впливає на інші routes. Якщо agency має записи в `middleware.ts`, вони повинні бути чітко позначені коментарем `// agency`.

## Fork Checklist (15-minute cleanup)

1. Видалити `apps/api/src/modules/agency/`
2. Прибрати `AgencyModule` з `apps/api/src/app.module.ts` (один import + один рядок в imports array)
3. Видалити `apps/web/src/app/[locale]/(agency)/`
4. Видалити `apps/web/src/features/agency/`, `entities/agency/`, `widgets/agency/` (якщо існують)
5. Видалити `packages/types/src/agency/` та `packages/types/src/agency.ts`
6. Прибрати agency export з `packages/types/package.json`
7. Прибрати agency-рядки з `middleware.ts` (позначені `// agency`)
8. Видалити agency i18n ключі з `messages/uk.json`, `messages/en.json`
9. Видалити agency env vars (якщо є)
10. `pnpm build` -- повинен пройти без помилок
