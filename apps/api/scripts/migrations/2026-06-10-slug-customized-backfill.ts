/**
 * Sprint 19 review-fix migration — backfill `slugCustomized` для документів,
 * створених до Sprint 19.
 *
 * **Контекст.** Slug-rent реконсиляція (`ReconciliationService`) скидає при
 * втраті доступу лише slug-и з `slugCustomized: true` — прапорець ставиться на
 * user-PATCH/rename. Документи, відредаговані до Sprint 19 (vanity-slug бізнесів
 * жив зі Sprint 14, реквізитів/рахунків — зі Sprint 15), поля не мають узагалі,
 * тож фільтр `{ slugCustomized: true }` їх ніколи не матчить і rent-інваріант
 * («красиві імена повертаються ринку») для них мовчки не діє.
 *
 * **Евристика.** Поле недеривоване напряму, тож відновлюємо його з форми slug-а:
 * усе, що НЕ могло вийти з генератора, — кастомне.
 *  - business / account: авто = рівно 8 символів `[A-Za-z0-9]` (random tail).
 *  - invoice: будь-який вихід генератора або сам tail, або закінчується на
 *    `-{tail}` (explicit `humanPart-tail`, пресети `inv-NNN-tail` /
 *    `YYYY[-MM]-NNN-tail`, `with-purpose slug-tail`).
 * Edge: ручний rename, що випадково виглядає як авто (останній сегмент — рівно
 * 8 alnum), лишиться auto (false-negative; slug переживе lapse). Зворотний
 * false-positive неможливий: генератор не вміє видати не-авто-форму.
 *
 * **Idempotent.** Працюємо лише по `slugCustomized: { $exists: false }`;
 * перший прогін дає всім документам явне значення, повторний — no-op.
 *
 * **Виклик** — той самий патерн, що `2026-06-02-accounts-null-auto-name`:
 * `runMigration(db)` exported для тестів і CLI-wrapper-а.
 */

import 'dotenv/config';
import mongoose from 'mongoose';

type Db = NonNullable<typeof mongoose.connection.db>;

export const BUSINESSES_COLLECTION = 'businesses';
export const ACCOUNTS_COLLECTION = 'accounts';
export const INVOICES_COLLECTION = 'invoices';

/** Random tail генератора: 8 символів 62-алфавіту (`generateRandomTail`). */
export const AUTO_TAIL_SLUG_RE = /^[A-Za-z0-9]{8}$/;
/** Invoice-генератор: або сам tail, або будь-який prefix + `-{tail}`. */
export const AUTO_INVOICE_SLUG_RE = /^(?:[A-Za-z0-9]{8}|.*-[A-Za-z0-9]{8})$/;

export interface CollectionResult {
    customized: number;
    auto: number;
}

export interface MigrationResult {
    businesses: CollectionResult;
    accounts: CollectionResult;
    invoices: CollectionResult;
}

async function backfillCollection(
    db: Db,
    collectionName: string,
    autoShape: RegExp
): Promise<CollectionResult> {
    const collection = db.collection(collectionName);

    // Порядок критичний: спершу мітимо кастомні серед документів без поля,
    // потім решті без поля даємо явний false. Обидва фільтри звужені
    // `$exists: false`, тож повторний прогін — no-op.
    const customized = await collection.updateMany(
        {
            slugCustomized: { $exists: false },
            slug: { $not: autoShape },
        },
        { $set: { slugCustomized: true } }
    );
    const auto = await collection.updateMany(
        { slugCustomized: { $exists: false } },
        { $set: { slugCustomized: false } }
    );

    return {
        customized: customized.modifiedCount,
        auto: auto.modifiedCount,
    };
}

export async function runMigration(db: Db): Promise<MigrationResult> {
    return {
        businesses: await backfillCollection(
            db,
            BUSINESSES_COLLECTION,
            AUTO_TAIL_SLUG_RE
        ),
        accounts: await backfillCollection(
            db,
            ACCOUNTS_COLLECTION,
            AUTO_TAIL_SLUG_RE
        ),
        invoices: await backfillCollection(
            db,
            INVOICES_COLLECTION,
            AUTO_INVOICE_SLUG_RE
        ),
    };
}

/**
 * CLI entry point — connect → run → disconnect → log. Дзеркало
 * `2026-06-02-accounts-null-auto-name` CLI-wrapper-а (deploy.yml
 * migrations-profile).
 */
async function cli(): Promise<void> {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error(
            '[migration:slug-customized] MONGODB_URI is required (export from .env or pass via docker-compose env_file)'
        );
        process.exit(1);
    }

    await mongoose.connect(uri);
    try {
        const db = mongoose.connection.db;
        if (!db) {
            throw new Error(
                '[migration:slug-customized] mongoose.connection.db is undefined after connect'
            );
        }
        const result = await runMigration(db);

        console.log('[migration:slug-customized] applied', result);
    } finally {
        await mongoose.disconnect();
    }
}

if (require.main === module) {
    cli().catch((err) => {
        console.error('[migration:slug-customized] failed', err);
        process.exit(1);
    });
}
