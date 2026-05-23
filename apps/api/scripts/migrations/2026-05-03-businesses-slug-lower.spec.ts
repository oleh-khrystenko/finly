import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import {
    COLLECTION_NAME,
    NEW_INDEX_NAME,
    OLD_INDEX_NAME,
    runMigration,
} from './2026-05-03-businesses-slug-lower';

/**
 * Sprint 3 §3.1 migration spec — повне покриття upgrade-path-у:
 * (а) старий index видаляється,
 * (б) `slugLower` бекфіл-иться як `toLower(slug)`,
 * (в) новий unique index створюється,
 * (г) повторний запуск — no-op (idempotent),
 * (д) duplicate-key collision на pre-існуючих case-vary slug-ах ламає
 *     створення index-у (fail-safe behavior — правильна реакція на
 *     невалідний legacy-стан).
 *
 * Тест запускається на MongoMemoryServer (як `business.schema.spec.ts`) —
 * без NestJS DI, без mongoose-моделей. Migration працює з raw `Db`
 * напряму, тому ця ізоляція природна.
 */

const VALID_TAX_ID = '1234567899';
const VALID_IBAN = 'UA213223130000026007233566001';

const buildLegacyDoc = (overrides: Record<string, unknown> = {}) => ({
    type: 'fop',
    ownerId: new mongoose.Types.ObjectId(),
    managers: [],
    slug: 'IvanEnko-FOP',
    name: 'Іваненко',
    requisites: { iban: VALID_IBAN, taxId: VALID_TAX_ID },
    paymentPurposeTemplate: 'Оплата за послуги',
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
});

describe('migration 2026-05-03-businesses-slug-lower (upgrade-path)', () => {
    let mongoServer: MongoMemoryServer;

    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        await mongoose.connect(mongoServer.getUri());
    }, 60_000);

    afterAll(async () => {
        await mongoose.disconnect();
        await mongoServer.stop();
    });

    afterEach(async () => {
        const db = mongoose.connection.db!;
        const cols = await db
            .listCollections({ name: COLLECTION_NAME })
            .toArray();
        if (cols.length > 0) {
            await db.collection(COLLECTION_NAME).drop();
        }
    });

    /**
     * Засіває БД у Sprint 1 стані: документи без `slugLower` + старий
     * unique-index `{ slug: 1 }`. Симулює production, що довго прожив на
     * Sprint 1 моделі і тепер upgrade-иться до Sprint 3.
     */
    async function seedLegacyState(slugs: string[]): Promise<void> {
        const db = mongoose.connection.db!;
        const collection = db.collection(COLLECTION_NAME);
        if (slugs.length > 0) {
            await collection.insertMany(
                slugs.map((slug) => buildLegacyDoc({ slug }))
            );
        }
        // Старий Sprint 1 index — unique на slug, name = slug_1.
        // Якщо вставка вище створила індекс автоматично — попередньо
        // переконуємося, що ім'я співпадає (Mongo за замовчуванням генерує
        // `<field>_1` при створенні).
        await collection.createIndex(
            { slug: 1 },
            { unique: true, name: OLD_INDEX_NAME }
        );
    }

    it('(а) drop старого {slug:1} unique index при наявності', async () => {
        await seedLegacyState(['ivanenko-fop']);
        const db = mongoose.connection.db!;
        const result = await runMigration(db);
        expect(result.droppedOldIndex).toBe(true);

        const indexes = await db.collection(COLLECTION_NAME).indexes();
        expect(indexes.find((i) => i.name === OLD_INDEX_NAME)).toBeUndefined();
    });

    it('(б) backfill slugLower як toLower(slug) для документів без поля', async () => {
        await seedLegacyState(['IvanEnko-FOP', 'PETRENKO', 'mixed-Case']);
        const db = mongoose.connection.db!;

        const result = await runMigration(db);
        expect(result.backfilledDocs).toBe(3);

        const docs = await db
            .collection(COLLECTION_NAME)
            .find({}, { projection: { slug: 1, slugLower: 1 } })
            .toArray();
        const map = new Map(
            docs.map((d) => [d.slug as string, d.slugLower as string])
        );
        expect(map.get('IvanEnko-FOP')).toBe('ivanenko-fop');
        expect(map.get('PETRENKO')).toBe('petrenko');
        expect(map.get('mixed-Case')).toBe('mixed-case');
    });

    it('(в) створює unique slugLower index', async () => {
        await seedLegacyState(['ivanenko-fop']);
        const db = mongoose.connection.db!;

        await runMigration(db);

        const indexes = await db.collection(COLLECTION_NAME).indexes();
        const slugLowerIdx = indexes.find((i) => i.name === NEW_INDEX_NAME);
        expect(slugLowerIdx).toBeDefined();
        expect(slugLowerIdx?.unique).toBe(true);
        expect(slugLowerIdx?.key).toEqual({ slugLower: 1 });
    });

    it('(г) повторний запуск — no-op (idempotent)', async () => {
        await seedLegacyState(['ivanenko-fop']);
        const db = mongoose.connection.db!;

        const first = await runMigration(db);
        expect(first.droppedOldIndex).toBe(true);
        expect(first.backfilledDocs).toBe(1);

        const second = await runMigration(db);
        expect(second.droppedOldIndex).toBe(false); // index уже видалений
        expect(second.backfilledDocs).toBe(0); // нічого backfill-ити
        expect(second.createdNewIndex).toBe(true); // createIndex ідемпотентний

        // Index лишається на місці після другого run-у.
        const indexes = await db.collection(COLLECTION_NAME).indexes();
        expect(indexes.find((i) => i.name === NEW_INDEX_NAME)?.unique).toBe(
            true
        );
    });

    it('greenfield (collection не існує) — створює тільки новий index, не падає на drop', async () => {
        // Симулюємо first-deploy без legacy-даних: collection взагалі немає,
        // dropIndex кидає `IndexNotFound` — migration ловить і continue.
        const db = mongoose.connection.db!;

        const result = await runMigration(db);
        expect(result.droppedOldIndex).toBe(false);
        expect(result.backfilledDocs).toBe(0);
        expect(result.createdNewIndex).toBe(true);

        const indexes = await db.collection(COLLECTION_NAME).indexes();
        expect(indexes.find((i) => i.name === NEW_INDEX_NAME)).toBeDefined();
    });

    it('(д) fail-safe: duplicate slugLower (case-vary legacy) ламає migration з code 11000', async () => {
        // Sprint 3 рішення E1 робить case-insensitive uniqueness інваріантом.
        // Якщо у legacy-БД жили `Foo` і `foo` як два різні документи — після
        // backfill вони обидва матимуть `slugLower=foo`, і новий unique-index
        // не зможе побудуватися. Migration falls з MongoServerError 11000 —
        // правильна реакція. Resolution: rename одного з документів вручну,
        // потім re-run.
        await seedLegacyState(['Foo', 'foo']);
        const db = mongoose.connection.db!;

        await expect(runMigration(db)).rejects.toMatchObject({
            code: 11000,
        });
    });
});
