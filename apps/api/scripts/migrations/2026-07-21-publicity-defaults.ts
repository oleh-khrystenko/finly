/**
 * Sprint 29 migration — backfill прапорів каталогу і публічності на записах,
 * створених до спринту.
 *
 * **Контекст.** Sprint 29 додав на `Business` (`isSystem`, `catalogVisible`,
 * `publicityStatus` + три поля життєвого циклу заявки, `catalogCategory`) і на
 * `Account` (`catalogVisible`, `paymentPurposeTemplate`) поля з Mongoose-дефолтами.
 * Дефолт застосовується лише на insert, тож у документах, створених раніше, полів
 * фізично немає. Read-шляхи це переживають (`$ifNull` в aggregation, `{ $ne: true }`
 * у вибірках), а от write-фільтри за станом — ні: `findOneAndUpdate` з
 * `publicityStatus: 'none'` не матчить документ без поля, і подання заявки на
 * публічність падало б 409 назавжди. Backfill вирівнює сховище під контракт
 * `@finly/types` замість того, щоб розмазувати `$exists`-гілки по кожному фільтру.
 *
 * **Idempotent.** Кожен `updateMany` звужений на `{ $exists: false }` по своєму
 * полю; повторний прогін — no-op. Поля оновлюються окремими запитами, бо документ
 * може мати частину з них (наприклад, `catalogVisible` виставлений вручну на
 * стейджі, а `publicityStatus` ні).
 *
 * `runMigration(db)` exported для тестів і CLI-wrapper-а (той самий патерн, що
 * `2026-06-18-businesses-brand-null`).
 */

import 'dotenv/config';
import { DEFAULT_CATALOG_CATEGORY } from '@finly/types';
import mongoose from 'mongoose';

type Db = NonNullable<typeof mongoose.connection.db>;

export const BUSINESSES_COLLECTION = 'businesses';
export const ACCOUNTS_COLLECTION = 'accounts';

export interface MigrationResult {
    businessesBackfilled: number;
    accountsBackfilled: number;
}

const BUSINESS_DEFAULTS: Record<string, unknown> = {
    isSystem: false,
    catalogVisible: false,
    publicityStatus: 'none',
    publicityRequestedAt: null,
    publicityReviewedAt: null,
    publicityRejectionReason: null,
    catalogCategory: DEFAULT_CATALOG_CATEGORY,
};

const ACCOUNT_DEFAULTS: Record<string, unknown> = {
    catalogVisible: false,
    paymentPurposeTemplate: null,
};

async function backfill(
    db: Db,
    collection: string,
    defaults: Record<string, unknown>
): Promise<number> {
    // Рахуємо ДО оновлення: після нього предикат «бракує хоч одного поля» вже
    // нікого не матчить, і звіт завжди був би нулем.
    const pending = await db.collection(collection).countDocuments({
        $or: Object.keys(defaults).map((field) => ({
            [field]: { $exists: false },
        })),
    });
    for (const [field, value] of Object.entries(defaults)) {
        await db
            .collection(collection)
            .updateMany(
                { [field]: { $exists: false } },
                { $set: { [field]: value } }
            );
    }
    return pending;
}

export async function runMigration(db: Db): Promise<MigrationResult> {
    return {
        businessesBackfilled: await backfill(
            db,
            BUSINESSES_COLLECTION,
            BUSINESS_DEFAULTS
        ),
        accountsBackfilled: await backfill(
            db,
            ACCOUNTS_COLLECTION,
            ACCOUNT_DEFAULTS
        ),
    };
}

/**
 * CLI entry point — connect → run → disconnect → log. Дзеркало
 * `2026-06-18-businesses-brand-null` CLI-wrapper-а (deploy.yml
 * migrations-profile).
 */
async function cli(): Promise<void> {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error(
            '[migration:publicity-defaults] MONGODB_URI is required (export from .env or pass via docker-compose env_file)'
        );
        process.exit(1);
    }

    await mongoose.connect(uri);
    try {
        const db = mongoose.connection.db;
        if (!db) {
            throw new Error(
                '[migration:publicity-defaults] mongoose.connection.db is undefined after connect'
            );
        }
        const result = await runMigration(db);

        console.log('[migration:publicity-defaults] applied', result);
    } finally {
        await mongoose.disconnect();
    }
}

if (require.main === module) {
    cli().catch((err) => {
        console.error('[migration:publicity-defaults] failed', err);
        process.exit(1);
    });
}
