/**
 * Sprint 28 ops-скрипт — дроп 4 legacy-колекцій, які лишились у сховищі від
 * знесених фіч і не мають жодної Mongoose-схеми в поточному коді.
 *
 * **Контекст.** Порівняння прод/дев баз показало 4 колекції-сироти:
 *
 * - `chat_messages`            — кабінетний AI-чат, знесений у Sprint 18
 *   (CLAUDE.md: «Колекцію chatmessages дропнути на проді вручну»).
 * - `executiontransactions`    — старий ledger «виконань» до переходу на
 *   CREDIT-модель; схема-файл видалено.
 * - `failedrecurringremovals`  — retry-черга видалення recurring-токена
 *   WayForPay; знесена після переходу на monobank (Sprint 22).
 * - `orphanedprovidercustomers` — залишок Stripe-ери (orphan-клієнти провайдера).
 *
 * grep по `apps/api/src` не знаходить жодної схеми чи посилання на ці колекції —
 * тож вони мертві. Скрипт їх прибирає.
 *
 * **Безпека.**
 * - Дропати можна ЛИШЕ імена з `LEGACY_COLLECTIONS` (жорсткий білий список).
 *   Будь-яке інше ім'я в коді відкинути неможливо — його тут просто немає.
 * - За замовчуванням це DRY-RUN: скрипт лише рахує документи й друкує, що
 *   зробив би. Реальний дроп — тільки з прапорцем `--force`.
 * - Idempotent: колекції, якої немає, тихо пропускаємо. Повторний прогін — no-op.
 *
 * **Незворотність.** Дроп видаляє дані назавжди. Перед `--force` на проді зробіть
 * бекап (restic-репо finly-backups) — відкат можливий лише з нього.
 *
 * `runMigration(db, { force })` exported для тестів і CLI-wrapper-а (той самий
 * патерн, що інші міграції у цій теці).
 */

import 'dotenv/config';
import mongoose from 'mongoose';

type Db = NonNullable<typeof mongoose.connection.db>;

/** Жорсткий білий список — дропати можна ТІЛЬКИ ці колекції. */
export const LEGACY_COLLECTIONS = [
    'chat_messages',
    'executiontransactions',
    'failedrecurringremovals',
    'orphanedprovidercustomers',
] as const;

export interface CollectionOutcome {
    name: string;
    /** Чи існувала колекція на момент прогону. */
    existed: boolean;
    /** Кількість документів (для аудиту перед дропом). */
    count: number;
    /** Чи справді дропнули (false у dry-run або якщо колекції не було). */
    dropped: boolean;
}

export interface MigrationResult {
    force: boolean;
    outcomes: CollectionOutcome[];
}

export interface RunOptions {
    /** Реально дропати. Без нього — лише dry-run (тільки рахуємо й друкуємо). */
    force?: boolean;
}

export async function runMigration(
    db: Db,
    { force = false }: RunOptions = {}
): Promise<MigrationResult> {
    const existing = new Set(
        (await db.listCollections({}, { nameOnly: true }).toArray()).map(
            (c) => c.name
        )
    );

    const outcomes: CollectionOutcome[] = [];

    for (const name of LEGACY_COLLECTIONS) {
        if (!existing.has(name)) {
            outcomes.push({ name, existed: false, count: 0, dropped: false });
            continue;
        }

        const count = await db.collection(name).countDocuments();

        let dropped = false;
        if (force) {
            await db.collection(name).drop();
            dropped = true;
        }

        outcomes.push({ name, existed: true, count, dropped });
    }

    return { force, outcomes };
}

/**
 * CLI entry point — connect → run → disconnect → log. Дзеркало інших
 * CLI-wrapper-ів у цій теці. Прапорець `--force` реально дропає; без нього dry-run.
 */
async function cli(): Promise<void> {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error(
            '[migration:drop-legacy] MONGODB_URI is required (export from .env or pass via docker-compose env_file)'
        );
        process.exit(1);
    }

    const force = process.argv.includes('--force');

    await mongoose.connect(uri);
    try {
        const db = mongoose.connection.db;
        if (!db) {
            throw new Error(
                '[migration:drop-legacy] mongoose.connection.db is undefined after connect'
            );
        }

        const result = await runMigration(db, { force });

        for (const o of result.outcomes) {
            if (!o.existed) {
                console.log(`[migration:drop-legacy] skip   ${o.name} (не існує)`);
            } else if (o.dropped) {
                console.log(
                    `[migration:drop-legacy] DROP   ${o.name} (${o.count} док.)`
                );
            } else {
                console.log(
                    `[migration:drop-legacy] would-drop ${o.name} (${o.count} док.) — dry-run, додайте --force`
                );
            }
        }

        if (!force) {
            console.log(
                '[migration:drop-legacy] dry-run завершено. Нічого не видалено. Для реального дропу: --force'
            );
        } else {
            console.log('[migration:drop-legacy] applied', {
                dropped: result.outcomes.filter((o) => o.dropped).map((o) => o.name),
            });
        }
    } finally {
        await mongoose.disconnect();
    }
}

if (require.main === module) {
    cli().catch((err) => {
        console.error('[migration:drop-legacy] failed', err);
        process.exit(1);
    });
}
