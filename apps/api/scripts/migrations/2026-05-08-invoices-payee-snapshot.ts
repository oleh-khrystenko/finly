/**
 * Sprint 4 review fix — backfill `payeeSnapshot` для existing invoices.
 *
 * **Проблема, яку фіксує snapshot.** До цього патчу public NBU/QR payload
 * для invoice будувався runtime з-під поточного `Business`-у:
 * `business.name`, `business.requisites.iban`, `business.requisites.taxId`,
 * `effectiveInvoicePurpose(invoice.paymentPurpose, business.paymentPurposeTemplate)`.
 * ФОП, що редагував реквізити після виставлення рахунку, тіньово міняв
 * payload вже-розданих посилань. Особливо погано для `with-purpose`-slug-у:
 * URL frozen на момент create, payload — runtime-resolve з нового template-у.
 *
 * Snapshot фрозить ці 4 поля у `Invoice.payeeSnapshot` на момент create.
 * Нові invoices (post-deploy) пишуть snapshot через `InvoicesService.create`.
 * Existing invoices не мають snapshot-у — payload-mapper fallback-ить на
 * live business (старий buggy patern, але обмежений legacy). Цей скрипт
 * backfill-ить snapshot для existing invoices з current business state.
 *
 * **Best-effort на migration boundary.** Якщо ФОП ВЖЕ редагував business
 * між create-нням invoice і запуском міграції — snapshot закине поточний
 * (already-edited) state, не "правильний" historical. Acceptable trade-off:
 * historical state вже втрачений (не сторили audit log), і подальші
 * редагування зафіксованого snapshot вже не зачеплять. Idempotent: повторний
 * запуск skipить вже-snapshot-ed invoices.
 *
 * **Idempotent.** Pass-2 `find`-filter `{ $or: [payeeSnapshot $exists:false,
 * payeeSnapshot: null] }` — на migrated-state матчить 0 docs, bulkWrite
 * не викликається. Re-run у CI/CD pipeline безпечний.
 *
 * **Two-pass: businesses-cache + bulkWrite invoices.** Mongo не дозволяє
 * `$lookup` всередині update-pipeline (`MongoServerError: $lookup is not
 * allowed to be used within an update`), тож aggregation-pipeline-update
 * не підходить для cross-collection-resolve. Замість N+1-find-update-loop-у
 * робимо: (1) load всіх businesses у пам'ять (типово 100-1000 docs у MVP);
 * (2) `find()` всіх invoices без snapshot-у; (3) `bulkWrite` updateOne-
 * операцій з resolved-snapshot-ом. Один round-trip на read-businesses +
 * один на read-invoices + один на bulkWrite. На 10k+ invoices — під 10
 * секунд. Memory-cap businesses-cache — acceptable до Sprint 6 scale-розмов.
 *
 * **Architectural decision via test/CI/prod виклик.** Той самий patern, що
 * `2026-05-03-businesses-slug-lower.ts`: `runMigration(db)` exported,
 * thin CLI-wrapper нижче для prod-deploy через docker-compose
 * profile `migrations`. Тести викликають `runMigration` напряму з
 * MongoMemoryServer-db.
 */

import 'dotenv/config';
import mongoose from 'mongoose';

type Db = NonNullable<typeof mongoose.connection.db>;

export const INVOICES_COLLECTION = 'invoices';
export const BUSINESSES_COLLECTION = 'businesses';

export interface MigrationResult {
    backfilledDocs: number;
}

interface BusinessShape {
    _id: unknown;
    name: string;
    requisites: { iban: string; taxId: string };
    paymentPurposeTemplate: string;
}

interface InvoiceShape {
    _id: unknown;
    businessId: unknown;
    paymentPurpose: string | null;
}

export async function runMigration(db: Db): Promise<MigrationResult> {
    // Untyped collections — bulkWrite + complex filters легше через generic
    // any-shaped collections; runtime-shape валідуємо через typed cursor-
    // mapping нижче.
    const invoices = db.collection(INVOICES_COLLECTION);
    const businesses = db.collection(BUSINESSES_COLLECTION);

    // Pass 1: load businesses у Map (businessId → business). Memory-cap у
    // MVP-масштабі (100-1000 businesses) acceptable.
    const businessMap = new Map<string, BusinessShape>();
    const businessCursor = businesses.find(
        {},
        {
            projection: {
                _id: 1,
                name: 1,
                'requisites.iban': 1,
                'requisites.taxId': 1,
                paymentPurposeTemplate: 1,
            },
        }
    );
    for await (const biz of businessCursor) {
        businessMap.set(String(biz._id), biz as unknown as BusinessShape);
    }

    // Pass 2: find invoices без snapshot-у і build bulkWrite-ops.
    const candidates = invoices.find(
        {
            $or: [
                { payeeSnapshot: { $exists: false } },
                { payeeSnapshot: null },
            ],
        },
        { projection: { _id: 1, businessId: 1, paymentPurpose: 1 } }
    );
    // bulkWrite-ops shape — у MongoDB driver-типах filter._id типує ObjectId;
    // у нашому контексті _id з Mongo завжди ObjectId, casting через `any`-
    // параметризацію ops-масиву safe-but-implicit; додатково casting на
    // bulkWrite-call.
    const ops: Array<Record<string, unknown>> = [];
    for await (const raw of candidates) {
        const inv = raw as unknown as InvoiceShape;
        const biz = businessMap.get(String(inv.businessId));
        if (!biz) {
            // Orphan invoice (businessId дереферс не знайшов business).
            // Skip: cascade-delete мав би зачистити, але не зачистив. Лог
            // не пишемо — silent skip acceptable для best-effort migration.
            continue;
        }
        ops.push({
            updateOne: {
                filter: { _id: inv._id },
                update: {
                    $set: {
                        payeeSnapshot: {
                            recipientName: biz.name,
                            iban: biz.requisites.iban,
                            taxId: biz.requisites.taxId,
                            paymentPurpose:
                                inv.paymentPurpose ?? biz.paymentPurposeTemplate,
                        },
                    },
                },
            },
        });
    }

    if (ops.length === 0) {
        return { backfilledDocs: 0 };
    }

    const result = await invoices.bulkWrite(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ops as any,
        { ordered: false }
    );
    return { backfilledDocs: result.modifiedCount };
}

async function cli(): Promise<void> {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        // eslint-disable-next-line no-console
        console.error(
            '[migration:invoices-payee-snapshot] MONGODB_URI is required'
        );
        process.exit(1);
    }
    await mongoose.connect(uri);
    try {
        const db = mongoose.connection.db;
        if (!db) {
            throw new Error(
                '[migration:invoices-payee-snapshot] mongoose.connection.db is undefined after connect'
            );
        }
        const result = await runMigration(db);
        // eslint-disable-next-line no-console
        console.log('[migration:invoices-payee-snapshot] applied', {
            backfilledDocs: result.backfilledDocs,
        });
    } finally {
        await mongoose.disconnect();
    }
}

if (require.main === module) {
    cli().catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[migration:invoices-payee-snapshot] failed', err);
        process.exit(1);
    });
}
