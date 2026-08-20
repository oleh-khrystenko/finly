/**
 * Sprint 32 ops-скрипт — разова чистка отримувачів, що лишились після видалених
 * акаунтів.
 *
 * **Контекст.** До цього спринту прибирання видаленого акаунта не торкалось
 * отримувачів узагалі: воно гасило платіжний профіль, відкликало сесії і
 * видаляло сам запис людини. Отримувачі лишались у базі з посиланням на людину,
 * якої вже немає, разом з реквізитами, виставленими рахунками, зайнятими
 * іменами і живими публічними сторінками. Спринт закриває прогалину на майбутнє;
 * цей скрипт розбирає те, що вже накопичилось.
 *
 * **Що таке сирота.** НЕ «запис без власника» — рівно так виглядають два види
 * цілком живих записів: системні отримувачі каталогу (створені адміном, власника
 * не мають за задумом) і клієнтські записи бухгалтера (без власника, людина у
 * менеджерах). Сирота — це запис, за яким не лишилось ЖОДНОЇ живої людини:
 * посилання на власника обірване (або власника немає), і серед менеджерів теж
 * немає жодного наявного користувача.
 *
 * Запис з обірваним власником, але живим менеджером, сиротою не є. Це той самий
 * випадок «за отримувачем лишається ще хтось»: у ньому обнуляється власник і
 * прибираються мертві менеджери, а сам запис живе далі.
 *
 * **Безпека.**
 * - Системні отримувачі каталогу виключені явним фільтром і не потрапляють ні у
 *   показ, ні у видалення.
 * - За замовчуванням це DRY-RUN: скрипт лише рахує й друкує, що зробив би.
 *   Реальні зміни — тільки з прапорцем `--force`.
 * - Кожен каскад іде однією транзакцією: або зникає весь граф отримувача, або
 *   нічого. Потрібен replica-set (той самий інваріант, що у кабінетному
 *   видаленні).
 * - Idempotent: повторний прогін після `--force` не знаходить нічого.
 *
 * **Незворотність.** Видалення остаточне. Перед `--force` на проді зробіть бекап
 * (restic-репо finly-backups) — відкат можливий лише з нього.
 *
 * `runMigration(db, { force })` exported для тестів і CLI-wrapper-а (той самий
 * патерн, що інші міграції у цій теці).
 */

import 'dotenv/config';
import mongoose, { Types } from 'mongoose';

type Db = NonNullable<typeof mongoose.connection.db>;

const BUSINESSES = 'businesses';
const USERS = 'users';

/** Колекції піддерева отримувача, які каскад забирає разом з ним. */
const NESTED_COLLECTIONS = [
    'invoices',
    'accounts',
    'invoiceslugcounters',
    'businessslughistories',
    'accountslughistories',
    'invoiceslughistories',
] as const;

interface BusinessRow {
    _id: Types.ObjectId;
    name: string;
    slug: string;
    ownerId: Types.ObjectId | null;
    managers?: Types.ObjectId[];
}

export interface OrphanOutcome {
    id: string;
    name: string;
    slug: string;
    accountsCount: number;
    invoicesCount: number;
    /** Чи справді видалили (false у dry-run). */
    deleted: boolean;
}

export interface DetachedOwnerOutcome {
    id: string;
    name: string;
    slug: string;
    /** Скільки мертвих посилань на менеджерів прибрано. */
    deadManagers: number;
    /** Чи справді нормалізували (false у dry-run). */
    updated: boolean;
}

export interface MigrationResult {
    force: boolean;
    scanned: number;
    orphans: OrphanOutcome[];
    detachedOwners: DetachedOwnerOutcome[];
}

export interface RunOptions {
    /** Реально видаляти й нормалізувати. Без нього — лише показ. */
    force?: boolean;
}

export async function runMigration(
    db: Db,
    { force = false }: RunOptions = {}
): Promise<MigrationResult> {
    const businesses = await db
        .collection<BusinessRow>(BUSINESSES)
        .find({
            isSystem: { $ne: true },
            $or: [
                { ownerId: { $type: 'objectId' } },
                { managers: { $ne: [] } },
            ],
        })
        .project<BusinessRow>({ name: 1, slug: 1, ownerId: 1, managers: 1 })
        .toArray();

    const referenced = new Set<string>();
    for (const business of businesses) {
        if (business.ownerId) referenced.add(business.ownerId.toString());
        for (const manager of business.managers ?? []) {
            referenced.add(manager.toString());
        }
    }

    const liveUsers = await db
        .collection(USERS)
        .find(
            {
                _id: {
                    $in: [...referenced].map((id) => new Types.ObjectId(id)),
                },
            },
            { projection: { _id: 1 } }
        )
        .toArray();
    const live = new Set(liveUsers.map((u) => u._id.toString()));

    const orphans: OrphanOutcome[] = [];
    const detachedOwners: DetachedOwnerOutcome[] = [];

    for (const business of businesses) {
        const managers = business.managers ?? [];
        const liveManagers = managers.filter((id) => live.has(id.toString()));
        const ownerAlive =
            business.ownerId !== null && live.has(business.ownerId.toString());

        if (!ownerAlive && liveManagers.length === 0) {
            orphans.push(await collectOrphan(db, business, force));
            continue;
        }

        const deadManagers = managers.length - liveManagers.length;
        const ownerBroken = business.ownerId !== null && !ownerAlive;
        if (!ownerBroken && deadManagers === 0) continue;

        if (force) {
            await db.collection(BUSINESSES).updateOne(
                { _id: business._id },
                {
                    $set: {
                        ...(ownerBroken ? { ownerId: null } : {}),
                        managers: liveManagers,
                    },
                }
            );
        }
        detachedOwners.push({
            id: business._id.toString(),
            name: business.name,
            slug: business.slug,
            deadManagers,
            updated: force,
        });
    }

    return { force, scanned: businesses.length, orphans, detachedOwners };
}

/**
 * Рахує піддерево сироти і, у `--force`, зносить його однією транзакцією.
 * Порядок видалення — знизу вгору, як у кабінетному каскаді: сам отримувач
 * зникає останнім, тож перерваний прохід лишає запис, за яким залишок ще можна
 * знайти.
 */
async function collectOrphan(
    db: Db,
    business: BusinessRow,
    force: boolean
): Promise<OrphanOutcome> {
    const businessId = business._id;
    const accountsCount = await db
        .collection('accounts')
        .countDocuments({ businessId });
    const invoicesCount = await db
        .collection('invoices')
        .countDocuments({ businessId });

    if (force) {
        const session = db.client.startSession();
        try {
            await session.withTransaction(async () => {
                for (const name of NESTED_COLLECTIONS) {
                    await db
                        .collection(name)
                        .deleteMany({ businessId }, { session });
                }
                await db
                    .collection(BUSINESSES)
                    .deleteOne({ _id: businessId }, { session });
            });
        } finally {
            await session.endSession();
        }
    }

    return {
        id: businessId.toString(),
        name: business.name,
        slug: business.slug,
        accountsCount,
        invoicesCount,
        deleted: force,
    };
}

/**
 * CLI entry point — connect → run → disconnect → log. Дзеркало інших
 * CLI-wrapper-ів у цій теці. Прапорець `--force` реально змінює базу; без нього
 * лише показ.
 */
async function cli(): Promise<void> {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error(
            '[migration:orphan-businesses] MONGODB_URI is required (export from .env or pass via docker-compose env_file)'
        );
        process.exit(1);
    }

    const force = process.argv.includes('--force');

    await mongoose.connect(uri);
    try {
        const db = mongoose.connection.db;
        if (!db) {
            throw new Error(
                '[migration:orphan-businesses] mongoose.connection.db is undefined after connect'
            );
        }

        const result = await runMigration(db, { force });

        console.log(
            `[migration:orphan-businesses] переглянуто ${result.scanned} отримувач(ів) з посиланнями на людей`
        );
        for (const orphan of result.orphans) {
            const scope = `${orphan.name} (/${orphan.slug}): ${orphan.accountsCount} реквізит(ів), ${orphan.invoicesCount} рахунк(ів)`;
            console.log(
                orphan.deleted
                    ? `[migration:orphan-businesses] DELETE ${scope}`
                    : `[migration:orphan-businesses] would-delete ${scope}`
            );
        }
        for (const detached of result.detachedOwners) {
            const scope = `${detached.name} (/${detached.slug}): мертвих менеджерів ${detached.deadManagers}`;
            console.log(
                detached.updated
                    ? `[migration:orphan-businesses] NORMALIZE ${scope}`
                    : `[migration:orphan-businesses] would-normalize ${scope}`
            );
        }

        if (!force) {
            console.log(
                `[migration:orphan-businesses] показ завершено: сиріт ${result.orphans.length}, ` +
                    `записів для нормалізації ${result.detachedOwners.length}. ` +
                    'Нічого не змінено. Для реальної чистки: --force'
            );
        } else {
            console.log('[migration:orphan-businesses] applied', {
                deleted: result.orphans.length,
                normalized: result.detachedOwners.length,
            });
        }
    } finally {
        await mongoose.disconnect();
    }
}

if (require.main === module) {
    cli().catch((err) => {
        console.error('[migration:orphan-businesses] failed', err);
        process.exit(1);
    });
}
