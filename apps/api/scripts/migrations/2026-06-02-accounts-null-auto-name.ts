/**
 * Sprint design-fix migration — занулює матеріалізовану авто-назву рахунку.
 *
 * **Контекст.** До цієї зміни `AccountsService.create` матеріалізував у поле
 * `name` рядок `"{BANK_LABEL[bankCode]} •{last4}"` (або `"Банк •{last4}"` на
 * нерозпізнаному банку), якщо клієнт не передав власну назву. Це дублювалося з
 * bank-label/mask-рядками у картці рахунку (негармонійна розкладка). Тепер
 * відсутність назви = `name: null`, а display-лейбл деривується на льоту
 * (`deriveAccountLabel`). Ця міграція приводить існуючі документи у відповідність:
 * де `name` дорівнює перерахованому авто-формату — занулюємо.
 *
 * **Чому порівняння, а не сліпе занулення.** Користувач міг ввести власну
 * назву ("Основний", "Для податків") — її чіпати не можна. Авто-формат
 * детермінований з `(bankCode, iban)`, які зберігаються у документі, тож
 * перерахунок безпечний. Edge: ФОП, що вручну ввів рядок ідентичний авто-формату
 * ("ПриватБанк •2580"), теж занулиться — display не зміниться (deriveAccountLabel
 * віддасть той самий рядок), тож це нешкідливо.
 *
 * **Idempotent.** Повторний запуск — no-op: занулені документи мають `name: null`
 * (не string), тому випадають з фільтра `name: { $type: 'string' }`.
 *
 * **Виклик** — той самий патерн, що `2026-05-03-businesses-slug-lower`:
 * `runMigration(db)` exported для тестів і CLI-wrapper-а.
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { BANK_LABEL, type BankCode } from '@finly/types';

type Db = NonNullable<typeof mongoose.connection.db>;

export const COLLECTION_NAME = 'accounts';

interface AccountDoc {
    _id: unknown;
    name?: string | null;
    bankCode?: BankCode | null;
    iban?: string;
}

export interface MigrationResult {
    scanned: number;
    nulled: number;
}

/**
 * Перераховує авто-назву, яку service матеріалізував до зміни. МУСИТЬ дослівно
 * збігатися з історичним форматом, інакше legitimate авто-назви не занулилися б.
 */
export function expectedAutoName(
    bankCode: BankCode | null | undefined,
    iban: string
): string {
    const last4 = iban.slice(-4);
    return bankCode ? `${BANK_LABEL[bankCode]} •${last4}` : `Банк •${last4}`;
}

export async function runMigration(db: Db): Promise<MigrationResult> {
    const collection = db.collection<AccountDoc>(COLLECTION_NAME);

    // Лише документи з рядковим name — null/missing уже у бажаному стані.
    const cursor = collection.find({ name: { $type: 'string' } });

    let scanned = 0;
    let nulled = 0;
    // `[number]` дістає (mutable) елемент-тип з readonly-сигнатури bulkWrite.
    const ops: Parameters<typeof collection.bulkWrite>[0][number][] = [];

    for await (const doc of cursor) {
        scanned += 1;
        if (typeof doc.name !== 'string' || typeof doc.iban !== 'string') {
            continue;
        }
        if (doc.name === expectedAutoName(doc.bankCode ?? null, doc.iban)) {
            ops.push({
                updateOne: {
                    filter: { _id: doc._id },
                    update: { $set: { name: null } },
                },
            });
            nulled += 1;
        }
    }

    if (ops.length > 0) {
        await collection.bulkWrite(ops);
    }

    return { scanned, nulled };
}

/**
 * CLI entry point — connect → run → disconnect → log. Дзеркало
 * `2026-05-03-businesses-slug-lower` CLI-wrapper-а (deploy.yml migrations-profile).
 */
async function cli(): Promise<void> {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error(
            '[migration:accounts-null-auto-name] MONGODB_URI is required (export from .env or pass via docker-compose env_file)'
        );
        process.exit(1);
    }

    await mongoose.connect(uri);
    try {
        const db = mongoose.connection.db;
        if (!db) {
            throw new Error(
                '[migration:accounts-null-auto-name] mongoose.connection.db is undefined after connect'
            );
        }
        const result = await runMigration(db);

        console.log('[migration:accounts-null-auto-name] applied', {
            scanned: result.scanned,
            nulled: result.nulled,
        });
    } finally {
        await mongoose.disconnect();
    }
}

if (require.main === module) {
    cli().catch((err) => {
        console.error('[migration:accounts-null-auto-name] failed', err);
        process.exit(1);
    });
}
