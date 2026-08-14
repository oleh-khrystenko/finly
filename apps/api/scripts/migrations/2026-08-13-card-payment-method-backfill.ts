/**
 * Backfill способу оплати на історичних списаннях і білінг-профілях.
 *
 * **Контекст.** До цієї зміни з `paymentInfo` monobank ми брали лише
 * `maskedPan`. Для Apple Pay / Google Pay цей номер належить не картці платника,
 * а підставному номеру пристрою, тож кабінет показував цифри, у яких людина не
 * впізнавала свою картку. Тепер поруч зберігаються `cardPaymentMethod`,
 * `cardPaymentSystem` і `cardBank`, і цифри показуються лише коли вони справді
 * від картки (`hasRealCardNumber`). Сирі відповіді провайдера ми не зберігали,
 * тому для вже наявних записів спосіб оплати доводиться перепитувати у monobank
 * за збереженим `providerTransactionId` (= invoiceId).
 *
 * **Профіль.** Спосіб оплати профілю береться з найсвіжішого УСПІШНОГО списання,
 * яке не `wallet`: `wallet` — це списання збереженим токеном (будь-яке циклове
 * продовження), воно не каже, чим картку прив'язували, а невдала спроба взагалі
 * не каже нічого про прив'язану картку (платник міг ввести там іншу і не
 * заплатити). Та сама логіка, що `cardProfileFields` у рантаймі.
 *
 * **Помилки провайдера ≠ «рахунку немає».** Ліміт частоти, збій monobank чи
 * обрив мережі не роблять запис безнадійним — такі йдуть у `recordsFailed`,
 * лишаються без способу оплати і добираються наступним прогоном. У `notFound`
 * потрапляє лише відповідь, у якій провайдер сам сказав, що оплати за цим
 * рахунком немає (застара історія, інший мерчант) — це фінальний стан.
 * Відмова у доступі (не той токен) — не відповідь про рахунок узагалі: прогін
 * зупиняється помилкою, інакше весь звіт склався б із фальшивих «немає такого
 * рахунку», і history виглядала б безнадійною, хоч її ніхто не питав.
 *
 * **Профіль чекає на повний набір.** Якщо хоч одне списання платника лишилось
 * нерозвʼязаним, його профіль цього прогону не чіпаємо (`profilesDeferred`):
 * інакше на профіль сів би спосіб оплати з ДАВНІШОЇ оплати, наступний прогін
 * такий профіль уже пропустив би (поле заповнене), і помилка застигла б назавжди.
 *
 * **Idempotent.** Беруться лише записи без `cardPaymentMethod`; повторний
 * прогін перепитує тільки те, що лишилось нерозвʼязаним.
 *
 * Не входить у `migration:all`: потребує `MONOBANK_TOKEN` і мережевих викликів
 * до провайдера, тож запускається окремо і усвідомлено.
 */

import 'dotenv/config';
import {
    PAYMENT_RECORD_STATUS,
    toCardPaymentMethod,
    type CardDetails,
} from '@finly/types';
import mongoose from 'mongoose';
import {
    MONOBANK_API_BASE,
    MONOBANK_INVOICE_STATUS,
    MONOBANK_REQUEST_TIMEOUT_MS,
    cardDetailsFromPayload,
} from '../../src/modules/payments/providers/monobank/monobank.contract';
import {
    asRecord,
    str,
} from '../../src/modules/payments/providers/monobank/monobank.signature';
import {
    cardProfileFields,
    cardRecordFields,
} from '../../src/modules/payments/card-details';

type Db = NonNullable<typeof mongoose.connection.db>;

export const PAYMENT_RECORDS_COLLECTION = 'paymentrecords';
export const BILLING_PROFILES_COLLECTION = 'billingprofiles';

/** monobank лімітує частоту запитів; пауза тримає прогін у межах ліміту. */
const REQUEST_SPACING_MS = 400;

export interface MigrationResult {
    recordsResolved: number;
    recordsNotFound: number;
    /** Провайдер не відповів (ліміт/збій/мережа) — добере наступний прогін. */
    recordsFailed: number;
    profilesUpdated: number;
    /** Профілі, відкладені до прогону, у якому всі їх списання розвʼязані. */
    profilesDeferred: number;
}

/**
 * `resolved` — провайдер віддав дані картки; `absent` — провайдер відповів, але
 * оплати за цим рахунком у нього немає (фінально); `failed` — відповіді не було
 * або вона нечитабельна, тобто питання лишається відкритим; `denied` — провайдер
 * не впустив нас узагалі (токен), тобто про рахунок він нічого не сказав.
 */
export type InvoiceLookup =
    | { outcome: 'resolved'; details: CardDetails }
    | { outcome: 'absent' }
    | { outcome: 'failed'; reason: string }
    | { outcome: 'denied'; reason: string };

/**
 * Коди, які НЕ є відповіддю про конкретний рахунок: 401/403 — не впустили,
 * 408/429 і 5xx — тимчасове. Решта 4xx означає, що провайдер запит розібрав і
 * оплати у себе не знайшов.
 */
const ACCESS_DENIED_STATUSES = new Set([401, 403]);
const TRANSIENT_STATUSES = new Set([408, 429]);

export async function fetchInvoiceCardDetails(
    invoiceId: string,
    token: string
): Promise<InvoiceLookup> {
    let res: Awaited<ReturnType<typeof fetch>>;
    try {
        res = await fetch(
            `${MONOBANK_API_BASE}${MONOBANK_INVOICE_STATUS}` +
                `?invoiceId=${encodeURIComponent(invoiceId)}`,
            {
                headers: { 'X-Token': token },
                signal: AbortSignal.timeout(MONOBANK_REQUEST_TIMEOUT_MS),
            }
        );
    } catch (err) {
        const reason =
            err instanceof Error && err.name === 'TimeoutError'
                ? `timeout after ${MONOBANK_REQUEST_TIMEOUT_MS}ms`
                : err instanceof Error
                  ? err.message
                  : 'network error';
        return { outcome: 'failed', reason };
    }

    const body = asRecord(await res.json().catch(() => null));
    if (!res.ok) {
        const detail = body
            ? (str(body.errText) ?? str(body.errCode) ?? 'unknown')
            : 'unreadable body';
        const reason = `HTTP ${res.status}: ${detail}`;
        if (ACCESS_DENIED_STATUSES.has(res.status))
            return { outcome: 'denied', reason };
        if (res.status >= 500 || TRANSIENT_STATUSES.has(res.status))
            return { outcome: 'failed', reason };
        return { outcome: 'absent' };
    }
    if (!body) return { outcome: 'failed', reason: 'unreadable body' };
    if (!asRecord(body.paymentInfo)) return { outcome: 'absent' };
    return { outcome: 'resolved', details: cardDetailsFromPayload(body) };
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runMigration(
    db: Db,
    token: string,
    spacingMs: number = REQUEST_SPACING_MS
): Promise<MigrationResult> {
    const records = await db
        .collection(PAYMENT_RECORDS_COLLECTION)
        .find({
            providerTransactionId: { $ne: null },
            $or: [
                { cardPaymentMethod: { $exists: false } },
                { cardPaymentMethod: null },
            ],
        })
        .toArray();

    let recordsResolved = 0;
    let recordsNotFound = 0;
    let recordsFailed = 0;
    // Платники, у яких лишилось хоч одне нерозвʼязане списання: їх профілі
    // цього прогону не чіпаємо (див. «Профіль чекає на повний набір»).
    const unresolvedUserIds = new Set<string>();

    for (const [index, record] of records.entries()) {
        const invoiceId = str(record.providerTransactionId);
        if (!invoiceId) continue;
        if (index > 0) await sleep(spacingMs);

        const lookup = await fetchInvoiceCardDetails(invoiceId, token);
        if (lookup.outcome === 'denied') {
            // Не впустили — далі буде те саме на кожному рахунку. Продовжувати
            // означало б зібрати звіт із фальшивих «оплати немає».
            throw new Error(
                '[migration:card-payment-method] monobank denied access ' +
                    `(${lookup.reason}) — перевірте MONOBANK_TOKEN. ` +
                    `Оновлено до зупинки: ${recordsResolved} запис(ів).`
            );
        }
        if (lookup.outcome === 'failed') {
            recordsFailed += 1;
            unresolvedUserIds.add(String(record.userId));
            console.warn(
                `[migration:card-payment-method] invoice ${invoiceId} unresolved: ${lookup.reason}`
            );
            continue;
        }
        if (lookup.outcome === 'absent') {
            recordsNotFound += 1;
            continue;
        }
        const set = cardRecordFields(lookup.details);
        if (Object.keys(set).length === 0) {
            recordsNotFound += 1;
            continue;
        }
        await db
            .collection(PAYMENT_RECORDS_COLLECTION)
            .updateOne({ _id: record._id }, { $set: set });
        recordsResolved += 1;
    }

    // Профіль дзеркалить найсвіжіше успішне НЕ-`wallet` списання платника: саме
    // там платник обирав, чим платити. Записи вже оновлені вище, тож вибірка
    // бачить і щойно добуті способи.
    const profiles = await db
        .collection(BILLING_PROFILES_COLLECTION)
        .find({
            $or: [
                { cardPaymentMethod: { $exists: false } },
                { cardPaymentMethod: null },
            ],
        })
        .toArray();

    let profilesUpdated = 0;
    let profilesDeferred = 0;
    for (const profile of profiles) {
        // Неповна історія дала б профілю спосіб оплати з давнішої оплати, а
        // наступний прогін цей профіль уже не побачив би — поле заповнене.
        if (unresolvedUserIds.has(String(profile.userId))) {
            profilesDeferred += 1;
            continue;
        }
        const source = await db
            .collection(PAYMENT_RECORDS_COLLECTION)
            .find({
                userId: profile.userId,
                status: PAYMENT_RECORD_STATUS.APPROVED,
                cardPaymentMethod: { $nin: [null, 'wallet'] },
            })
            .sort({ createdAt: -1 })
            .limit(1)
            .toArray();
        const latest = source[0];
        if (!latest) continue;

        const set = cardProfileFields({
            cardMask: str(latest.cardMask),
            cardPaymentMethod: toCardPaymentMethod(
                str(latest.cardPaymentMethod)
            ),
            cardPaymentSystem: str(latest.cardPaymentSystem),
            cardBank: str(latest.cardBank),
        });
        // Номер картки на профілі вже актуальний (його вів рантайм) — беквіл
        // доповнює лише опис картки, інакше зсунув би маску на давнішу оплату.
        delete set.cardMask;
        if (Object.keys(set).length === 0) continue;

        await db
            .collection(BILLING_PROFILES_COLLECTION)
            .updateOne({ _id: profile._id }, { $set: set });
        profilesUpdated += 1;
    }

    return {
        recordsResolved,
        recordsNotFound,
        recordsFailed,
        profilesUpdated,
        profilesDeferred,
    };
}

async function cli(): Promise<void> {
    const uri = process.env.MONGODB_URI;
    const token = process.env.MONOBANK_TOKEN;
    if (!uri) {
        console.error(
            '[migration:card-payment-method] MONGODB_URI is required (export from .env or pass via docker-compose env_file)'
        );
        process.exit(1);
    }
    if (!token) {
        console.error(
            '[migration:card-payment-method] MONOBANK_TOKEN is required: спосіб оплати перепитується у провайдера за invoiceId'
        );
        process.exit(1);
    }

    await mongoose.connect(uri);
    try {
        const db = mongoose.connection.db;
        if (!db) {
            throw new Error(
                '[migration:card-payment-method] mongoose.connection.db is undefined after connect'
            );
        }
        const result = await runMigration(db, token);

        console.log('[migration:card-payment-method] applied', result);
        if (result.recordsFailed > 0) {
            console.warn(
                `[migration:card-payment-method] ${result.recordsFailed} record(s) left unresolved ` +
                    `(provider unavailable), ${result.profilesDeferred} profile(s) deferred ` +
                    '— run the migration again to pick them up'
            );
        }
    } finally {
        await mongoose.disconnect();
    }
}

if (require.main === module) {
    cli().catch((err) => {
        console.error('[migration:card-payment-method] failed', err);
        process.exit(1);
    });
}
