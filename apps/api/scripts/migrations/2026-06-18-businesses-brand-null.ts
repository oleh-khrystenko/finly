/**
 * Sprint 21 migration — backfill `brand: null` для бізнесів, створених до
 * введення блоку кастомного бренду.
 *
 * **Контекст.** `Business.brand` — новий required-nullable субдок (два слоти
 * active/pending). Mongoose застосовує `default: null` лише при гідрації окремого
 * документа (`findOne`/guard-lookup), АЛЕ не в aggregation-pipeline списку
 * отримувачів (`getOwnedAndManagedWithCounts` робить `$addFields`/`$unset`, не
 * `$project`-whitelist, тож успадковує форму документа як є). Для pre-Sprint-21
 * документів поле відсутнє → у списку `brand` був би undefined, а entity-контракт
 * (`@finly/types` `BusinessSchema`) оголошує його завжди присутнім. Backfill
 * вирівнює сховище під контракт.
 *
 * **Idempotent.** Працюємо лише по `brand: { $exists: false }`; повторний прогін
 * — no-op. `runMigration(db)` exported для тестів і CLI-wrapper-а (той самий
 * патерн, що `2026-06-10-slug-customized-backfill`).
 */

import 'dotenv/config';
import mongoose from 'mongoose';

type Db = NonNullable<typeof mongoose.connection.db>;

export const BUSINESSES_COLLECTION = 'businesses';

export interface MigrationResult {
    backfilled: number;
}

export async function runMigration(db: Db): Promise<MigrationResult> {
    const result = await db
        .collection(BUSINESSES_COLLECTION)
        .updateMany({ brand: { $exists: false } }, { $set: { brand: null } });
    return { backfilled: result.modifiedCount };
}

/**
 * CLI entry point — connect → run → disconnect → log. Дзеркало
 * `2026-06-10-slug-customized-backfill` CLI-wrapper-а (deploy.yml
 * migrations-profile).
 */
async function cli(): Promise<void> {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error(
            '[migration:businesses-brand] MONGODB_URI is required (export from .env or pass via docker-compose env_file)'
        );
        process.exit(1);
    }

    await mongoose.connect(uri);
    try {
        const db = mongoose.connection.db;
        if (!db) {
            throw new Error(
                '[migration:businesses-brand] mongoose.connection.db is undefined after connect'
            );
        }
        const result = await runMigration(db);

        console.log('[migration:businesses-brand] applied', result);
    } finally {
        await mongoose.disconnect();
    }
}

if (require.main === module) {
    cli().catch((err) => {
        console.error('[migration:businesses-brand] failed', err);
        process.exit(1);
    });
}
