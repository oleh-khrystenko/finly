/**
 * One-shot OPS-скрипт (Sprint 22) — повне скидання білінгу на проді.
 *
 * **Контекст.** Перехід WayForPay → monobank. На проді лише тестові юзери, у
 * частини лишились оформлені підписки / one-off-покупки (зокрема legacy-залишки
 * WayForPay у субдоці `billing`). Треба чистий старт: у нікого жодної підписки і
 * жодної покупки.
 *
 * **Що робить.**
 *   1. `users.billing → null` — зносить підписку, one-off-доступ і будь-які
 *      legacy-поля провайдера. Занулення `cardToken`/`nextChargeAt` зупиняє
 *      billing-clock (крон без `nextChargeAt` у майбутньому підписку не чіпає).
 *   2. `users.executions → { balance: 0, freeReportUsed: false }` — покупки
 *      нараховували баланс; повертаємо дефолт.
 *   3. `paymentrecords` / `executiontransactions` / `processedwebhookevents` —
 *      повне видалення (історія платежів, ledger нарахувань, маркери вебхуків).
 *
 * **Поза `migration:all`.** Це деструктивна разова дія, НЕ міграція. Deploy-
 * контейнер ганяє `migration:all` на кожному деплої (apps/api/Dockerfile) —
 * додавання сюди витирало б білінг при кожному релізі. Тому окремий npm-script
 * `ops:reset-billing`, який запускається руками.
 *
 * **Запуск на проді** (через той самий migrations-image, з override команди):
 *   docker compose --profile migrations run --rm \
 *     -e CONFIRM_RESET_BILLING=yes api-migrations pnpm run ops:reset-billing
 *
 * Ідемпотентний: повторний прогін — no-op (нема що зануляти/видаляти).
 * Бізнеси/акаунти/інвойси НЕ чіпає.
 */

import 'dotenv/config';
import mongoose from 'mongoose';

type Db = NonNullable<typeof mongoose.connection.db>;

export const USERS_COLLECTION = 'users';
export const PAYMENT_RECORDS_COLLECTION = 'paymentrecords';
export const EXECUTION_TRANSACTIONS_COLLECTION = 'executiontransactions';
export const PROCESSED_WEBHOOK_EVENTS_COLLECTION = 'processedwebhookevents';

export interface ResetResult {
    billingCleared: number;
    executionsReset: number;
    paymentRecordsDeleted: number;
    executionTransactionsDeleted: number;
    webhookEventsDeleted: number;
}

export async function runReset(db: Db): Promise<ResetResult> {
    const billing = await db
        .collection(USERS_COLLECTION)
        .updateMany({ billing: { $ne: null } }, { $set: { billing: null } });

    const executions = await db.collection(USERS_COLLECTION).updateMany(
        {
            $or: [
                { 'executions.balance': { $ne: 0 } },
                { 'executions.freeReportUsed': { $ne: false } },
            ],
        },
        { $set: { executions: { balance: 0, freeReportUsed: false } } }
    );

    const payments = await db
        .collection(PAYMENT_RECORDS_COLLECTION)
        .deleteMany({});

    const ledger = await db
        .collection(EXECUTION_TRANSACTIONS_COLLECTION)
        .deleteMany({});

    const webhooks = await db
        .collection(PROCESSED_WEBHOOK_EVENTS_COLLECTION)
        .deleteMany({});

    return {
        billingCleared: billing.modifiedCount,
        executionsReset: executions.modifiedCount,
        paymentRecordsDeleted: payments.deletedCount ?? 0,
        executionTransactionsDeleted: ledger.deletedCount ?? 0,
        webhookEventsDeleted: webhooks.deletedCount ?? 0,
    };
}

async function cli(): Promise<void> {
    if (process.env.CONFIRM_RESET_BILLING !== 'yes') {
        console.error(
            '[ops:reset-billing] ВІДМОВА: деструктивна дія. Запусти з CONFIRM_RESET_BILLING=yes'
        );
        process.exit(1);
    }

    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error(
            '[ops:reset-billing] MONGODB_URI is required (export from .env or pass via docker-compose env_file)'
        );
        process.exit(1);
    }

    await mongoose.connect(uri);
    try {
        const db = mongoose.connection.db;
        if (!db) {
            throw new Error(
                '[ops:reset-billing] mongoose.connection.db is undefined after connect'
            );
        }
        const result = await runReset(db);
        console.log('[ops:reset-billing] applied', result);
    } finally {
        await mongoose.disconnect();
    }
}

if (require.main === module) {
    cli().catch((err) => {
        console.error('[ops:reset-billing] failed', err);
        process.exit(1);
    });
}
