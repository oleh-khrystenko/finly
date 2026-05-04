/**
 * Sprint 3 §3.1 migration — переводить unique-index з `slug` на `slugLower`.
 *
 * **Чому окремий script, а не Mongoose autoIndex.** Mongoose `syncIndexes`
 * створив би новий index `slugLower_1`, але старий `slug_1` лишився б — і
 * блокував би legitimate case-vary slug-и (`IvanEnko` vs `ivanenko` мали б
 * однаковий `slug` після lowercasing у Sprint 1 model, але new model не
 * lowercase-ить slug → потенційний duplicate `slug_1` violation на нових
 * документах). Явний drop + backfill + create — єдиний робочий upgrade-path.
 *
 * **Idempotent.** Повторний запуск = no-op:
 *   - drop старого index ловить `IndexNotFound` (code 27) → continue.
 *   - backfill `updateMany({ slugLower: { $exists: false } }, ...)` — пусте matchера на другому run-і.
 *   - createIndex з тим же специфікаційним ім'ям — no-op для existing index з тим же spec.
 *
 * **Архітектурне рішення для test/CI/prod виклику.** Migration логіка
 * exported як `runMigration(db: Db): Promise<MigrationResult>`. Тонкий
 * CLI-wrapper нижче відкриває mongoose-конект з `MONGODB_URI` і викликає
 * `runMigration` — це шлях, що використовує deploy.yml через docker compose
 * profile `migrations`. Тести викликають `runMigration` напряму з
 * MongoMemoryServer-db, без CLI-overhead.
 *
 * **Production deploy виклик.** Окремий Dockerfile target `migrations`
 * extends build stage (де ts-node живий, на відміну від обрізаного
 * `pnpm deploy --prod` runtime); docker-compose profile `migrations` стартує
 * one-shot container перед `docker compose up -d api`. Failure exit code != 0
 * блокує deploy через `set -euo pipefail` у `.github/workflows/deploy.yml`.
 */

import 'dotenv/config';
import mongoose from 'mongoose';

// `Db` тип живе у транзитивній залежності `mongodb` (mongoose driver).
// Витягуємо через mongoose-namespace, щоб уникнути explicit-import з пакета,
// який не оголошений у `apps/api/package.json` як direct dep — TypeScript
// інакше не знаходить declarations при ts-jest резолвенні.
type Db = NonNullable<typeof mongoose.connection.db>;

export const COLLECTION_NAME = 'businesses';
export const OLD_INDEX_NAME = 'slug_1';
export const NEW_INDEX_NAME = 'slugLower_1';

// Mongo error codes, що для `dropIndex` означають "вже у бажаному стані":
//   26 — NamespaceNotFound (collection взагалі не існує — greenfield deploy).
//   27 — IndexNotFound (collection є, але такого index-а немає — re-run).
// Обидва — ідемпотентні no-op-и; інші коди (permissions, write-concerns) —
// реальні проблеми, що блокують migration.
const MONGO_NAMESPACE_NOT_FOUND_CODE = 26;
const MONGO_INDEX_NOT_FOUND_CODE = 27;

export interface MigrationResult {
    droppedOldIndex: boolean;
    backfilledDocs: number;
    createdNewIndex: boolean;
}

export async function runMigration(db: Db): Promise<MigrationResult> {
    const collection = db.collection(COLLECTION_NAME);

    // ---- Step 1: drop старого `{ slug: 1 }` unique index якщо існує ----
    let droppedOldIndex = false;
    try {
        await collection.dropIndex(OLD_INDEX_NAME);
        droppedOldIndex = true;
    } catch (err: unknown) {
        // IndexNotFound / NamespaceNotFound — норм (re-run або greenfield).
        // Інші помилки (permissions, write-concerns) — прокидуються нагору і
        // блокують migration.
        if (!isAcceptableDropError(err)) {
            throw err;
        }
    }

    // ---- Step 2: backfill slugLower для документів без поля ----
    // Aggregation-pipeline-update (Mongo 4.2+) — `$set` з `$toLower`
    // дозволяє один атомарний updateMany замість find→loop→updateOne.
    const updateResult = await collection.updateMany(
        { slugLower: { $exists: false } },
        [{ $set: { slugLower: { $toLower: '$slug' } } }]
    );

    // ---- Step 3: створити новий unique slugLower index ----
    // createIndex з тим же spec на existing index — no-op (idempotent).
    // Якщо у БД є duplicate-key collision (case-vary slug-и: `Foo` і `foo`
    // як різні документи) — index build впаде з MongoServerError code 11000.
    // Це fail-safe: правило "case-insensitive uniqueness" перетворює такі
    // пари на нелегальний стан; resolution — manual rename одного, потім re-run.
    await collection.createIndex(
        { slugLower: 1 },
        { unique: true, name: NEW_INDEX_NAME }
    );

    return {
        droppedOldIndex,
        backfilledDocs: updateResult.modifiedCount,
        createdNewIndex: true,
    };
}

function isAcceptableDropError(err: unknown): boolean {
    if (typeof err !== 'object' || err === null) return false;
    const candidate = err as { code?: unknown; codeName?: unknown };
    return (
        candidate.code === MONGO_INDEX_NOT_FOUND_CODE ||
        candidate.code === MONGO_NAMESPACE_NOT_FOUND_CODE ||
        candidate.codeName === 'IndexNotFound' ||
        candidate.codeName === 'NamespaceNotFound'
    );
}

/**
 * CLI entry point. Виконується тільки при прямому запуску (не при require).
 * Connect → run → disconnect → log human-readable summary.
 */
async function cli(): Promise<void> {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        // Свідомо НЕ кидаємо стандартний `Error` — exit-код важливіший за
        // stack-trace для CI: deploy.yml перевіряє лише `$?`.
        // eslint-disable-next-line no-console
        console.error(
            '[migration:slug-lower] MONGODB_URI is required (export from .env or pass via docker-compose env_file)'
        );
        process.exit(1);
    }

    await mongoose.connect(uri);
    try {
        const db = mongoose.connection.db;
        if (!db) {
            throw new Error(
                '[migration:slug-lower] mongoose.connection.db is undefined after connect'
            );
        }
        const result = await runMigration(db);
        // eslint-disable-next-line no-console
        console.log('[migration:slug-lower] applied', {
            droppedOldIndex: result.droppedOldIndex,
            backfilledDocs: result.backfilledDocs,
            createdNewIndex: result.createdNewIndex,
        });
    } finally {
        await mongoose.disconnect();
    }
}

// Run CLI лише якщо файл стартований напряму (не при `require` з тесту).
// `require.main === module` — стандартний CommonJS-патерн, що ts-node
// preserves під CommonJS target (див. apps/api/tsconfig.json `module: "commonjs"`).
if (require.main === module) {
    cli().catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[migration:slug-lower] failed', err);
        process.exit(1);
    });
}
