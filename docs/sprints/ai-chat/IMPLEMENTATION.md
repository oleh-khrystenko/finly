# AI Chat — Technical Implementation Plan (Historical)

> **Status: HISTORICAL.** Цей документ описує початкову реалізацію AI chat модуля. Billing flow (`finalizeChat`, snapshot-based guard, debit-only-on-success) був замінений durable reservation pattern. Актуальний billing/concurrency flow описано в [`../ai-chat-parallel-bypass/IMPLEMENTATION_PLAN.md`](../ai-chat-parallel-bypass/IMPLEMENTATION_PLAN.md).
>
> Частини цього документа, що стосуються структури модуля, provider abstraction, schema, frontend UI, i18n — залишаються актуальними. Секції про billing flow (finalizeChat, AiRateLimitGuard.checkAccountLimit, pre-stream balance check, abort semantics) — застарілі.
>
> **Original goal:** Add a streaming AI chat to the dashboard, fully integrated with the existing executions billing system. Provider-agnostic architecture following the established `PAYMENT_PROVIDER` → `StripeService` pattern. Lifetime per-account AI limit with brief-form lead-gen gate for one-time bonus. Persistent chat history in MongoDB.

---

## Architecture Overview

### Request Flow

> **OUTDATED** — цей flow замінений durable reservation pattern. Актуальний flow: reserve (atomic) → stream → commit (transaction) / refund (atomic). Див. [`../ai-chat-parallel-bypass/IMPLEMENTATION_PLAN.md`](../ai-chat-parallel-bypass/IMPLEMENTATION_PLAN.md).

```
POST /ai/chat (text/event-stream)
  → JwtActiveGuard (existing)
  → OnboardingInterceptor (existing, global)
  → AiRateLimitGuard (IP rate limit only — account limit moved to atomic reserve)
  → AiController.chat()
      → AiService.reserveChatRequest(userId) — atomic balance + account limit + single-flight
      → Set SSE headers
      → IAiProvider.streamChat(message, systemPrompt)
      → SSE stream: {type:"token"} → {type:"token"} → ...
      → On success: commitChatRequest (MongoDB transaction: claim reservation + ledger + history)
      → On client abort after first token: commit (non-refundable)
      → On client abort before first token / provider error: refundChatRequest (atomic restore)
      → Cron safety net: ReservationReconcileService refunds expired reservations every 5 minutes

GET /ai/chat/history → JwtActiveGuard → Returns ChatMessage[] for user
DELETE /ai/chat/history → JwtActiveGuard → Deletes all ChatMessage for user
```

### Module Dependency Map

```
AppModule → AiModule → UsersModule (one-directional, no forwardRef needed — for UsersService.recordTransaction)
                     → REDIS_CLIENT (existing provider from `common/providers/redis.provider.ts`)
                     → AI_PROVIDER injection token → AnthropicService
                     → ChatMessage schema (new MongoDB collection)
                     → User schema (for guard + ai.requestsUsed increment)

AppModule → AgencyModule (existing) → User schema (for ai.bonusGranted one-time flag)
```

`redisProvider` already lives in `apps/api/src/common/providers/redis.provider.ts` — shared infrastructure, imported by PaymentsModule and AuthModule.

---

## Phase 1 — Shared Types (`packages/types`)

### 1.1 Update `packages/types/src/contracts/executions.ts`

- Add `AI_CHAT: 'ai_chat'` to `EXECUTION_ACTION` (Debit section)
- Do NOT add to `SPENDABLE_ACTIONS` — `ai_chat` is an internal action used only by the AI module, not exposed through the general `POST /users/me/executions/spend` endpoint. This prevents users from calling the spend endpoint with `action: 'ai_chat'` directly (bypassing AI guards, creating fake transactions)

### 1.2 Create `packages/types/src/contracts/ai-chat.ts`

Define and export:
- `AI_CHAT_COST = 200` — single source of truth for AI chat execution cost (used by AI module for deduction, frontend for display)
- `AI_CHAT_MESSAGE_MAX_LENGTH = 500`
- `AiChatRequestSchema` — Zod schema: `{ message: string, trimmed, min 1, max 500 }`
- `AiChatRequest` — inferred type
- `AI_CHAT_EVENT` — const object: `TOKEN`, `ERROR`, `DONE`
- SSE event interfaces: `AiChatTokenEvent` (`{ type, content }`), `AiChatErrorEvent` (`{ type, code }`), `AiChatDoneEvent` (`{ type, balanceAfter, aiRequestsRemaining }`)
- `AiChatSSEEvent` — union of the three event types
- `ChatMessageSchema` — Zod schema for persisted message: `{ id, role: 'user'|'assistant', content, createdAt }`
- `ChatMessageItem` — inferred type
- `ChatHistorySchema` — `{ messages: ChatMessageItem[] }`

### 1.3 Update `packages/types/src/agency/brief.ts`

No changes to `SubmitBriefSchema` — `requestAiBonus` and `userId` are both set server-side by the authenticated endpoint controller, never sent from client. The Brief MongoDB schema (Phase 3.1) stores these fields, but the client-facing Zod validation schema stays unchanged.

### 1.4 Update `packages/types/src/entities/user.ts`

Add `ai` subdocument to user entity Zod schema:
- `ai: z.object({ requestsUsed: z.number().int().min(0), bonusGranted: z.boolean() }).nullable()`
- Nullable because existing users won't have this field until first AI interaction (Mongoose default handles new users)

### 1.4.1 Update `UserProfileSchema` pick set

Add `ai` to `UserProfileSchema` pick — without this, `getMe()` won't return AI limits to the frontend, and brief-gate can't determine `bonusGranted` state.

### 1.5 Update `packages/types/src/contracts/index.ts`

Add export: `export * from './ai-chat'`

### 1.6 Rebuild: `pnpm --filter @cyanship/types build`

---

## Phase 2 — Backend: AI Module

### File Structure

```
apps/api/src/modules/ai/
├── ai.module.ts
├── ai.controller.ts
├── ai.service.ts
├── interfaces/
│   └── ai-provider.interface.ts
├── providers/
│   ├── ai-provider.provider.ts
│   └── anthropic.service.ts
├── guards/
│   └── ai-rate-limit.guard.ts
├── schemas/
│   └── chat-message.schema.ts
└── dto/
    └── ai-chat.dto.ts
```

### 2.1 AI Provider Interface (`interfaces/ai-provider.interface.ts`)

- Interface `IAiProvider` with single method: `streamChat(userMessage: string, systemPrompt: string, maxTokens: number): Promise<Readable>`
- Returns standard Node.js `Readable` — provider-agnostic. Each adapter wraps provider-specific stream into `Readable`
- Export `AI_PROVIDER = Symbol('AI_PROVIDER')` — DI injection token

### 2.2 Anthropic Service (`providers/anthropic.service.ts`)

- `@Injectable()`, implements `IAiProvider`
- Constructor creates own Anthropic SDK instance with `ENV.ANTHROPIC_API_KEY` (same pattern as `CatalogService` creating own Stripe instance to avoid circular DI)
- Model: `claude-haiku-4-5-20251001`
- `streamChat()`: calls `client.messages.stream(...)`, wraps into `Readable` by listening to `text`, `end`, `error` events
- System prompt hardcoded in `AiService`, not here — provider is a dumb transport

### 2.3 Provider Factory (`providers/ai-provider.provider.ts`)

- `{ provide: AI_PROVIDER, useClass: AnthropicService }` — exact same pattern as `paymentProviderProvider`
- To swap to OpenAI/Gemini: create new service implementing `IAiProvider`, change `useClass` here. Zero changes elsewhere

### 2.4 Chat Message Schema (`schemas/chat-message.schema.ts`)

- Mongoose `@Schema({ timestamps: true, collection: 'chat_messages' })`
- Fields: `userId` (ObjectId, required, indexed), `role` (String enum `['user', 'assistant']`, required), `content` (String, required), `createdAt` (Date, auto)
- Compound index: `{ userId: 1, createdAt: 1 }`

### 2.5 Update User Schema (`apps/api/src/modules/users/schemas/user.schema.ts`)

- Add embedded `ai` subdocument: `{ requestsUsed: Number (default 0, min 0), bonusGranted: Boolean (default false) }`
- `default: () => ({ requestsUsed: 0, bonusGranted: false })`, `_id: false`
- Same pattern as existing `executions` subdocument
- Existing users without this field: guard uses `?? { requestsUsed: 0, bonusGranted: false }` fallback

### 2.6 AI Rate Limit Guard (`guards/ai-rate-limit.guard.ts`)

> **UPDATED** — account limit check removed from guard, now enforced atomically in `AiService.reserveChatRequest()`. Guard performs IP rate limit only.

- Implements `CanActivate`
- Injects: `RedisCounterService`
- IP rate limit (Redis Lua): atomic `INCR` + `EXPIRE`, check against `ENV.AI_CHAT_IP_LIMIT`. If exceeded → throw 429 `AI_RATE_LIMIT_EXCEEDED`
- Fail-closed: Redis error propagates as 500 → request blocked

### 2.7 DTO (`dto/ai-chat.dto.ts`)

- `createZodDto(AiChatRequestSchema)` — standard project pattern

### 2.8 AI Service (`ai.service.ts`)

> **UPDATED** — `finalizeChat` replaced by durable reservation pattern: `reserveChatRequest` → `commitChatRequest` → `refundChatRequest`. See [`../ai-chat-parallel-bypass/IMPLEMENTATION_PLAN.md`](../ai-chat-parallel-bypass/IMPLEMENTATION_PLAN.md) for full details.

- Injects: `AI_PROVIDER`, `ChatMessage` model, `User` model, `UsersService`
- System prompt constant: CyanShip company info + response guidelines
- `processChat(userMessage, signal?)`: calls `aiProvider.streamChat()` → returns Readable stream
- `reserveChatRequest(userId)`: atomic `findOneAndUpdate` — checks balance, account limit, single-flight guard, decrements balance, increments requestsUsed, sets activeReservation with compensationOps. Returns `AiChatReservationTicket`
- `commitChatRequest(ticket, userMessage, assistantContent)`: delegates to `usersService.commitReservation()` (MongoDB transaction: claim-first → fresh balance read → ledger insert → history insertMany). Returns `{ balanceAfter, aiRequestsRemaining }`
- `refundChatRequest(ticket)`: delegates to `usersService.refundReservation()` — catches errors internally
- `getHistory(userId)`: find messages sorted by `createdAt: 1`, map to `ChatMessageItem[]`
- `clearHistory(userId)`: `deleteMany({ userId })`

### 2.9 AI Controller (`ai.controller.ts`)

> **UPDATED** — controller refactored to durable reservation flow. See [`../ai-chat-parallel-bypass/IMPLEMENTATION_PLAN.md`](../ai-chat-parallel-bypass/IMPLEMENTATION_PLAN.md) for exit matrix.

- `@Controller('ai')`
- `POST /chat` — `@UseGuards(JwtActiveGuard, AiRateLimitGuard)`:
  1. `reserveChatRequest(userId)` — atomic reserve (any 4xx → HTTP error, no SSE headers yet)
  2. Set SSE headers
  3. Stream from provider with `firstTokenReceived` flag tracking
  4. Happy path: `commitChatRequest` → SSE DONE
  5. Client abort after first token: `commitChatRequest` (non-refundable, no SSE DONE)
  6. Client abort before first token / provider error: `refundChatRequest` in finally block
  7. `res.end()` in finally block
- `GET /chat/history` — `@UseGuards(JwtActiveGuard)`: returns `{ data: { messages } }`
- `DELETE /chat/history` — `@UseGuards(JwtActiveGuard)`: clears history, returns `{ data: { cleared: true } }`
- Uses `@Res()` manual response for SSE (NestJS `@Sse()` is for GET + Observables, not POST + streaming)

### 2.10 AI Module (`ai.module.ts`)

- Imports: `UsersModule`, `MongooseModule.forFeature([ChatMessage, User])`
- Providers: `AiService`, `AnthropicService`, `aiProviderProvider`, `AiRateLimitGuard`, `redisProvider`
- Controllers: `AiController`
- No exports needed — no other module depends on AiService

### 2.11 Register in AppModule

- Add `AiModule` to `imports` array in `apps/api/src/app.module.ts`

---

## Phase 3 — Backend: Brief-form AI Bonus

Modifies existing `AgencyModule` — no new module created.

### 3.1 Update Brief Schema (`apps/api/src/modules/agency/schemas/brief.schema.ts`)

- Add `requestAiBonus: Boolean, default false`
- Add `userId: ObjectId, default null` (optional — set server-side from JWT, null for anonymous brief from landing)

### 3.2 Update Brief Service (`apps/api/src/modules/agency/services/brief.service.ts`)

- After successful brief creation: if `requestAiBonus === true && userId` (from controller) → `userModel.findOneAndUpdate({ _id: userId, 'ai.bonusGranted': { $ne: true } }, { $set: { 'ai.bonusGranted': true } })` — atomic guard prevents duplicate bonus grants
- Return `aiBonusGranted: boolean` in response so frontend knows to refresh AI limits (false if bonus was already granted previously)
- AgencyModule needs User model access: add `MongooseModule.forFeature([{ name: User.name, schema: UserSchema }])` to AgencyModule imports if not already present

### 3.3 Brief Controller (`apps/api/src/modules/agency/brief.controller.ts`)

Two separate endpoints with clear contracts — no conditional auth logic in a single handler:

- `POST /agency/brief` — **existing, unchanged**. Public, no JWT, Turnstile CAPTCHA. Used by landing page anonymous form
- `POST /agency/brief/authenticated` — **new**, `@UseGuards(JwtActiveGuard)` + Turnstile. Used by AI chat brief-gate. `userId` taken from `req.user._id` (JWT), `requestAiBonus: true` set automatically by controller. `userId` NEVER comes from request body

Both endpoints call the same `BriefService.submit()` — one service, two entry points. Each endpoint has a clear, unconditional contract

---

## Phase 4 — Frontend: Chat UI

### 4.1 AI API Functions (`apps/web/src/shared/api/ai.ts`)

- `streamAiChat(message, onEvent, signal?)`: uses native `fetch` (not Axios — no streaming support). Sends POST with Bearer token from `getAccessToken()`. Parses SSE `data:` lines, calls `onEvent` callback for each parsed event
- `getChatHistory()`: standard Axios GET `/ai/chat/history` → returns `ChatMessageItem[]`
- `clearChatHistory()`: Axios DELETE `/ai/chat/history`
- `AiChatError` class with `code` and `status` for pre-stream HTTP errors
- Uses existing `getAccessToken()` already exported from `apps/web/src/shared/api/client.ts`

### 4.2 Chat Page (`apps/web/src/app/[locale]/(protected)/ai-chat/page.tsx`)

Separate full-page route under `(protected)` layout — inherits `AuthGuard`, header, and auth store hydration.

Layout: flex column, full viewport height (minus header). Standard AI chat UX:
- Header bar: title + "Clear history" button (when messages exist) + back link to dashboard
- Messages area: `flex-grow`, `overflow-y-auto`, auto-scroll to bottom. User messages right-aligned (primary bg), assistant left-aligned (muted bg), empty state text, loading pulse for streaming
- Footer: input + send button, sticky bottom (or brief-gate when exhausted). Cost info text below input

State:
- `messages: ChatMessage[]` — local state, hydrated from API on mount
- `input: string`, `isStreaming: boolean`, `isLimitExhausted: boolean`, `isLoadingHistory: boolean`
- `AbortController` ref for cleanup on unmount

On mount:
- `getChatHistory()` → populate messages, set `isLoadingHistory: false`

On submit:
- Add user message + empty assistant message to state
- Call `streamAiChat()` with callbacks:
  - `TOKEN` → append content to assistant message
  - `DONE` → update `authStore.user.executions.balance`, check `aiRequestsRemaining`
  - `ERROR` → toast via `getApiMessageKey()`
- On `AiChatError` (pre-stream): handle `AI_LIMIT_EXHAUSTED` (set `isLimitExhausted`), `AI_RATE_LIMIT_EXCEEDED` (toast), `INSUFFICIENT_EXECUTIONS` (toast)

### 4.3 Brief-gate (limit exhausted)

When `isLimitExhausted` — two states based on `user.ai.bonusGranted` from auth store:
- **`bonusGranted === false`**: replace input area with message "Free tries exhausted" + CTA button → `useBriefDialogStore.open({ requestAiBonus: true })`
- **`bonusGranted === true`**: replace input area with message "All tries exhausted" (no CTA, chat permanently closed)

Brief dialog store modifications (`apps/web/src/features/agency/brief/briefDialogStore.ts`):
- Add `requestAiBonus: boolean` to state (default false)
- `open(opts?)` sets `requestAiBonus` from opts
- `close()` resets `requestAiBonus` to false

BriefForm modifications (`apps/web/src/features/agency/brief/BriefForm.tsx`):
- Read `requestAiBonus` from brief dialog store, `user` from auth store
- If `requestAiBonus && user`: render name and email as plain text (`<p>`/`<span>`, not input fields) — values from auth store, not editable. Submit to `POST /agency/brief/authenticated` (not the public endpoint). Pass name + email in payload (no `userId` — server gets it from JWT, `requestAiBonus` set by server). Standard brief schema validation works unchanged for both forms
- On success when `requestAiBonus`: refresh auth store (getMe), close dialog — this rehydrates AI limits

### 4.4 Dashboard Teaser Card (`apps/web/src/app/[locale]/(protected)/dashboard/components/AiChatTeaser.tsx`)

- Compact card (uses `UiSectionCard`) rendered on dashboard **above** `SpendExecutionButtons`
- Shows: short AI integration description + CTA button (link to `/ai-chat`)
- Displays current state from auth store: remaining AI tries or "Limit exhausted"
- No chat logic — purely navigational

---

## Phase 5 — Translations (i18n)

### English (`apps/web/messages/en.json`)

Add `ai_chat_page`:
- `heading`, `placeholder`, `send`, `clear_history`, `empty_state`, `cost_info` (with `{cost}` param)
- `error_rate_limit`, `limit_exhausted`, `request_bonus`

Add `dashboard_page.ai_chat_teaser`:
- `heading`, `description`, `cta_button`, `tries_remaining` (with `{count}` param), `limit_exhausted`

Add `errors.ai`:
- `ai_limit_exhausted`, `ai_rate_limit_exceeded`, `ai_provider_error`

Add transaction action label for `ai_chat`

### Ukrainian (`apps/web/messages/uk.json`)

Mirror all keys above with Ukrainian translations.

---

## Phase 6 — Environment & Configuration

### `apps/api/src/config/env.ts`

- `ANTHROPIC_API_KEY`: `getEnvVar('ANTHROPIC_API_KEY')` — required, fail-fast
- `AI_CHAT_MAX_TOKENS`: `parseInt(getEnvVar('AI_CHAT_MAX_TOKENS'), 10)` — required, fail-fast (recommended: 300, ≈ 150–200 words)
- `AI_CHAT_IP_LIMIT`: `parseInt(getEnvVar('AI_CHAT_IP_LIMIT'), 10)` — required, fail-fast (recommended: 5)
- `AI_CHAT_FREE_LIMIT`: `parseInt(getEnvVar('AI_CHAT_FREE_LIMIT'), 10)` — required, fail-fast (recommended: 5)
- `AI_CHAT_BONUS_AMOUNT`: `parseInt(getEnvVar('AI_CHAT_BONUS_AMOUNT'), 10)` — required, fail-fast (recommended: 5)

### `.env.example`

Add AI section with all vars and comments.

### `apps/api/src/test-setup.ts`

Add fallback values for all AI env vars:
```
process.env.ANTHROPIC_API_KEY ??= 'test-anthropic-key';
process.env.AI_CHAT_MAX_TOKENS ??= '300';
process.env.AI_CHAT_IP_LIMIT ??= '5';
process.env.AI_CHAT_FREE_LIMIT ??= '5';
process.env.AI_CHAT_BONUS_AMOUNT ??= '5';
```

### Install SDK

`pnpm --filter api add @anthropic-ai/sdk`

---

## Phase 7 — Testing

> **OUTDATED** — testing plan below describes the original flow (finalizeChat, snapshot-based guard). Current billing/concurrency tests are in `apps/api/src/modules/ai/ai.service.spec.ts`, `ai.controller.spec.ts`, `apps/api/src/modules/users/users.service.spec.ts` (reservation core), and `apps/api/test/ai.e2e-spec.ts` (race, abort, reconcile, stale commit, double refund). See [`../ai-chat-parallel-bypass/IMPLEMENTATION_PLAN.md`](../ai-chat-parallel-bypass/IMPLEMENTATION_PLAN.md) §8 for authoritative test plan.

### Unit Tests (API) — historical

`ai.service.spec.ts`: now tests `reserveChatRequest`, `commitChatRequest`, `refundChatRequest` instead of `finalizeChat`.

`ai-rate-limit.guard.spec.ts`: account limit check removed; guard tests cover IP rate limit only.

### E2E Tests (API) — historical

`test/ai.e2e-spec.ts`: now covers race on balance/limit, abort before/after first token, cron reconcile, stale commit detection, double refund safety. Uses `MongoMemoryReplSet` for transaction support.

### Frontend Tests — unchanged

`AiChat.test.tsx` plan remains valid for UI behavior.

---

## Database Changes

### New Collection: `chat_messages`

| Field | Type | Index | Description |
|-------|------|-------|-------------|
| `userId` | ObjectId | compound | Message owner |
| `role` | String enum | — | `'user'` or `'assistant'` |
| `content` | String | — | Message text |
| `createdAt` | Date | compound | Auto-managed by timestamps |

Compound index: `{ userId: 1, createdAt: 1 }`

### User Schema: new `ai` subdocument

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `ai.requestsUsed` | Number | 0 | Lifetime AI request counter |
| `ai.bonusGranted` | Boolean | false | One-time bonus granted via brief form |

### Brief Schema: new fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `requestAiBonus` | Boolean | false | AI bonus request flag |
| `userId` | ObjectId | null | Authenticated user ID (set server-side from JWT, never from client) |

---

## Redis Key Schema

| Key Pattern | Type | TTL | Purpose |
|-------------|------|-----|---------|
| `ai:ip:{ip}` | Integer (counter) | 86,400s (24h) | Per-IP request count (spam protection) |

---

## Response Codes

> **UPDATED** — `EXECUTIONS_RESERVATION_ACTIVE` (409) added for concurrent request blocking. All codes below now returned from `AiService.reserveChatRequest()` (pre-SSE), except `AI_PROVIDER_ERROR` which is still SSE-only.

| Code | HTTP | When | Frontend Action |
|------|------|------|-----------------|
| `AI_LIMIT_EXHAUSTED` | 403 | Lifetime account limit reached | Show brief-gate CTA |
| `AI_RATE_LIMIT_EXCEEDED` | 429 | IP limit exceeded | Toast "try again later" |
| `INSUFFICIENT_EXECUTIONS` | 400 | Not enough balance | Toast "insufficient executions" |
| `EXECUTIONS_RESERVATION_ACTIVE` | 409 | Another request in progress | Toast "wait and retry" |
| `AI_PROVIDER_ERROR` | SSE event | AI provider failed mid-stream | Toast "AI unavailable" |

---

## API Endpoints (new)

| Method | Path | Guard | Description |
|--------|------|-------|-------------|
| POST | `/ai/chat` | `JwtActiveGuard`, `AiRateLimitGuard` | Send message, stream SSE response |
| GET | `/ai/chat/history` | `JwtActiveGuard` | Load saved chat messages |
| DELETE | `/ai/chat/history` | `JwtActiveGuard` | Clear chat history |
| POST | `/agency/brief/authenticated` | `JwtActiveGuard` + Turnstile | Authenticated brief submit with AI bonus |

---

## Files Changed

> **HISTORICAL** — file list below reflects the original AI chat sprint. Subsequent changes from the parallel-bypass sprint added/modified: `apps/api/src/modules/ai/interfaces/ai-chat-reservation.ts`, `apps/api/src/modules/users/interfaces/reservation.ts`, `apps/api/src/modules/users/reservation-reconcile.service.ts`, `apps/api/test/ai.e2e-spec.ts`. For full scope see [`../ai-chat-parallel-bypass/IMPLEMENTATION_PLAN.md`](../ai-chat-parallel-bypass/IMPLEMENTATION_PLAN.md).

### New Files

| File | Purpose |
|------|---------|
| `apps/api/src/modules/ai/ai.module.ts` | Module registration |
| `apps/api/src/modules/ai/ai.controller.ts` | POST /ai/chat (SSE) + GET/DELETE history |
| `apps/api/src/modules/ai/ai.service.ts` | Chat orchestration + history CRUD |
| `apps/api/src/modules/ai/interfaces/ai-provider.interface.ts` | Provider contract + DI token |
| `apps/api/src/modules/ai/providers/ai-provider.provider.ts` | Provider factory |
| `apps/api/src/modules/ai/providers/anthropic.service.ts` | Anthropic SDK adapter |
| `apps/api/src/modules/ai/guards/ai-rate-limit.guard.ts` | Redis IP limiter only (account limit moved to atomic reserve) |
| `apps/api/src/modules/ai/schemas/chat-message.schema.ts` | Chat message MongoDB schema |
| `apps/api/src/modules/ai/dto/ai-chat.dto.ts` | Zod DTO |
| `packages/types/src/contracts/ai-chat.ts` | Shared contracts + message types |
| `apps/web/src/shared/api/ai.ts` | Frontend SSE client + history API |
| `apps/web/src/app/[locale]/(protected)/ai-chat/page.tsx` | Full-page AI chat (standalone route) |
| `apps/web/src/app/[locale]/(protected)/dashboard/AiChatTeaser.tsx` | Dashboard teaser card with CTA link to chat |

### Modified Files

| File | Change |
|------|--------|
| `packages/types/src/contracts/executions.ts` | Add `AI_CHAT` action (debit only, NOT in SPENDABLE_ACTIONS) |
| `packages/types/src/contracts/index.ts` | Export ai-chat |
| `packages/types/src/agency/brief.ts` | No changes — `requestAiBonus` and `userId` are server-side only (Brief MongoDB schema, not client Zod schema) |
| `packages/types/src/entities/user.ts` | Add `ai` subdocument |
| `apps/api/src/app.module.ts` | Import `AiModule` |
| `apps/api/src/config/env.ts` | Add AI env vars |
| `apps/api/src/test-setup.ts` | Add AI env fallback |
| `apps/api/src/modules/users/schemas/user.schema.ts` | Add `ai` embedded subdocument |
| `apps/api/src/modules/agency/schemas/brief.schema.ts` | Add `requestAiBonus` + `userId` fields |
| `apps/api/src/modules/agency/brief.controller.ts` | Add `POST /agency/brief/authenticated` endpoint with `JwtActiveGuard` |
| `apps/api/src/modules/agency/services/brief.service.ts` | Grant AI bonus on brief submit |
| `apps/api/src/modules/agency/agency.module.ts` | Add User schema to imports (if not present) |
| `apps/web/src/shared/api/client.ts` | No changes needed — `getAccessToken()` already exported |
| `apps/web/src/shared/api/index.ts` | Export ai module |
| `apps/web/src/app/[locale]/(protected)/dashboard/page.tsx` | Add AiChatTeaser card above spend buttons |
| `apps/web/src/features/agency/brief/briefDialogStore.ts` | Add `requestAiBonus` state |
| `apps/web/src/features/agency/brief/BriefForm.tsx` | Plain text name/email (readonly from auth store) + AI bonus flag |
| `apps/web/messages/en.json` | AI chat + brief-gate translations |
| `apps/web/messages/uk.json` | AI chat + brief-gate translations |
| `.env.example` | AI env vars |

### New Dependencies

| Package | Workspace | Purpose |
|---------|-----------|---------|
| `@anthropic-ai/sdk` | `apps/api` | Anthropic API client |

---

## Tech Debt (out of scope)

- **Turnstile on auth**: CAPTCHA only on brief form, not on registration. Separate sprint: `docs/sprints/auth-turnstile-sprint.md`.
- **Chat history cap**: Currently max ~20 messages per user (10 requests × 2 messages). If limits grow, add hard cap or TTL-based cleanup on `chat_messages` collection.

---

## Dependency Order

```
Phase 1 (types)  ─── must be first, everything imports from @cyanship/types
    │
    ├── Phase 6 (env/config) ─── can be parallel with Phase 2
    │
    ├── Phase 2 (backend: AI module) ─── needs types for DTO + cost map
    │       │
    │       └── Phase 3 (backend: brief bonus) ─── modifies existing AgencyModule
    │
    ├── Phase 5 (i18n) ─── can be parallel with Phase 2
    │
    └── Phase 4 (frontend) ─── needs working API endpoints
            │
            └── Phase 7 (testing) ─── after all code
```
