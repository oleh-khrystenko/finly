# Sprint 11 — Implementation Steps (live tracker)

> Робочий чек-лист на час імплементації. Після `Definition of Done` файл можна видалити.
> Кожен крок = окремий commit. Між кроками downstream-build може бути broken (acceptable per project convention).

## Step 1 — Епік 11.0 (Shared types)

- [ ] `packages/types/src/utils/path.ts` — `validateSameOriginPath(target: string): boolean`.
- [ ] `packages/types/src/utils/path.spec.ts` — 5 valid + 5 invalid кейсів.
- [ ] Експорт `validateSameOriginPath` з `packages/types/src/utils/index.ts` (або кореневого barrel-у).
- [ ] `packages/types/src/entities/user.ts` — додати `pendingPostLoginTarget` optional з refine.
- [ ] `packages/types/src/entities/user.spec.ts` — round-trip valid + invalid path reject.
- [ ] `packages/types/src/contracts/users.ts` — `UpdateUserSchema` приймає `pendingPostLoginTarget: z.literal(null).optional()`.
- [ ] `packages/types/src/contracts/users.spec.ts` (або existing) — приймає `null`, reject-ить non-null string.
- [ ] **Acceptance:** `pnpm --filter @finly/types build && pnpm --filter @finly/types test` зелений.
- [ ] **Commit:** `feat: add validateSameOriginPath helper and pendingPostLoginTarget contract (Sprint 11.0)`

---

## Step 2 — Епік 11.1 (Backend)

- [ ] `apps/api/src/modules/users/schemas/user.schema.ts` — `@Prop({ type: String, required: false }) pendingPostLoginTarget?: string` (без index).
- [ ] `apps/api/src/modules/users/users.service.ts` — `setPendingPostLoginTarget(userId, target)` + `clearPendingPostLoginTarget(userId)`.
- [ ] `apps/api/src/modules/users/users.controller.ts` — `PATCH /users/me` приймає `pendingPostLoginTarget: null` (через `UpdateUserSchema`); виклик service-методу `clearPendingPostLoginTarget`. На non-null value (через DTO-validation вже відсічено) — додатковий захист.
- [ ] `apps/api/src/modules/landing-claim/landing-claim.module.ts` — додати `UsersModule` в `imports`.
- [ ] `apps/api/src/modules/landing-claim/landing-claim.service.ts` — на success-claim викликати `usersService.setPendingPostLoginTarget(user._id, '/business/{slug}/account/{slug}?completed-from=landing')`.
- [ ] `apps/api/src/modules/users/users.service.spec.ts` — 4 нові кейси (valid, no-leading-slash, protocol-prefix, double-slash).
- [ ] `apps/api/src/modules/landing-claim/landing-claim.service.spec.ts` — додати regression-кейс: success-flow stamps `pendingPostLoginTarget` на user-doc.
- [ ] **Acceptance:** `pnpm --filter api test` зелений.
- [ ] **Commit:** `feat: stamp pendingPostLoginTarget on landing claim success (Sprint 11.1)`

---

## Step 3 — Епік 11.2 (Frontend)

- [ ] `apps/web/src/shared/api/users.ts` — додати `clearPendingPostLoginTarget()` thin wrapper над `PATCH /users/me`.
- [ ] `apps/web/src/features/auth/AuthInitializer.tsx` — після `setUser(me)` перевірити `me.pendingPostLoginTarget`: validate → clear → `router.replace`. Order: clear-before-redirect.
- [ ] `apps/web/src/app/auth/verify/page.tsx` — fire-and-forget `void clearPendingPostLoginTarget().catch(logWarn)` ДО `router.replace`.
- [ ] `apps/web/src/features/auth/AuthInitializer.spec.tsx` — 4 нові кейси (no-target, valid, invalid, clear-failure).
- [ ] `apps/web/src/app/auth/verify/page.spec.tsx` — 1 регресійний кейс на clear-call.
- [ ] **Acceptance:** `pnpm --filter web test` зелений.
- [ ] **Commit:** `feat: consume pendingPostLoginTarget on auth verify and cold-login (Sprint 11.2)`

---

## Step 4 — Епік 11.3 (Docs)

- [ ] `docs/manual-checks/README.md` — додати UAT DEEP-1 / DEEP-2 / DEEP-3.
- [ ] **`CLAUDE.md`** — Domain Model `User` додати `pendingPostLoginTarget`; Known Complexities — новий пункт. **Це робить користувач сам** (skill не редагує `CLAUDE.md`).
- [ ] **Acceptance:** `pnpm lint && pnpm build` зелений.
- [ ] **Commit (manual-checks частина):** `docs: add Sprint 11 UAT and CLAUDE.md notes (Sprint 11.3)`

---

## Final verification

- [ ] `pnpm test` зелений по всіх workspace-ах.
- [ ] `pnpm lint` без нових warnings.
- [ ] `pnpm build` всіх workspace-ів success.
- [ ] DoD у README.md відмічено.
- [ ] Цей файл (`IMPLEMENTATION_STEPS.md`) видалено.
