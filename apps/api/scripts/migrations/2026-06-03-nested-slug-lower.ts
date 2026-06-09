/**
 * Sprint 15 migration — переводить unique-index Account і Invoice зі `slug`
 * на `slugLower` (case-insensitive uniqueness для редаговуваних vanity-slug-ів).
 *
 * Дзеркало `2026-05-03-businesses-slug-lower.ts`, але на двох колекціях:
 *   - accounts:  drop `(businessId, slug)` unique → backfill `slugLower=
 *     $toLower($slug)` → create `(businessId, slugLower)` unique.
 *   - invoices:  drop `(accountId, slug)` unique → backfill → create
 *     `(accountId, slugLower)` unique.
 *
 * **Порядок критичний:** backfill ОБОВ'ЯЗКОВО до create нового unique-index-у,
 * інакше документи без `slugLower` дали б null-bucket collision. Existing slug-и
 * (8-char random для account, `{human}-{tail}` для invoice) валідні у новій
 * vanity-граматиці, тож re-slug не потрібен — лише backfill lower-форми.
 *
 * **Idempotent.** drop ловить IndexNotFound/NamespaceNotFound; backfill —
 * `{ slugLower: { $exists: false } }` (пусте на re-run); createIndex з тим же
 * spec — no-op. Якщо існують case-vary дублі (`Foo`/`foo` як різні документи у
 * межах одного scope) — index build впаде 11000; resolution — manual rename
 * одного + re-run (правило case-insensitive uniqueness робить таку пару
 * нелегальною).
 */

import 'dotenv/config';
import mongoose from 'mongoose';

type Db = NonNullable<typeof mongoose.connection.db>;

const MONGO_NAMESPACE_NOT_FOUND_CODE = 26;
const MONGO_INDEX_NOT_FOUND_CODE = 27;

interface CollectionMigrationSpec {
    collection: string;
    oldIndexName: string;
    newIndexName: string;
    newIndexKeys: Record<string, 1 | -1>;
}

const SPECS: CollectionMigrationSpec[] = [
    {
        collection: 'accounts',
        oldIndexName: 'businessId_1_slug_1',
        newIndexName: 'businessId_1_slugLower_1',
        newIndexKeys: { businessId: 1, slugLower: 1 },
    },
    {
        collection: 'invoices',
        oldIndexName: 'accountId_1_slug_1',
        newIndexName: 'accountId_1_slugLower_1',
        newIndexKeys: { accountId: 1, slugLower: 1 },
    },
];

export interface CollectionMigrationResult {
    collection: string;
    droppedOldIndex: boolean;
    backfilledDocs: number;
    createdNewIndex: boolean;
}

export type MigrationResult = CollectionMigrationResult[];

export async function runMigration(db: Db): Promise<MigrationResult> {
    const results: MigrationResult = [];
    for (const spec of SPECS) {
        results.push(await migrateCollection(db, spec));
    }
    return results;
}

async function migrateCollection(
    db: Db,
    spec: CollectionMigrationSpec
): Promise<CollectionMigrationResult> {
    const collection = db.collection(spec.collection);

    // ---- Step 1: drop старого `(…, slug)` unique index якщо існує ----
    let droppedOldIndex = false;
    try {
        await collection.dropIndex(spec.oldIndexName);
        droppedOldIndex = true;
    } catch (err: unknown) {
        if (!isAcceptableDropError(err)) {
            throw err;
        }
    }

    // ---- Step 2: backfill slugLower для документів без поля ----
    const updateResult = await collection.updateMany(
        { slugLower: { $exists: false } },
        [{ $set: { slugLower: { $toLower: '$slug' } } }]
    );

    // ---- Step 3: створити новий unique slugLower compound-index ----
    await collection.createIndex(spec.newIndexKeys, {
        unique: true,
        name: spec.newIndexName,
    });

    return {
        collection: spec.collection,
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

async function cli(): Promise<void> {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        // eslint-disable-next-line no-console
        console.error(
            '[migration:nested-slug-lower] MONGODB_URI is required (export from .env or pass via docker-compose env_file)'
        );
        process.exit(1);
    }

    await mongoose.connect(uri);
    try {
        const db = mongoose.connection.db;
        if (!db) {
            throw new Error(
                '[migration:nested-slug-lower] mongoose.connection.db is undefined after connect'
            );
        }
        const result = await runMigration(db);
        // eslint-disable-next-line no-console
        console.log('[migration:nested-slug-lower] applied', result);
    } finally {
        await mongoose.disconnect();
    }
}

if (require.main === module) {
    cli().catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[migration:nested-slug-lower] failed', err);
        process.exit(1);
    });
}
