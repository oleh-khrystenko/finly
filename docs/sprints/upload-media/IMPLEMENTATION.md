# Upload Media — Technical Implementation Plan

> Технічна специфікація для AI agents. Кожен крок — самодостатній блок з файлами та архітектурними рішеннями.

---

## Передумови

Перед початком прочитай:
- `docs/conventions/tone.md` — стиль user-facing повідомлень
- `docs/conventions/fail-fast.md` — env vars policy
- `docs/conventions/i18n.md` — response codes → i18n keys
- `docs/conventions/ui-primitives.md` — заборонені raw HTML елементи
- `docs/conventions/design-tokens.md` — кольори тільки через токени
- `docs/conventions/overlays.md` — overlay store + mount pattern
- `docs/sprints/upload-media/README.md` — продуктова специфікація та прийняті рішення

---

## Огляд архітектури

### Request Flow: Avatar Upload

**Етап 1 — отримання presigned URL:**
Клієнт робить `POST /storage/avatar/upload-url` (JwtActiveGuard). `StorageController` делегує в `StorageService.createAvatarUploadUrl(userId)`, який генерує file key у форматі `avatars/{userId}/{uuid}.webp`, запитує presigned PUT URL через `IStorageProvider.generatePresignedUploadUrl({ key, contentType })`, і повертає `{ uploadUrl, fileKey }`.

**Етап 2 — direct upload:**
Клієнт завантажує файл напряму в R2 через presigned PUT URL з фіксованим header `Content-Type: image/webp`. API сервер не проксює файл. Будь-яке відхилення від signed `Content-Type` призведе до 403 з боку R2 (`SignatureDoesNotMatch`).

**Розмір файлу НЕ підписується в presigned PUT URL** — це навмисне рішення, не упущення. Причини:
- `Content-Length` у Fetch API — **forbidden request header** (MDN). Браузер автоматично встановлює його з blob body, клієнт не може контролювати програмно
- Signed `ContentLength` у presigned PUT — це **exact match**, не upper bound (S3/R2 включає його в canonical request буквально). Upper-bound семантика (`content-length-range`) існує тільки для presigned POST через policy
- Тому клієнтський upper-bound контроль через PUT неможливий без EXACT-size flow (розмір blob мусить відомий ДО генерації URL, що ламає UX streaming flow)

Size enforcement реалізовано як **defense-in-depth на application layer** — див. Етап 3.

**Етап 3 — commit:**
Клієнт робить `POST /storage/avatar/commit` з `{ fileKey }` (JwtActiveGuard). `StorageService.commitAvatarUpload(userId, fileKey)` виконує:
1. Валідація ownership — fileKey повинен починатися з `avatars/{userId}/`
2. Idempotency guard — якщо `profile.avatar` вже дорівнює public URL для цього fileKey, повернути existing URL без повторних операцій (захист від подвійного commit)
3. Перевірка існування та metadata через `IStorageProvider.getObjectMetadata(key)` (HeadObject). Валідація: `contentType === 'image/webp'`, `contentLength <= AVATAR.MAX_FILE_SIZE`
4. **При невідповідності розміру** — виклик `IStorageProvider.deleteObject(key)` (cleanup), потім `BadRequestException` з кодом `AVATAR_UPLOAD_INVALID`. Це гарантує, що oversized orphan не залишається у bucket
5. Побудова public URL з fileKey
6. Оновлення `user.profile.avatar` новим URL через `UsersService.updateProfile()`
7. Видалення старого файлу з R2 через `safeDeleteR2File()` (якщо старий URL належить R2)
8. Повернення нового public URL у response

Клієнт використовує `avatar` з response для оновлення `authStore` напряму — без додаткового `getMe()`. Єдиний round-trip, одне джерело правди (response API).

**Видалення аватарки:**
`DELETE /storage/avatar` (JwtActiveGuard). `StorageService.deleteAvatar(userId)` очищує `profile.avatar` через `UsersService.clearAvatar()` (MongoDB `$unset`), потім видаляє файл з R2 через `safeDeleteR2File()`.

### Provider Abstraction

Слідуємо встановленому патерну `AI_PROVIDER` → `AnthropicService` та `PAYMENT_PROVIDER` → `StripeService`:

| Компонент | Файл | Відповідальність |
|-----------|------|------------------|
| Interface + token | `interfaces/storage-provider.interface.ts` | `IStorageProvider` + `STORAGE_PROVIDER` Symbol |
| Provider factory | `providers/storage-provider.provider.ts` | Маппінг `STORAGE_PROVIDER` → `CloudflareR2Service` |
| Implementation | `providers/cloudflare-r2.service.ts` | S3Client (R2-compatible) |
| Business logic | `storage.service.ts` | Avatar lifecycle, URL management |
| HTTP endpoints | `storage.controller.ts` | REST API |

### IStorageProvider — контракт

| Метод | Призначення | Деталі |
|-------|-------------|--------|
| `generatePresignedUploadUrl({ key, contentType })` | Presigned PUT URL для direct upload | `PutObjectCommand` з полем `ContentType` (прив'язка MIME до signature). Клієнт мусить відправити рівно такий самий `Content-Type` header, інакше R2 → 403. Розмір на рівні transport **не підписується** (див. "Size enforcement story" нижче). TTL presigned URL — 5 хвилин |
| `getObjectMetadata(key)` | Metadata uploaded файлу | HeadObject. Повертає `{ exists, contentType, contentLength }` або `{ exists: false }`. Використовується в commit і для верифікації існування, і для enforcement розміру |
| `deleteObject(key)` | Видалення файлу | Заміна/видалення аватарки + **cleanup oversized uploads** при rejection у commit |
| `uploadBuffer({ key, buffer, contentType })` | Server-side upload | Google avatar re-upload |

**Чому немає `downloadToBuffer`:** Завантаження з зовнішнього URL — це HTTP операція (`fetch`), не відповідальність storage provider'а. Ідентична для R2, S3, GCS. Реалізується в `StorageService` напряму.

### Size enforcement story (defense-in-depth)

Upper-bound ліміт розміру файлу enforced **не на transport layer**, а на application layer — через три шари:

| Шар | Механізм | Що ловить | Що пропускає |
|-----|----------|-----------|--------------|
| **1. Client-side pre-upload** | JS-валідація `file.size > AVATAR.MAX_FILE_SIZE` перед crop | Звичайний user flow — великий файл з file picker | Зловмисник з DevTools / власним HTTP клієнтом |
| **2. Commit-time HeadObject check** | API робить `HeadObject` при commit, перевіряє `contentLength <= AVATAR.MAX_FILE_SIZE` | Oversized файли, які обійшли client validation | Файл уже спожив R2 bandwidth (ingress безкоштовний у Cloudflare) і short-term storage до cleanup |
| **3. Rate limiting на presigned URL endpoint** | Глобальний `ThrottlerGuard` (60 req/min) на `POST /storage/avatar/upload-url` | DoS через масовий upload orphan-файлів | — |

**Attack surface:** authenticated user може upload'нути файл >5 MB у свій `avatars/{userId}/` namespace. Commit відхилить його (`AVATAR_UPLOAD_INVALID`) і **одразу видалить** файл через `deleteObject`. Максимальна шкода — тимчасовий storage spike (кілька секунд) у namespace самого користувача. Rate limit обмежує частоту.

**Що НЕ обирали і чому:**
- **Presigned POST з `content-length-range` policy** — справжній bucket-level upper bound, але вимагає multipart/form-data на клієнті (через `@aws-sdk/s3-presigned-post`). Для малих аватарок під auth це overengineering; для майбутніх media-типів (відео, великі файли) — правильний апгрейд шлях
- **Signed `ContentLength` у presigned PUT** — архітектурно неможливо як upper bound: `Content-Length` — forbidden header у Fetch API (браузер встановлює автоматично з blob); signed значення у PUT — exact match, не range
- **R2 bucket-level `s3:ObjectSize` constraint** — R2 не підтримує цю S3 IAM condition нативно

### File Key Convention

Формат: `avatars/{userId}/{uuid}.webp`
- `userId` — MongoDB ObjectId (24 hex), namespace ізоляція
- `uuid` — будь-який стандартний UUID (36 символів з `-`), cache busting. Генерується через `crypto.randomUUID()` (поточно v4), але regex у Zod схемі — version-agnostic для forward compatibility
- `.webp` — єдиний вихідний формат (клієнт конвертує перед upload, сервер конвертує Google avatar через `sharp`)

### R2 URL Detection

Для розрізнення R2 URL від зовнішніх (Google): перевірка чи URL починається з `ENV.R2_PUBLIC_URL`. Якщо URL зовнішній — операція видалення зі storage пропускається. Витягування key з URL — відсікання prefix + `/`.

### Env sync invariant: R2_PUBLIC_URL ↔ NEXT_PUBLIC_STORAGE_HOSTNAME

Backend потребує повний URL (для побудови public avatar URL + R2 URL detection), frontend — тільки hostname (для `next/image` `remotePatterns`). Дві окремі змінні, але **hostname з `R2_PUBLIC_URL` мусить дорівнювати `NEXT_PUBLIC_STORAGE_HOSTNAME`** — інакше `next/image` блокуватиме завантажене фото.

Цей інваріант перевіряється ліниво runtime'ом (Next.js кине зрозумілу помилку при першій rendering спробі). У dev це виявляється одразу. Альтернатива — centralized check у `env.ts` web-додатку, який порівнює `new URL(envRequired('NEXT_PUBLIC_API_URL')).hostname` не підходить, бо API і storage — різні CDN. Тому контракт документується явно, і `NEXT_PUBLIC_STORAGE_HOSTNAME` окремо задається DevOps'ом при деплої.

### Обробка orphaned файлів

Два сценарії orphaned файлів у R2:

1. **Upload succeeded, commit failed** (клієнт завантажив файл, але не зробив commit або commit впав). Файл залишається в R2 без прив'язки до профілю. На поточному етапі — прийнятний trade-off (аватарки маленькі, ~50-200 KB). Задокументовано у `docs/sprints/upload-media/README.md` секції "Known Limitations". При масштабуванні — додати TTL cron який видаляє файли в `avatars/` без відповідного запису в БД.

2. **Replacement: old file deletion failed** (нова аватарка збережена, видалення старого файлу з R2 впало). Нова аватарка працює, старий файл orphaned. Best-effort await з `logger.warn` — краще orphaned файл ніж відкат успішного upload.

---

## Крок 1: Shared types — contracts, constants, response codes

**Файли:**
- `packages/types/src/constants/storage.ts` (новий)
- `packages/types/src/constants/index.ts` (оновити — додати re-export)
- `packages/types/src/contracts/storage.ts` (новий)
- `packages/types/src/contracts/index.ts` (оновити — додати re-export)
- `packages/types/src/enums/response-code.ts` (оновити)

### 1.1. Storage constants

Файл: `packages/types/src/constants/storage.ts`

Об'єкт `AVATAR` з полями:

| Поле | Значення | Призначення |
|------|----------|-------------|
| `MAX_FILE_SIZE` | 5 MB (5 × 1024 × 1024) | Ліміт на розмір файлу після crop+WebP. Shared константа: клієнтська pre-upload валідація + серверна валідація через `HeadObject` при commit (див. "Size enforcement story") |
| `OUTPUT_SIZE` | 512 | Квадратні px, фіксований розмір canvas (клієнт) і `sharp.resize` (бекенд, Google re-upload) |
| `OUTPUT_FORMAT` | `'image/webp'` | Єдиний allowed content type після crop. Signed у presigned URL |
| `OUTPUT_QUALITY` | 0.85 | Єдина крапка істини для quality: клієнтський `canvas.toBlob` і серверний `sharp.webp({ quality })` |
| `ALLOWED_MIME_TYPES` | `['image/jpeg', 'image/png', 'image/webp']` | Валідація **вхідного** файлу перед crop (що користувач може обрати у file picker). **Вихідний** формат завжди WebP. HEIC свідомо виключений — див. README секцію "Прийняті рішення" (libheif-деривативи мають LGPL-3.0, несумісні з permissive-профілем; iOS Safari ≥14 auto-конвертує HEIC → JPEG у file picker, якщо accept не містить HEIC MIME) |

Тип: `as const` для literal inference на фронті та бекенді.

### 1.2. Storage contracts

Файл: `packages/types/src/contracts/storage.ts`

**`CommitAvatarUploadSchema`** — Zod schema з одним полем `fileKey: z.string().regex(...)`. Regex валідує формат `avatars/{objectId}/{uuid}.webp`:
- 24-символьний hex ObjectId
- 36-символьний UUID, version-agnostic (формат `[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`, без фіксації v4-префіксу) — це гарантує forward compatibility при переході на UUID v7+
- `.webp` суфікс

**`AvatarUploadUrlResponse`** — TypeScript interface: `{ uploadUrl: string; fileKey: string }`.

**`CommitAvatarUploadResponse`** — TypeScript interface: `{ avatar: string }` (новий public URL).

### 1.3. Response codes

Файл: `packages/types/src/enums/response-code.ts`

Нові коди та їх маппінг на `RESPONSE_TYPE`. Окремі коди для різних failure modes — для точних i18n повідомлень та проблеми-specific UX:

| Код | Тип | Коли генерується |
|-----|-----|------------------|
| `AVATAR_UPDATED` | SUCCESS | Avatar успішно оновлено (після commit) |
| `AVATAR_DELETED` | SUCCESS | Avatar успішно видалено |
| `AVATAR_UPLOAD_FAILED` | ERROR | Узагальнена помилка upload pipeline (presigned URL generation, мережа тощо) |
| `AVATAR_FILE_KEY_INVALID` | ERROR | fileKey не належить поточному userId (ownership fail) або не відповідає regex схемі |
| `AVATAR_UPLOAD_NOT_FOUND` | ERROR | Файл не знайдено в R2 при commit (клієнт не завершив upload або presigned URL expired) |
| `AVATAR_UPLOAD_INVALID` | ERROR | Файл існує в R2, але metadata не відповідає очікуваному (неправильний MIME або розмір перевищує ліміт) |

---

## Крок 2: Environment — env vars та інфраструктура

**Файли:**
- `apps/api/src/config/env.ts` (оновити)
- `apps/web/src/shared/config/env.ts` (оновити)
- `.env` (оновити)
- `.env.example` (оновити)
- `apps/api/src/test-setup.ts` (оновити)
- `apps/api/Dockerfile` (потенційно оновити — див. 2.5)

### 2.1. Backend env vars

Файл: `apps/api/src/config/env.ts` — додати через `getEnvVar()` (fail-fast):

| Змінна | Призначення |
|--------|-------------|
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret |
| `R2_BUCKET_NAME` | Bucket name (`cyanship-media`) |
| `R2_PUBLIC_URL` | CDN public URL (e.g. `https://media.cyanship.com`) — hostname мусить збігатись з `NEXT_PUBLIC_STORAGE_HOSTNAME` на web |

### 2.2. Frontend env var

Файл: `apps/web/src/shared/config/env.ts` — додати через fail-fast helper:

| Змінна | Призначення |
|--------|-------------|
| `NEXT_PUBLIC_STORAGE_HOSTNAME` | Hostname R2 CDN для `next/image` remote patterns. Мусить бути hostname з `R2_PUBLIC_URL` (API) |

### 2.3. .env та .env.example

Додати всі 6 змінних (5 backend + 1 frontend). У `.env` — реальні dev credentials. У `.env.example` — placeholder значення з коментарем про sync-інваріант між `R2_PUBLIC_URL` і `NEXT_PUBLIC_STORAGE_HOSTNAME`.

### 2.4. Test setup

Файл: `apps/api/src/test-setup.ts` — додати 5 backend R2 змінних через `??=` оператор (placeholder values). Слідувати існуючому патерну.

### 2.5. Sharp на Alpine — верифікаційний крок (не безумовна правка Dockerfile)

Файл: `apps/api/Dockerfile` (base: `node:20-alpine`)

Sharp 0.33+ дистрибутує prebuilt binaries для Linux musl (включно з Alpine) через npm optional-dependencies. За нормальних умов на `node:20-alpine` з актуальною версією sharp **жодних правок Dockerfile не потрібно** — prebuilt libvips підтягується автоматично під час `pnpm install`.

**Що треба зробити на етапі імплементації:**

1. Додати sharp у `apps/api/package.json` (див. Крок 3.1)
2. Зібрати Docker image локально: `docker compose -f docker-compose.dev.yml build api` (або еквівалент)
3. Запустити контейнер і перевірити, що sharp завантажується без помилок. Найпростіший тест — додати тимчасовий startup log або виконати `node -e "require('sharp')"` у контейнері
4. **Якщо sharp завантажується коректно — Dockerfile не чіпати**. Це очікуваний результат для стандартного `node:20-alpine` x64/arm64

**Якщо sharp не працює (рідкісний випадок):**

| Симптом | Ймовірна причина | Фікс |
|---------|------------------|------|
| `Could not load the "sharp" module using the linuxmusl-<arch> runtime` | Prebuilt для архітектури build host'а відсутній або заблокований корпоративним proxy до npm CDN | Явно встановити libvips з apk: `apk add --no-cache vips` у runtime stage |
| Помилка під час `pnpm install` щодо native compilation | Lockfile примушує build-from-source, або sharp version не має prebuilt для musl | Оновити sharp до актуальної версії; у крайньому разі — додати `vips-dev` у build stage для source compilation |
| Runtime-помилка про відсутність libvips.so | Prebuilt підтягнувся, але симлінки/shared libs мають конфлікт | Додати `vips` у runtime stage як fallback |

**Принципове рішення** (зафіксоване навмисно): не додаємо apk install як превентивний захід. Pre-emptive встановлення vips збільшить Docker image на ~10 MB і приховає реальний стан prebuilt-розподілу. Додаємо тільки якщо верифікаційний крок виявить проблему.

### 2.6. R2 Bucket CORS конфігурація

**Інфраструктурний крок (Cloudflare Dashboard), не код.** Presigned upload з браузера — cross-origin запит (web domain → R2 endpoint). Без CORS конфігурації браузер заблокує upload.

Налаштувати в Cloudflare Dashboard → R2 → Bucket Settings → CORS:
- `AllowedOrigins` — web domain(s): `http://localhost:3000` (dev) + production domain
- `AllowedMethods` — тільки `PUT`
- `AllowedHeaders` — `Content-Type` (єдиний header, який клієнт встановлює вручну; `Content-Length` виставляється браузером і CORS whitelisting для нього не потрібен)
- `MaxAgeSeconds` — 3600

---

## Крок 3: NPM dependencies

### 3.1. Backend (`apps/api`)

| Package | Призначення |
|---------|-------------|
| `@aws-sdk/client-s3` | S3-compatible client для R2 (PutObject, DeleteObject, HeadObject) |
| `@aws-sdk/s3-request-presigner` | Генерація presigned URLs |
| `sharp` | Server-side image processing (Google avatar → WebP 512×512). Prebuilt binary для Alpine musl підтягується автоматично; верифікація у Docker — крок 2.5 |

### 3.2. Frontend (`apps/web`)

| Package | Призначення |
|---------|-------------|
| `react-easy-crop` | Crop UI з круглою маскою, zoom, drag, pinch-to-zoom |

---

## Крок 4: Provider abstraction

**Файли (всі нові):**
- `apps/api/src/modules/storage/interfaces/storage-provider.interface.ts`
- `apps/api/src/modules/storage/providers/cloudflare-r2.service.ts`
- `apps/api/src/modules/storage/providers/storage-provider.provider.ts`

### 4.1. Provider interface

Файл: `apps/api/src/modules/storage/interfaces/storage-provider.interface.ts`

Визначає `IStorageProvider` interface (4 методи — див. таблицю в "Огляді архітектури"), допоміжні типи:
- `PresignedUploadResult` — `{ uploadUrl: string; key: string }`
- `ObjectMetadata` — discriminated union: `{ exists: true; contentType: string; contentLength: number } | { exists: false }`

Symbol token `STORAGE_PROVIDER`.

### 4.2. Cloudflare R2 implementation

Файл: `apps/api/src/modules/storage/providers/cloudflare-r2.service.ts`

Injectable NestJS service що імплементує `IStorageProvider`. Використовує `S3Client` з `@aws-sdk/client-s3` (R2 — S3-compatible). Конфігурація з `ENV`: endpoint `https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, region `auto`, credentials з env vars.

Реалізація методів:
- `generatePresignedUploadUrl` — `PutObjectCommand` з полями `Bucket`, `Key`, `ContentType`. Signed URL через `getSignedUrl()` з `@aws-sdk/s3-request-presigner`, TTL 5 хвилин. `Content-Type` прив'язується до signature — клієнт мусить відправити header з тим самим значенням. `ContentLength` НЕ передається (див. "Size enforcement story" в огляді архітектури)
- `getObjectMetadata` — `HeadObjectCommand`. На 404/NoSuchKey повертає `{ exists: false }`. На success повертає `{ exists: true, contentType, contentLength }`
- `deleteObject` — `DeleteObjectCommand`
- `uploadBuffer` — `PutObjectCommand` з `Body: buffer` та `ContentType`

### 4.3. Provider factory

Файл: `apps/api/src/modules/storage/providers/storage-provider.provider.ts`

NestJS `Provider` object: `provide: STORAGE_PROVIDER`, `useClass: CloudflareR2Service`. Стандартний патерн як `aiProviderProvider` і `paymentProviderProvider`.

---

## Крок 5: Storage module, service та controller

**Файли:**
- `apps/api/src/modules/storage/storage.module.ts` (переписати scaffold)
- `apps/api/src/modules/storage/storage.service.ts` (переписати scaffold)
- `apps/api/src/modules/storage/storage.controller.ts` (новий)
- `apps/api/src/modules/storage/dto/commit-avatar-upload.dto.ts` (новий)
- `apps/api/src/modules/users/users.service.ts` (оновити — додати `clearAvatar`)

### 5.1. Storage module

Файл: `apps/api/src/modules/storage/storage.module.ts`

- **imports:** `UsersModule` (для доступу до `UsersService`)
- **controllers:** `StorageController`
- **providers:** `StorageService`, `CloudflareR2Service`, `storageProviderProvider`
- **exports:** `StorageService` — потрібен `AuthModule` для Google avatar re-upload (крок 6)

### 5.2. Storage DTO

Файл: `apps/api/src/modules/storage/dto/commit-avatar-upload.dto.ts`

`createZodDto(CommitAvatarUploadSchema)` — стандартний патерн як всі інші DTO в проєкті.

### 5.3. Storage service

Файл: `apps/api/src/modules/storage/storage.service.ts`

**Dependencies:** `@Inject(STORAGE_PROVIDER) IStorageProvider`, `UsersService`.

**Публічні методи:**

| Метод | Input | Output | Логіка |
|-------|-------|--------|--------|
| `createAvatarUploadUrl(userId)` | userId | `{ uploadUrl, fileKey }` | Генерує key `avatars/{userId}/{uuid}.webp`, запитує presigned URL через provider з `contentType='image/webp'` |
| `commitAvatarUpload(userId, fileKey)` | userId, fileKey | `string` (publicUrl) | 1) ownership check, 2) idempotency guard (якщо `user.profile.avatar === newPublicUrl` — no-op, return existing), 3) `getObjectMetadata`, 4) валідація metadata — `contentType === 'image/webp'`, `contentLength <= AVATAR.MAX_FILE_SIZE`; при rejection викликати `deleteObject(key)` для cleanup oversized/wrong-type файлу, 5) `updateProfile` з новим avatar, 6) `safeDeleteR2File(oldUrl)` для старого |
| `deleteAvatar(userId)` | userId | `void` | Отримує поточний avatar URL, очищує через `clearAvatar` ($unset), видаляє файл через `safeDeleteR2File` |
| `reUploadExternalAvatar(userId, externalUrl)` | userId, URL | `string` (publicUrl) | Завантажує зовнішнє зображення через `fetch`, конвертує через `sharp` (resize 512×512 cover + WebP quality=`AVATAR.OUTPUT_QUALITY`), upload через provider `uploadBuffer`, повертає public URL |

**Приватні helpers:**

| Метод | Призначення |
|-------|-------------|
| `buildPublicUrl(key)` | Конкатенація `ENV.R2_PUBLIC_URL` + `/` + key. Єдина точка побудови public URL — використовується і в `commit`, і в `reUploadExternalAvatar` |
| `isR2Url(url)` | Перевіряє чи URL починається з `ENV.R2_PUBLIC_URL` |
| `extractKeyFromR2Url(url)` | Витягує key з повного R2 URL (відсікає prefix) |
| `safeDeleteR2File(url)` | Якщо URL належить R2 — `await provider.deleteObject(...)` в try/catch з `logger.warn`. Блокуючий виклик (await), але помилка не пробрасується далі: це best-effort cleanup, не критичний шлях. Якщо URL зовнішній — no-op |

**Архітектурні рішення:**

1. **`getObjectMetadata` + валідація при commit = авторитетний size enforcement** — MIME прив'язаний до signature presigned URL (transport-level захист), але розмір — ні (архітектурне обмеження PUT + forbidden Content-Length). Тому commit — єдине місце, де ліміт реально enforced. При rejection `deleteObject(key)` викликається **перед** кидком exception: інакше oversized файл залишається у bucket.

2. **Idempotency guard в commit** — клієнт може повторити commit (мережева помилка + retry). Без guard'а другий commit викличе `safeDeleteR2File(oldUrl)` де `oldUrl` = актуальний URL, що призведе до видалення щойно збереженого файлу. Guard порівнює `user.profile.avatar` з обчислюваним `buildPublicUrl(fileKey)` — якщо збігаються, повертає existing URL без мутацій.

3. **`commitAvatarUpload` повертає `string`** — controller використовує результат напряму у response, фронт отримує новий avatar URL з тієї ж самої відповіді без додаткового `getMe()`.

4. **`reUploadExternalAvatar` конвертує через `sharp`** — Google avatar (JPEG/PNG довільного розміру) проходить повноцінну конвертацію: resize 512×512 (cover + centre) → WebP quality=`AVATAR.OUTPUT_QUALITY`. Гарантує що файл в R2 дійсно WebP з правильними розмірами, а не JPEG з `.webp` розширенням.

5. **HTTP download в `StorageService`, не в provider** — `fetch()` зовнішнього URL це HTTP операція, а не storage-specific. Provider відповідає тільки за свій storage.

6. **`safeDeleteR2File` — блокуючий await, не fire-and-forget** — справжнє fire-and-forget (без `await`) створює unhandled promise rejection при помилці. Правильний патерн: `await` з внутрішнім try/catch і `logger.warn`. Це додає ~50-100ms до response, але гарантує, що логи фіксують всі невдачі cleanup'у.

### 5.4. Storage controller

Файл: `apps/api/src/modules/storage/storage.controller.ts`

Prefix: `storage`. Guard на рівні controller: `JwtActiveGuard`.

| Метод | Шлях | HTTP Code | Body | Response | Деталі |
|-------|------|-----------|------|----------|--------|
| POST | `/storage/avatar/upload-url` | 201 | — | `{ data: { uploadUrl, fileKey } }` | Генерація presigned URL |
| POST | `/storage/avatar/commit` | 200 | `{ fileKey }` (Zod validated) | `{ data: { avatar: string, code: 'AVATAR_UPDATED' } }` | Commit upload, повертає новий avatar URL + success code для toast |
| DELETE | `/storage/avatar` | 200 | — | `{ data: { code: 'AVATAR_DELETED' } }` | Видалення аватарки |

**Error mapping у service → HTTP:**
- Ownership fail / regex fail → `BadRequestException` з кодом `AVATAR_FILE_KEY_INVALID`
- `getObjectMetadata.exists === false` → `BadRequestException` з кодом `AVATAR_UPLOAD_NOT_FOUND`
- ContentType/ContentLength mismatch → `deleteObject(key)` (cleanup), потім `BadRequestException` з кодом `AVATAR_UPLOAD_INVALID`
- Інше (presigned generation failure, delete failure) → `InternalServerErrorException` з кодом `AVATAR_UPLOAD_FAILED`

### 5.5. Метод `clearAvatar` в UsersService

Файл: `apps/api/src/modules/users/users.service.ts`

Новий метод `clearAvatar(userId)` — `findByIdAndUpdate` з `$unset: { 'profile.avatar': 1 }`.

**Чому окремий метод, а не `updateProfile({ avatar: '' })`:** `UpdateProfileSchema` валідує `avatar: z.string().url().optional()` — порожній рядок не пройде валідацію, а `null` теж не прийнятний. Замість засмічування загального schema edge-case'ами — окремий метод з чітким intent і чистим `$unset`.

---

## Крок 6: Google OAuth avatar re-upload

**Файли:**
- `apps/api/src/modules/auth/auth.module.ts` (оновити)
- `apps/api/src/modules/auth/auth.service.ts` (оновити — re-upload в `handleGoogleAuth`)

### 6.1. Module dependency

Додати `StorageModule` в imports `AuthModule`.

**Щодо dependency chain:** `AuthModule → StorageModule → UsersModule ↔ AuthModule`. `AuthModule ↔ UsersModule` вже пов'язані через `forwardRef` (existing circular). `StorageModule → UsersModule` — одностороння залежність, не створює нового circular. Nest DI обробляє це коректно.

### 6.2. Re-upload у `AuthService.handleGoogleAuth`

**Архітектурне рішення — re-upload у service, не в controller.** Controller це transport layer: валідація DTO, cookie management, response envelope. Storage lifecycle логіка (перевірка що URL не R2, виклик re-upload, оновлення profile) — частина `handleGoogleAuth` business flow. Інакше:
- Controller отримує доступ до `StorageService`, чого раніше не було — порушення інкапсуляції
- `auth.controller.spec.ts` змушений мокати storage — тести розмиваються між транспортом і логікою
- `auth.service.spec.ts` не покриє новий flow

**Зміни у `AuthService`:**
- Додати `StorageService` у constructor dependencies (через forwardRef якщо треба через circular, хоча поточна схема не повинна вимагати)
- У `handleGoogleAuth`, після `findOrCreateByGoogle(googleProfile)`, **перед** `generateTokens`:
  - Якщо `user.profile.avatar` існує І `!storageService.isR2Url(user.profile.avatar)` → викликати re-upload і оновити profile
  - Обгорнути у try/catch з `logger.warn` — re-upload non-critical. При помилці зовнішній Google URL залишається як fallback. При наступному login буде нова спроба

**Sync vs async trade-off (явно зафіксоване рішення):**
- Re-upload **синхронний** у callback flow. OAuth callback затримується на `fetch(googleUrl) + sharp.resize + uploadBuffer` — типово 300-800ms для файлу <100 KB
- **Чому не fire-and-forget:** при async re-upload user отримує redirect, `authStore` hydrate'иться зі старим Google URL, і тільки через ~1 секунду аватарка "стрибне" на R2 URL без явного тригера — погана UX. Плюс unhandled rejection risk
- **Чому не job queue:** queue додає інфраструктурну складність (у проєкті немає існуючого queue-системи) і той самий UX issue — перший відкритий profile/header показує Google URL
- **Прийнятий trade-off:** синхронна затримка OAuth callback у межах 300-800ms це менше зло, ніж UX-стрибок. У README зафіксовано явно

**Поведінка:**
- Перший signup через Google → `findOrCreateByGoogle` зберігає Google URL → `handleGoogleAuth` робить re-upload і оновлює profile → tokens видаються → redirect
- Повторний login → `findOrCreateByGoogle` не перезаписує existing avatar → re-upload тригериться тільки якщо avatar ще зовнішній (legacy users з pre-sprint часу)
- Re-upload fail → warn + продовження з Google URL → наступний login пробує знову

### 6.3. Controller — без змін

`AuthController.googleCallback` залишається без модифікацій. Весь storage flow живе у `AuthService` — transport layer чистий.

---

## Крок 7: Frontend — API integration

**Файли:**
- `apps/web/src/shared/api/storage.ts` (новий)
- `apps/web/src/shared/api/index.ts` (оновити — додати exports)

### 7.1. Storage API functions

Файл: `apps/web/src/shared/api/storage.ts`

Три функції, всі використовують `apiClient` (Bearer token автоматично через interceptor):

| Функція | HTTP | Path | Body | Response |
|---------|------|------|------|----------|
| `requestAvatarUploadUrl()` | POST | `/storage/avatar/upload-url` | — | `AvatarUploadUrlResponse` |
| `commitAvatarUpload(fileKey)` | POST | `/storage/avatar/commit` | `{ fileKey }` | `CommitAvatarUploadResponse` (`{ avatar }`) |
| `deleteAvatar()` | DELETE | `/storage/avatar` | — | void |

Слідувати існуючому патерну з `shared/api/auth.ts` — unwrap `{ data: ... }` envelope.

### 7.2. Direct R2 upload helper

Файл: `apps/web/src/shared/api/storage.ts` (там же)

Функція `uploadToR2(uploadUrl, blob)` — використовує native `fetch` (не `apiClient`, бо це cross-origin R2, не наш API). Header: `Content-Type: image/webp`. Жодних Bearer токенів.

**Важливо:** `Content-Type` мусить точно збігатись з тим, що підписав бекенд у presigned URL — інакше R2 поверне 403 (`SignatureDoesNotMatch`). `Content-Length` встановлюється браузером автоматично з blob і не керується клієнтом — це forbidden request header у Fetch API.

---

## Крок 8: Frontend — `UiAvatarButton` primitive

**Файли:**
- `apps/web/src/shared/ui/UiAvatarButton/UiAvatarButton.tsx` (новий)
- `apps/web/src/shared/ui/UiAvatarButton/types.ts` (новий)
- `apps/web/src/shared/ui/UiAvatarButton/index.ts` (новий)
- `apps/web/src/shared/ui/index.ts` (оновити — додати re-export)

### 8.1. Обґрунтування нового primitive

Існуючий `UiButton variant="icon"` **не підходить** для avatar + hover overlay:
- `renderContent` обгортає `children` в inline `<span>` — зламає absolute-positioned overlay
- Hardcoded `iconSizeStyles` (`p-2` для md) — зіпсує avatar розмір
- За замовчуванням `rounded-lg`, не `rounded-full`
- Тільки SVG-children отримують автоматичний розмір через `[&>svg]:size-N` — для avatar це не релевантно

Конвенція `ui-primitives.md` забороняє raw `<button>` у `features/`. Тому потрібен окремий primitive у `shared/ui/`, який капсулює: clickable circular container + `UiAvatar` всередині + hover overlay слот.

### 8.2. UiAvatarButton — контракт

Props:
- `src?: string` — avatar URL
- `fallback: string` — ініціали (required, як у `UiAvatar`)
- `size: UiAvatarSize` — пропагується в underlying `UiAvatar`
- `overlay?: ReactNode` — slot для hover-state елемента (напр., camera icon); показується через CSS `group-hover` поверх avatar
- `onClick: () => void`
- `disabled?: boolean`
- `aria-label: string` — required для a11y (screen reader)

Реалізація: native `<button>` з `relative rounded-full overflow-hidden group` + `UiAvatar` як child + overlay в абсолютно позиціонованому `<div>` з `opacity-0 group-hover:opacity-100 transition-opacity`.

`rounded-full` гарантує круглий click target. `overflow-hidden` обрізає overlay по колу.

---

## Крок 9: Frontend — Avatar crop dialog

**Файли (всі нові):**
- `apps/web/src/features/profile/AvatarUploadDialog.tsx`
- `apps/web/src/features/profile/avatarUploadDialogStore.ts`
- `apps/web/src/features/profile/AvatarEditButton.tsx`
- `apps/web/src/features/profile/lib/cropImage.ts`

**Файли (оновити):**
- `apps/web/src/features/profile/index.ts` — додати exports
- `apps/web/src/app/overlays.tsx` — зареєструвати dialog через dynamic import

### 9.1. Dialog store

Файл: `apps/web/src/features/profile/avatarUploadDialogStore.ts`

Zustand store: `isOpen`, `open()`, `close()`. Живе в `features/profile/` (in-slice ownership згідно конвенції `overlays.md`). Тригериться прямим імпортом зі сторінки профілю — same slice, `uiIntents` bus не потрібен.

### 9.2. Crop utility

Файл: `apps/web/src/features/profile/lib/cropImage.ts`

Функція `cropImage(imageSrc: string, cropArea: Area): Promise<Blob>`.

Приймає URL зображення (object URL з `URL.createObjectURL`) та crop area (з react-easy-crop `onCropComplete` callback). Створює canvas розміром `AVATAR.OUTPUT_SIZE × AVATAR.OUTPUT_SIZE`, малює обрізану область через `drawImage`, конвертує в WebP blob через `canvas.toBlob(cb, AVATAR.OUTPUT_FORMAT, AVATAR.OUTPUT_QUALITY)`.

Допоміжна функція `loadImage(src)` — створює `HTMLImageElement`, повертає Promise. **Без** `crossOrigin='anonymous'`: джерело — object URL (blob:), який не taint'ить canvas. CORS атрибут був би потрібен тільки для remote URL.

**Сумісність `canvas.toBlob` з WebP:** Chrome 50+, Firefox 65+, Safari 14+ (iOS 14+). Всі цільові браузери проєкту підтримують. Для старіших — на практиці toBlob виклик тихо поверне null; якщо така ситуація виникне — fallback на PNG з попередженням у консоль. Деталі fallback вирішуються на етапі тестування; MVP scope — тільки WebP.

### 9.3. HEIC — свідомо поза scope

HEIC не підтримується на клієнті: всі browser-side HEIC-декодери (`heic2any`, `heic-to`, `libheif-js`) транзитивно спираються на libheif (LGPL-3.0), що несумісне з permissive-ліцензійним профілем репо (ISC/MIT/UNLICENSED). iOS Safari ≥14 автоматично конвертує HEIC → JPEG у file picker, якщо `accept` не містить `image/heic`, тож iPhone UX зберігається без shipping'у декодера. Non-Safari браузери з HEIC-файлом отримають toast `unsupported_format` — малий trade-off на тлі уникнення copyleft у bundle. Див. README "Прийняті рішення".

### 9.4. AvatarEditButton

Файл: `apps/web/src/features/profile/AvatarEditButton.tsx`

Композиція `UiAvatarButton` (з кроку 8) + hover overlay з camera icon + `onPress` callback. **Ініціали через існуючу утиліту `getInitials` з `@cyanship/types`** (перевірено — використовується у `useUserMenu.ts`, `dashboard/page.tsx`, інших місцях). Нову утиліту не створюємо.

Props: `user: UserProfile`, `editable: boolean`, `onPress: () => void`. `aria-label` з i18n ключа (`profile_page.avatar.edit_aria_label`).

### 9.5. Avatar upload dialog

Файл: `apps/web/src/features/profile/AvatarUploadDialog.tsx`

Використовує `UiModal` + `UiModalContent` + `UiModalHeader` + `UiModalTitle`. Store: `useAvatarUploadDialogStore`. Mount: `overlays.tsx` через dynamic import.

**Стани діалогу:**

| Стан | UI | Дії користувача |
|------|----|----|
| **Idle** (файл не обрано) | Drop-зона + кнопка "Оберіть файл" (`UiButton`). Якщо аватарка існує — кнопка "Видалити фото" (destructive) | Drag & drop або click → file input → перехід в Crop |
| **Crop** | `react-easy-crop` Cropper з `cropShape="round"`, `aspect={1}`. Zoom slider (1–3) під зображенням. Кнопки: "Зберегти" (primary), "Скасувати" (text) | Drag, zoom, pinch → crop area змінюється. Зберегти → Uploading. Скасувати → Idle |
| **Uploading** | Кнопка "Зберегти" показує `UiSpinner`, всі кнопки disabled | Автоматичний flow (див. нижче) |

**Upload flow (при натисканні "Зберегти"):**
1. Crop зображення через `cropImage()` → WebP blob
2. Запит presigned URL через `requestAvatarUploadUrl()`
3. Direct upload в R2 через `uploadToR2(uploadUrl, blob)` з Content-Type `image/webp`
4. Commit через `commitAvatarUpload(fileKey)` — повертає `{ avatar }`
5. Оновити `authStore` через `setUser({ ...user, profile: { ...profile, avatar } })` — **response-driven**, без `getMe()`
6. Toast success (через `AVATAR_UPDATED` код), close dialog

**Чому response-driven, не `getMe()`:** один round-trip замість двох. Відповідь commit'а — authoritative (MongoDB щойно записав і повертає). Додатковий `getMe()` створює race ризик (читання перед flush replication) і зайвий API-виклик.

**Delete flow:**
1. Кнопка "Видалити фото" → `UiConfirmDialog` (variant destructive)
2. Після підтвердження: `deleteAvatar()` → оновити `authStore` через `setUser({ ...user, profile: { ...profile, avatar: undefined }})` → toast success (`AVATAR_DELETED`), close

**File select flow:**
1. Валідація розміру — `file.size > AVATAR.MAX_FILE_SIZE` → toast error (`file_too_large`)
2. Валідація типу — перевірка проти `AVATAR.ALLOWED_MIME_TYPES` (`image/jpeg`, `image/png`, `image/webp`); при невідповідності — toast `unsupported_format`. HEIC не в списку (див. 9.3) — iPhone-юзери отримують JPEG через нативний auto-convert iOS Safari
3. Revoke попередній `URL.createObjectURL` якщо є (memory leak prevention)
4. Створення нового object URL для Cropper

**Memory cleanup:** При закритті діалогу або unmount — `URL.revokeObjectURL()`. Реалізувати через `useEffect` cleanup.

### 9.6. Overlay registration

Файл: `apps/web/src/app/overlays.tsx` — додати dynamic import `AvatarUploadDialog` з `@/features/profile/AvatarUploadDialog` і рендер в JSX. Це core→core dynamic import (обидва у core layer) — не вимагає agency exception.

---

## Крок 10: Frontend — Profile page integration

**Файли:**
- `apps/web/src/features/profile/ProfileForm.tsx` (оновити)

### 10.1. Clickable avatar в ProfileForm

Додати `AvatarEditButton` перед email `<dl>` блоком в `ProfileForm`. При кліку — `useAvatarUploadDialogStore.getState().open()`.

Avatar бере `src` з `user.profile.avatar`, fallback — `getInitials(fullName, user.email)` (існуюча утиліта з `@cyanship/types`).

**Onboarding mode:** `AvatarEditButton` не рендериться коли `mode === 'new'` (onboarding). Причина: глобальний `OnboardingInterceptor` блокує всі API виклики поки профіль не заповнений, і storage endpoints не мають `@SkipOnboarding()`. Аватарка — optional, при onboarding фокус на обов'язкових полях (ім'я). Користувач зможе встановити аватарку після завершення onboarding. Disabled коли `editable === false`.

---

## Крок 11: i18n — message keys

**Файли:**
- `apps/web/messages/uk.json` (оновити)
- `apps/web/messages/en.json` (оновити)

### 11.1. Profile page — avatar section

Додати namespace `profile_page.avatar` з ключами для діалогу:

| Ключ | EN | UK |
|------|----|----|
| `dialog_title` | Profile photo | Фото профілю |
| `edit_aria_label` | Edit profile photo | Редагувати фото профілю |
| `drop_text` | Drag a photo here or | Перетягніть фото сюди або |
| `browse_button` | Choose file | Оберіть файл |
| `supported_formats` | JPEG, PNG or WebP. Max 5 MB | JPEG, PNG або WebP. Максимум 5 МБ |
| `zoom_label` | Zoom | Масштаб |
| `save_button` | Save | Зберегти |
| `cancel_button` | Cancel | Скасувати |
| `delete_button` | Remove photo | Видалити фото |
| `delete_confirm_title` | Remove profile photo? | Видалити фото профілю? |
| `delete_confirm_description` | Your avatar will be replaced with initials | Замість фото відображатимуться ініціали |
| `delete_confirm_button` | Remove | Видалити |
| `delete_cancel_button` | Cancel | Скасувати |
| `file_too_large` | File is too large. Maximum size is 5 MB | Файл занадто великий. Максимальний розмір — 5 МБ |
| `unsupported_format` | Unsupported format. Please use JPEG, PNG or WebP | Непідтримуваний формат. Використовуйте JPEG, PNG або WebP |

### 11.2. Notifications та errors (API response codes)

Додати згідно конвенції `i18n.md`. Окремі ключі для окремих кодів — щоб користувач бачив точне повідомлення щодо проблеми:

| Namespace | Ключ | EN | UK |
|-----------|------|----|----|
| `notifications.storage` | `avatar_updated` | Photo updated | Фото оновлено |
| `notifications.storage` | `avatar_deleted` | Photo removed | Фото видалено |
| `errors.storage` | `avatar_upload_failed` | Failed to upload photo. Please try again later | Не вдалося завантажити фото. Спробуйте пізніше |
| `errors.storage` | `avatar_file_key_invalid` | Upload session expired. Please try again | Сесія завантаження закінчилась. Спробуйте ще раз |
| `errors.storage` | `avatar_upload_not_found` | We couldn't find your uploaded photo. Please try again | Не вдалося знайти завантажене фото. Спробуйте ще раз |
| `errors.storage` | `avatar_upload_invalid` | This file can't be used as a photo. Please try a different image | Цей файл не може бути використаний як фото. Спробуйте інше зображення |

---

## Крок 12: Next.js config — R2 remote pattern

Файл: `apps/web/next.config.ts`

Додати R2 hostname до `images.remotePatterns` (поряд з existing Google pattern). Hostname береться з `process.env.NEXT_PUBLIC_STORAGE_HOSTNAME` (визначений у кроці 2.2).

**Env sync invariant** (див. огляд архітектури): hostname у `NEXT_PUBLIC_STORAGE_HOSTNAME` мусить дорівнювати hostname з `R2_PUBLIC_URL` (API). Якщо не збігаються — `next/image` блокує всі завантажені фото (runtime помилка з чітким повідомленням Next.js).

---

## Крок 13: Оновлення CLAUDE.md

Проєкт має детальну документацію в `CLAUDE.md` яка є основним context для AI agents. Новий Storage module повинен бути задокументований.

### 13.1. API Overview — додати секцію StorageController

Додати таблицю з 3 endpoints (`/storage/avatar/upload-url`, `/storage/avatar/commit`, `/storage/avatar`) за тим же форматом що й існуючі (AiController, PaymentsController тощо).

### 13.2. Module Dependency Map — оновити

Додати:
- `StorageModule` → `UsersModule` + `STORAGE_PROVIDER` injection token
- `AuthModule` → `StorageModule` (для Google avatar re-upload у `handleGoogleAuth`)

### 13.3. Configuration & Environment — додати env vars

Додати 5 backend R2 змінних та 1 frontend змінну в відповідні секції (API required, Web required). Зафіксувати sync-інваріант між `R2_PUBLIC_URL` і `NEXT_PUBLIC_STORAGE_HOSTNAME`.

### 13.4. Known Complexities — додати

- **Presigned PUT signed Content-Type**: тільки `Content-Type` підписується. `Content-Length` не підписується навмисно — це forbidden request header у Fetch (браузер встановлює автоматично), і signed `ContentLength` у PUT — це exact match, не upper bound. Clients мусять відправляти Content-Type з рівно тим самим значенням, що підписав бекенд.
- **Size enforcement на application layer**: upper-bound контроль розміру реалізований через три шари — client-side pre-check, commit-time `HeadObject` валідація з cleanup `deleteObject` при rejection, rate limit на presigned URL endpoint. Attack surface: authenticated user може upload'ити oversized файл у свій namespace, але commit його зловить і видалить. Для великих/публічних media-типів у майбутньому — міграція на presigned POST з `content-length-range` policy.
- **R2 URL detection для safe delete**: зовнішній Google URL vs R2 URL — через `ENV.R2_PUBLIC_URL` prefix check.
- **Commit idempotency**: другий commit з тим самим fileKey повертає existing URL без повторного видалення — захист від подвійного `safeDeleteR2File` атакуючого актуальний файл.
- **Orphaned files trade-off**: upload без commit залишає файл у `avatars/`. MVP — acceptable (малі файли). Scale — TTL cron.
- **Sharp на Alpine Docker**: у стандартному випадку prebuilt binary для musl підтягується автоматично, жодних правок Dockerfile не потрібно. Якщо ж prebuilt недоступний для конкретної архітектури/версії — fallback через apk `vips` у runtime stage. Верифікувати локальним build'ом.
- **OAuth callback sync re-upload**: Google avatar re-uploaded синхронно у `handleGoogleAuth` — додає 300-800ms до callback, але уникає UX "стрибка" URL.

---

## Крок 14: Тести

### 14.1. Backend unit tests

**Файл:** `apps/api/src/modules/storage/storage.service.spec.ts`

Mock'и: `IStorageProvider` (mock implementation), `UsersService` (mock).

| # | Тест-кейс |
|---|-----------|
| 1 | `createAvatarUploadUrl` — генерує key у форматі `avatars/{userId}/{uuid}.webp` |
| 2 | `createAvatarUploadUrl` — передає provider'у `contentType='image/webp'` (без maxSizeBytes) |
| 3 | `commitAvatarUpload` — валідує ownership, перевіряє metadata, оновлює profile, видаляє старий R2 файл |
| 4 | `commitAvatarUpload` — idempotency: повторний виклик з тим самим fileKey не видаляє новий файл |
| 5 | `commitAvatarUpload` — не видаляє старий файл якщо це зовнішній URL (Google) |
| 6 | `commitAvatarUpload` — кидає помилку якщо key не належить userId (`AVATAR_FILE_KEY_INVALID`) |
| 7 | `commitAvatarUpload` — кидає помилку якщо файл не існує в R2 (`AVATAR_UPLOAD_NOT_FOUND`) |
| 8 | `commitAvatarUpload` — кидає помилку + викликає `deleteObject(key)` (cleanup) якщо contentType ≠ `image/webp` (`AVATAR_UPLOAD_INVALID`) |
| 9 | `commitAvatarUpload` — кидає помилку + викликає `deleteObject(key)` (cleanup) якщо contentLength > MAX (`AVATAR_UPLOAD_INVALID`) |
| 10 | `deleteAvatar` — викликає `clearAvatar`, видаляє R2 файл |
| 11 | `deleteAvatar` — пропускає R2 delete якщо avatar — зовнішній URL |
| 12 | `reUploadExternalAvatar` — завантажує зовнішній файл, конвертує через `sharp` в WebP 512×512 з quality=OUTPUT_QUALITY, upload'ить в R2 |
| 13 | `safeDeleteR2File` — помилка provider'а не пробрасується (best-effort) — тільки лог |

**Файл:** `apps/api/src/modules/storage/storage.controller.spec.ts`

| # | Тест-кейс |
|---|-----------|
| 1 | `POST /storage/avatar/upload-url` — повертає presigned URL (вимагає auth) |
| 2 | `POST /storage/avatar/commit` — валідує fileKey через Zod, повертає 400 на невалідний |
| 3 | `POST /storage/avatar/commit` — повертає `{ avatar, code: 'AVATAR_UPDATED' }` на успіх |
| 4 | `DELETE /storage/avatar` — повертає 200 з кодом `AVATAR_DELETED`, очищує avatar |

**Файл:** `apps/api/src/modules/auth/auth.service.spec.ts` (оновити)

| # | Тест-кейс |
|---|-----------|
| 1 | `handleGoogleAuth` — викликає re-upload якщо avatar зовнішній |
| 2 | `handleGoogleAuth` — пропускає re-upload якщо avatar вже R2 |
| 3 | `handleGoogleAuth` — при re-upload failure → warn + продовжує з Google URL (не кидає помилку) |

### 14.2. Frontend unit tests

**Файл:** `apps/web/src/features/profile/lib/cropImage.test.ts`
- Output canvas розмір = `AVATAR.OUTPUT_SIZE`
- Output blob type = `AVATAR.OUTPUT_FORMAT`
- `toBlob` викликається з `AVATAR.OUTPUT_QUALITY`

**Файл:** `apps/web/src/shared/ui/UiAvatarButton/UiAvatarButton.test.tsx`
- Рендерить `UiAvatar` з переданими src/fallback
- Overlay показується тільки при hover (CSS class check)
- `aria-label` пропагується на button
- `disabled` блокує onClick

---

## Зведення файлів

### Нові файли

| Файл | Опис |
|------|------|
| `packages/types/src/constants/storage.ts` | Avatar constants (розмір, формат, quality, MIME types) |
| `packages/types/src/contracts/storage.ts` | Zod schema + response types для storage API |
| `apps/api/src/modules/storage/interfaces/storage-provider.interface.ts` | IStorageProvider + STORAGE_PROVIDER token + ObjectMetadata type |
| `apps/api/src/modules/storage/providers/cloudflare-r2.service.ts` | R2 implementation (S3Client + HeadObject з метаданими) |
| `apps/api/src/modules/storage/providers/storage-provider.provider.ts` | Provider factory |
| `apps/api/src/modules/storage/storage.controller.ts` | HTTP endpoints (3 routes) |
| `apps/api/src/modules/storage/dto/commit-avatar-upload.dto.ts` | Zod DTO |
| `apps/web/src/shared/api/storage.ts` | Frontend API functions + R2 direct upload helper |
| `apps/web/src/shared/ui/UiAvatarButton/UiAvatarButton.tsx` | Circular button з avatar + overlay slot |
| `apps/web/src/shared/ui/UiAvatarButton/types.ts` | Props контракт |
| `apps/web/src/shared/ui/UiAvatarButton/index.ts` | Барель |
| `apps/web/src/features/profile/AvatarUploadDialog.tsx` | Crop + upload dialog component |
| `apps/web/src/features/profile/AvatarEditButton.tsx` | Клікабельна аватарка (композиція UiAvatarButton) |
| `apps/web/src/features/profile/avatarUploadDialogStore.ts` | Zustand dialog state |
| `apps/web/src/features/profile/lib/cropImage.ts` | Canvas crop → WebP blob |

### Модифіковані файли

| Файл | Зміна |
|------|-------|
| `packages/types/src/constants/index.ts` | Додати storage re-export |
| `packages/types/src/contracts/index.ts` | Додати storage re-export |
| `packages/types/src/enums/response-code.ts` | 6 нових кодів AVATAR_* + маппінг |
| `apps/api/src/config/env.ts` | 5 R2 env vars через getEnvVar() |
| `apps/api/src/test-setup.ts` | 5 R2 test placeholders |
| `apps/api/Dockerfile` | **Conditional** — правка потрібна лише якщо верифікаційний крок 2.5 виявить, що sharp prebuilt для musl недоступний у нашому середовищі. За замовчуванням не чіпати |
| `apps/api/src/modules/storage/storage.module.ts` | Повна перебудова (imports, providers, exports) |
| `apps/api/src/modules/storage/storage.service.ts` | Повна перебудова (avatar lifecycle logic) |
| `apps/api/src/modules/users/users.service.ts` | Додати `clearAvatar()` метод |
| `apps/api/src/modules/auth/auth.module.ts` | Import StorageModule |
| `apps/api/src/modules/auth/auth.service.ts` | Re-upload у `handleGoogleAuth` (після findOrCreateByGoogle) |
| `apps/api/src/modules/auth/auth.service.spec.ts` | Тести re-upload flow |
| `apps/web/next.config.ts` | R2 hostname в remotePatterns |
| `apps/web/src/shared/config/env.ts` | NEXT_PUBLIC_STORAGE_HOSTNAME (fail-fast) |
| `apps/web/src/shared/api/index.ts` | Storage API exports |
| `apps/web/src/shared/ui/index.ts` | UiAvatarButton re-export |
| `apps/web/src/features/profile/ProfileForm.tsx` | Додати AvatarEditButton |
| `apps/web/src/features/profile/index.ts` | Додати нові exports |
| `apps/web/src/app/overlays.tsx` | Зареєструвати AvatarUploadDialog |
| `apps/web/messages/uk.json` | Avatar i18n keys (profile_page.avatar + notifications/errors.storage) |
| `apps/web/messages/en.json` | Avatar i18n keys (profile_page.avatar + notifications/errors.storage) |
| `.env` | R2 credentials + NEXT_PUBLIC_STORAGE_HOSTNAME |
| `.env.example` | R2 placeholders + sync-інваріант коментар |
| `CLAUDE.md` | API Overview, Module Dependency Map, env vars, Known Complexities |
| `docs/sprints/upload-media/README.md` | Узгодити file key format (UUID), додати секцію "Known Limitations" (orphaned files, OAuth callback затримка) |
