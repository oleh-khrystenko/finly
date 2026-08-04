/**
 * Migration — прибирає з користувачів власний РНОКПП і стемп відмови від
 * пропозиції його заповнити.
 *
 * **Контекст.** Sprint 30 завів `profile.taxId` як джерело підстановки на
 * податковій сторінці. Джерелом натомість стали отримувачі-фізособи самого
 * користувача (`Business.taxId` для типів з РНОКПП), тож поле в профілі —
 * друга копія того самого номера, яка розходиться з першою після найближчого
 * редагування отримувача. Разом з полем зникає одноразова пропозиція його
 * заповнити, а отже і `taxProfilePromptDismissedAt`.
 *
 * **Чому міграція, а не «просто прибрати з коду».** `profile.taxId` — це
 * податковий номер живої людини. Прибрати поле зі схеми означає перестати його
 * показувати, але не перестати зберігати: він так і лежав би у сховищі, у
 * бекапах і у вивантаженнях, без жодного способу подивитись чи видалити його з
 * інтерфейсу.
 *
 * **Idempotent.** Обидва `updateMany` звужені на `{ $exists: true }`; повторний
 * прогін — no-op.
 */

import 'dotenv/config';
import mongoose from 'mongoose';

type Db = NonNullable<typeof mongoose.connection.db>;

export const USERS_COLLECTION = 'users';

export interface MigrationResult {
    taxIdsRemoved: number;
    promptStampsRemoved: number;
}

export async function runMigration(db: Db): Promise<MigrationResult> {
    const users = db.collection(USERS_COLLECTION);

    const taxId = await users.updateMany(
        { 'profile.taxId': { $exists: true } },
        { $unset: { 'profile.taxId': '' } }
    );
    const prompt = await users.updateMany(
        { taxProfilePromptDismissedAt: { $exists: true } },
        { $unset: { taxProfilePromptDismissedAt: '' } }
    );

    return {
        taxIdsRemoved: taxId.modifiedCount,
        promptStampsRemoved: prompt.modifiedCount,
    };
}

/** CLI entry point — connect → run → disconnect → log. */
async function cli(): Promise<void> {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error(
            '[migration:drop-user-tax-profile] MONGODB_URI is required (export from .env or pass via docker-compose env_file)'
        );
        process.exit(1);
    }

    await mongoose.connect(uri);
    try {
        const db = mongoose.connection.db;
        if (!db) {
            throw new Error(
                '[migration:drop-user-tax-profile] mongoose.connection.db is undefined after connect'
            );
        }
        const result = await runMigration(db);

        console.log('[migration:drop-user-tax-profile] applied', result);
    } finally {
        await mongoose.disconnect();
    }
}

if (require.main === module) {
    cli().catch((err) => {
        console.error('[migration:drop-user-tax-profile] failed', err);
        process.exit(1);
    });
}
