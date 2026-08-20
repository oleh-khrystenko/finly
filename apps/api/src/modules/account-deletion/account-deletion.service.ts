import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import {
    SUBSCRIPTION_STATUS,
    type AccountDeletionConfirmMethod,
    type AccountDeletionPayee,
    type AccountDeletionPreview,
} from '@finly/types';

import { BusinessesService } from '../businesses/businesses.service';
import { ReconciliationService } from '../businesses/reconciliation.service';
import {
    Business,
    BusinessDocument,
} from '../businesses/schemas/business.schema';
import { PayersService } from '../payers/payers.service';
import {
    BillingProfile,
    BillingProfileDocument,
} from '../payments/schemas/billing-profile.schema';
import {
    CreditLedgerEntry,
    CreditLedgerEntryDocument,
} from '../payments/schemas/credit-ledger-entry.schema';
import {
    PaymentRecord,
    PaymentRecordDocument,
} from '../payments/schemas/payment-record.schema';
import {
    ProcessedWebhookEvent,
    ProcessedWebhookEventDocument,
} from '../payments/schemas/processed-webhook-event.schema';
import { SlugReservationService } from '../slug-reservation/slug-reservation.service';
import { StorageService } from '../storage/storage.service';
import { User, UserDocument } from '../users/schemas/user.schema';

/** Отримувач у переліку разом з групою, до якої він належить. */
interface DepartingPayeeRow extends AccountDeletionPayee {
    scope: 'owned' | 'managed';
}

/**
 * «За записом не лишається нікого, крім цієї людини»: у `managers` немає жодного
 * елемента, відмінного від неї (порожній масив теж підходить).
 */
function noOtherManagers(userId: Types.ObjectId): FilterQuery<Business> {
    return { managers: { $not: { $elemMatch: { $ne: userId } } } };
}

/**
 * Отримувачі, які підуть на видалення разом з людиною: вона або власник, або
 * єдиний менеджер нічийного (клієнтського) запису — і більше за записом не
 * стоїть ніхто.
 *
 * Системні отримувачі каталогу виключені явно, тим самим фільтром, що у
 * кабінетних вибірках: вони нічиї за задумом і структурно сюди не потрапляють,
 * але межа тримається явно на випадок, якщо системному запису колись додадуть
 * менеджера.
 */
export function departingBusinessesFilter(
    userId: Types.ObjectId
): FilterQuery<Business> {
    return {
        isSystem: { $ne: true },
        $and: [
            noOtherManagers(userId),
            {
                $or: [{ ownerId: userId }, { ownerId: null, managers: userId }],
            },
        ],
    };
}

/**
 * Отримувачі, які видалення переживають: людина до них причетна, але за записом
 * стоїть ще хтось. Такий запис не видаляється і не гасне — з нього зникає лише
 * згадка про людину, що пішла.
 */
export function survivingBusinessesFilter(
    userId: Types.ObjectId
): FilterQuery<Business> {
    return {
        isSystem: { $ne: true },
        $or: [{ ownerId: userId }, { managers: userId }],
        $nor: [departingBusinessesFilter(userId)],
    };
}

/**
 * Файли бренду отримувача в обох слотах: сам логотип і дві пре-композовані
 * марки. `pending` бере участь нарівні з `active` — слот навмисно переживає і
 * checkout, і згасання тарифу, тож на момент видалення там цілком може лежати
 * файл, за яким більше ніхто не прийде.
 */
function brandFileUrls(brand: BusinessDocument['brand']): string[] {
    return [brand?.active, brand?.pending].flatMap((slot) =>
        slot ? [slot.logoUrl, slot.centerMarkUrl, slot.bandMarkUrl] : []
    );
}

/**
 * Sprint 32 — доля отримувачів при видаленні акаунта.
 *
 * Три відповідальності, розведені у часі:
 *  - **перелік** того, що зникне (запобіжник перед підтвердженням);
 *  - **ефекти підтвердження** — гасіння публічності отримувачів і пауза
 *    списань; обидва оборотні, обидва знімаються відновленням акаунта;
 *  - **остаточне прибирання** наприкінці вікна відновлення.
 *
 * Модуль живе поза `UsersModule` за тією ж причиною, що `OrphanCleanupModule`:
 * прибирання тягне і користувача, і бізнеси, а зворотне ребро `Users →
 * Businesses` зламало б one-way DAG `Users ← Businesses ← Accounts ← Invoices`.
 */
@Injectable()
export class AccountDeletionService {
    private readonly logger = new Logger(AccountDeletionService.name);

    constructor(
        @InjectModel(User.name)
        private readonly userModel: Model<UserDocument>,
        @InjectModel(Business.name)
        private readonly businessModel: Model<BusinessDocument>,
        @InjectModel(BillingProfile.name)
        private readonly profileModel: Model<BillingProfileDocument>,
        @InjectModel(PaymentRecord.name)
        private readonly paymentRecordModel: Model<PaymentRecordDocument>,
        @InjectModel(CreditLedgerEntry.name)
        private readonly creditLedgerModel: Model<CreditLedgerEntryDocument>,
        @InjectModel(ProcessedWebhookEvent.name)
        private readonly webhookEventModel: Model<ProcessedWebhookEventDocument>,
        private readonly businessesService: BusinessesService,
        private readonly reconciliation: ReconciliationService,
        private readonly payersService: PayersService,
        private readonly slugReservations: SlugReservationService,
        private readonly storage: StorageService
    ) {}

    /**
     * Перелік того, що зникне разом з акаунтом, у двох групах. Клієнтські записи
     * бухгалтера відділені від власних: людина мусить бачити, що зносить не
     * тільки своє.
     */
    async getPreview(
        userId: string,
        confirmMethod: AccountDeletionConfirmMethod
    ): Promise<AccountDeletionPreview> {
        const userObjectId = new Types.ObjectId(userId);
        const rows = await this.businessModel
            .aggregate<DepartingPayeeRow>([
                { $match: departingBusinessesFilter(userObjectId) },
                {
                    $lookup: {
                        from: 'accounts',
                        let: { bid: '$_id' },
                        pipeline: [
                            {
                                $match: {
                                    $expr: { $eq: ['$businessId', '$$bid'] },
                                },
                            },
                            { $count: 'count' },
                        ],
                        as: '__accountsCount',
                    },
                },
                {
                    $lookup: {
                        from: 'invoices',
                        let: { bid: '$_id' },
                        pipeline: [
                            {
                                $match: {
                                    $expr: { $eq: ['$businessId', '$$bid'] },
                                },
                            },
                            { $count: 'count' },
                        ],
                        as: '__invoicesCount',
                    },
                },
                {
                    $project: {
                        _id: 0,
                        name: 1,
                        accountsCount: {
                            $ifNull: [
                                { $arrayElemAt: ['$__accountsCount.count', 0] },
                                0,
                            ],
                        },
                        invoicesCount: {
                            $ifNull: [
                                { $arrayElemAt: ['$__invoicesCount.count', 0] },
                                0,
                            ],
                        },
                        scope: {
                            $cond: [
                                { $eq: ['$ownerId', userObjectId] },
                                'owned',
                                'managed',
                            ],
                        },
                    },
                },
                { $sort: { name: 1 } },
            ])
            .exec();

        const toPayee = (row: DepartingPayeeRow): AccountDeletionPayee => ({
            name: row.name,
            accountsCount: row.accountsCount,
            invoicesCount: row.invoicesCount,
        });

        const owned = rows.filter((r) => r.scope === 'owned').map(toPayee);
        const managed = rows.filter((r) => r.scope === 'managed').map(toPayee);

        return {
            confirmMethod,
            owned,
            managed,
            totals: {
                businessesCount: rows.length,
                accountsCount: rows.reduce(
                    (sum, r) => sum + r.accountsCount,
                    0
                ),
                invoicesCount: rows.reduce(
                    (sum, r) => sum + r.invoicesCount,
                    0
                ),
            },
        };
    }

    /**
     * Ефекти підтвердження видалення: публічні сторінки і QR гаснуть одразу,
     * списання зупиняються. Дані при цьому лишаються на місці до кінця вікна
     * відновлення — обіцянка «передумав, повертається все» тримається.
     *
     * Ідемпотентна: фільтри пропускають уже застосоване, тож повторний виклик
     * (крах між soft-delete і цим кроком, добивання кроном) нічого не псує і не
     * зсуває вже проставлені дати.
     *
     * **Звірка з деактивацією стоїть ПІСЛЯ запису, а не перед ним.** Крон-прохід
     * (`CleanupService.resyncDeactivationEffects`) читає список деактивованих
     * заздалегідь, тож між читанням і цим викликом людина може встигнути
     * відновити акаунт: тоді її `revertDeactivationEffects` відпрацював би
     * ПЕРШИМ, а ми поставили б позначки назад — і зняти їх було б уже нікому
     * (людина активна, крон її більше не бачить). Перевірка перед записом
     * вікна не закриває, лише звужує; перевірка після записує дає компенсацію,
     * яка спрацьовує у будь-якому порядку подій.
     */
    async applyDeactivationEffects(userId: string): Promise<void> {
        const userObjectId = new Types.ObjectId(userId);
        const now = new Date();

        await this.businessModel.updateMany(
            {
                ...departingBusinessesFilter(userObjectId),
                publicitySuspendedAt: null,
            },
            { $set: { publicitySuspendedAt: now } }
        );

        await this.profileModel.updateOne(
            { userId: userObjectId, billingPausedAt: null },
            { $set: { billingPausedAt: now } }
        );

        const stillDeactivated = await this.userModel
            .exists({ _id: userObjectId, deletedAt: { $ne: null } })
            .exec();
        if (!stillDeactivated) {
            this.logger.warn(
                `Account ${userId} was restored while deactivation effects were ` +
                    'being applied — rolling them back'
            );
            await this.revertDeactivationEffects(userId);
        }
    }

    /**
     * Те саме, але збій не валить виклик. Гасіння публічності — крок, крах на
     * якому за задумом добиває фонове прибирання
     * (`CleanupService.resyncDeactivationEffects`), тож він не має права ні
     * обривати підтвердження видалення на півдорозі (акаунт уже деактивовано, а
     * сесії, лист і cookie ще попереду), ні показувати людині помилку про
     * невдале видалення, якого насправді не було.
     */
    async applyDeactivationEffectsBestEffort(userId: string): Promise<void> {
        try {
            await this.applyDeactivationEffects(userId);
        } catch (error) {
            this.logger.error(
                `Failed to apply deactivation effects for ${userId}: ` +
                    `${(error as Error).message}. Deferred to background resync`
            );
        }
    }

    /**
     * Відновлення акаунта: публічність повертається, планувальник підхоплює
     * платника звичайним ходом з тією самою карткою і тим самим оплаченим
     * періодом. Якщо межа циклу минула під паузою, перший прохід після зняття
     * просто продовжить цикл — це штатне самолікування пропущеного запуску.
     *
     * Крах посеред цього кроку компенсує не повторне натискання (акаунт уже
     * активний, і `restoreAccount` відповідає «Account is not deleted»), а
     * фонове прибирання: `CleanupService.resyncRestoredAccounts` шукає позначки,
     * що пережили відновлення, і знімає їх. Симетрично до
     * `resyncDeactivationEffects` на протилежному напрямку.
     */
    async revertDeactivationEffects(userId: string): Promise<void> {
        const userObjectId = new Types.ObjectId(userId);

        await this.businessModel.updateMany(
            {
                $or: [{ ownerId: userObjectId }, { managers: userObjectId }],
                publicitySuspendedAt: { $ne: null },
            },
            { $set: { publicitySuspendedAt: null } }
        );

        await this.profileModel.updateOne(
            { userId: userObjectId, billingPausedAt: { $ne: null } },
            { $set: { billingPausedAt: null } }
        );
    }

    /**
     * Людина, у якої позначки пережили відновлення акаунта: сторінки далі
     * віддають 404, списання далі стоять на паузі, хоча акаунт активний.
     * Штатно такого стану не буває — його лишає лише крах посеред
     * `revertDeactivationEffects` (або крон, що вклинився між зняттям
     * деактивації і зняттям позначок).
     *
     * Сам по собі стан не самолікується: `resyncDeactivationEffects` ходить
     * лише по деактивованих, а повторне відновлення відбивається як «акаунт не
     * видалено». Без цього проходу людина лишалась би з мертвими платіжними
     * посиланнями і безкоштовним сервісом назавжди, і жодна сторона про це не
     * дізналась би.
     *
     * Записи без живого користувача (людину вже прибрано остаточно) сюди не
     * потрапляють: їх забирає `purgeUser`, а не зняття позначок.
     */
    async findUsersWithStaleDeactivationEffects(): Promise<string[]> {
        // Предикат `$type: 'date'`, а не `$ne: null`: обидва вибирають одне й те
        // саме (у поля лише два стани — дата або `null`), але partial-індекси під
        // цей прохід збудовані саме на `$type`, і Mongo бере індекс лише коли
        // умова запиту є підмножиною умови індексу. З `$ne: null` покажчик
        // ігнорувався б і кожен прохід читав би обидві колекції цілком.
        const [owners, managers, payers] = await Promise.all([
            this.businessModel.distinct('ownerId', {
                publicitySuspendedAt: { $type: 'date' },
            }),
            this.businessModel.distinct('managers', {
                publicitySuspendedAt: { $type: 'date' },
            }),
            this.profileModel.distinct('userId', {
                billingPausedAt: { $type: 'date' },
            }),
        ]);

        const candidates = [...owners, ...managers, ...payers].filter(
            (id): id is Types.ObjectId => id instanceof Types.ObjectId
        );
        if (candidates.length === 0) return [];

        const active = await this.userModel
            .find({ _id: { $in: candidates }, deletedAt: null }, { _id: 1 })
            .lean<Array<{ _id: Types.ObjectId }>>()
            .exec();

        return active.map((user) => user._id.toString());
    }

    /**
     * Остаточне прибирання отримувачів людини. Записи, за якими вона стояла
     * сама, ідуть каскадом з усім піддеревом; записи, за якими лишається ще
     * хтось, переживають видалення — з них зникає лише згадка про людину.
     *
     * Повертає id тих, що вижили: реконсиляція мусить зняти з них платні
     * можливості, поки платіжний профіль ще на місці.
     */
    private async purgeBusinesses(
        userObjectId: Types.ObjectId
    ): Promise<Types.ObjectId[]> {
        const departing = await this.businessModel
            .find(departingBusinessesFilter(userObjectId))
            .sort({ createdAt: 1 })
            .exec();

        for (const business of departing) {
            // Посилання на файли бренду читаються ДО каскаду: після нього запис
            // зникає разом з ними, і знайти ці об'єкти у сховищі не зможе вже
            // ніхто. Самі файли видаляються ПІСЛЯ каскаду — зворотний порядок
            // на краху лишив би живий запис з битими картинками.
            const brandUrls = brandFileUrls(business.brand);
            await this.businessesService.delete(business);
            await this.deleteStorageFiles(brandUrls);
        }

        const surviving = await this.businessModel
            .find(survivingBusinessesFilter(userObjectId), {
                _id: 1,
                ownerId: 1,
            })
            .lean<
                Array<{ _id: Types.ObjectId; ownerId: Types.ObjectId | null }>
            >()
            .exec();

        // Власника обнуляємо лише коли він саме ця людина; менеджера прибираємо
        // завжди — обидві дії разом дають «вихід із запису» і тримають інваріант
        // `ownerId === null ⇒ managers.length ≥ 1` (запис вижив тільки тому, що
        // за ним стоїть ще хтось).
        const ownedByUser = surviving.filter(
            (b) => b.ownerId !== null && b.ownerId.equals(userObjectId)
        );
        if (ownedByUser.length > 0) {
            await this.businessModel.updateMany(
                { _id: { $in: ownedByUser.map((b) => b._id) } },
                { $set: { ownerId: null } }
            );
        }
        if (surviving.length > 0) {
            await this.businessModel.updateMany(
                { _id: { $in: surviving.map((b) => b._id) } },
                { $pull: { managers: userObjectId } }
            );
        }

        return surviving.map((b) => b._id);
    }

    /**
     * Прибирання файлів у сховищі. Best-effort і всередині (`safeDeleteByUrl`
     * лише пише в лог), і зовні: недоступний R2 не має права зупинити
     * прибирання акаунта — інакше один збій сховища заморозив би видалення
     * даних людини назавжди. Зовнішні адреси (Google-аватар) метод відсіює сам.
     */
    private async deleteStorageFiles(urls: string[]): Promise<void> {
        for (const url of urls) {
            try {
                await this.storage.safeDeleteByUrl(url);
            } catch (error) {
                this.logger.warn(
                    `Failed to delete storage object ${url}: ` +
                        `${(error as Error).message}`
                );
            }
        }
    }

    /**
     * Фото профілю людини. Йде останнім кроком, безпосередньо перед видаленням
     * її запису: адреса файлу живе лише у самому записі, тож ширше вікно між
     * цими двома діями означало б осиротілий об'єкт у сховищі, знайти який уже
     * нічим. Файл публічний за прямою адресою — лишити його означало б лишити
     * фото людини у мережі після того, як вона пішла.
     */
    private async purgeAvatar(userObjectId: Types.ObjectId): Promise<void> {
        const user = await this.userModel
            .findById(userObjectId, { 'profile.avatar': 1 })
            .lean<{ profile?: { avatar?: string | null } } | null>()
            .exec();
        const avatar = user?.profile?.avatar;
        if (avatar) await this.deleteStorageFiles([avatar]);
    }

    /**
     * Гасить білінг-профіль платника, що видаляється: зупиняє планувальник
     * (`nextChargeAt`/`nextRetryAt` → null), зачищає токен і ставить CANCELED.
     * Стемп `reconcileRequiredAt` — durable-тригер: daily-sweep payments-модуля
     * реконсилює прикріплені бізнеси (бренд-фічі гаснуть) навіть якщо цей прохід
     * упаде одразу після update. Idempotent через фільтр статусу.
     */
    private async retireBillingProfile(
        userObjectId: Types.ObjectId
    ): Promise<void> {
        await this.profileModel.updateOne(
            {
                userId: userObjectId,
                status: { $ne: SUBSCRIPTION_STATUS.CANCELED },
            },
            {
                $set: {
                    status: SUBSCRIPTION_STATUS.CANCELED,
                    nextChargeAt: null,
                    nextRetryAt: null,
                    cardToken: null,
                },
                // $max — маркер реконсиляції монотонний: cron без user-лока не
                // сміє перекрити новіший конкурентний стемп старішою датою,
                // інакше clear того тригера ($lte його стемпа) стер би durable-
                // слід (див. PaymentsCleanupService.expireCanceledProfiles).
                $max: { reconcileRequiredAt: new Date() },
            }
        );
    }

    /**
     * Знімає платні можливості з отримувачів, що переживають видалення, поки
     * профіль ще існує. Повертає `false`, якщо прохід неповний — тоді профіль
     * знищувати НЕ можна: запис платника це єдине джерело, за яким система
     * знаходить, з кого знімати штамп «оплачено». Знищений разом з маркером, він
     * лишив би чужий отримувач з безкоштовно живим брендом назавжди і без
     * жодного сліду, за яким це можна помітити.
     */
    private async reconcileBeforeProfileRemoval(
        userObjectId: Types.ObjectId,
        survivingBusinessIds: Types.ObjectId[]
    ): Promise<boolean> {
        const profile = await this.profileModel
            .findOne({ userId: userObjectId })
            .lean()
            .exec();

        const ids = new Set(survivingBusinessIds.map((id) => id.toString()));
        if (profile) {
            for (const id of [
                ...profile.brand.attachedBusinessIds,
                ...profile.documents.attachedBusinessIds,
                ...(profile.pendingReconcileBusinessIds ?? []),
            ]) {
                ids.add(id.toString());
            }
        }

        if (ids.size === 0) return true;
        return this.reconciliation.reconcileBusinesses([...ids]);
    }

    /**
     * Платіжні хвости людини: профіль, історія списань, книга кредитів і журнал
     * платіжних подій. Фінансовий слід свідомо не зберігається — платника більше
     * не існує, звіряти нема з ким.
     */
    private async purgeBillingTails(
        userObjectId: Types.ObjectId
    ): Promise<void> {
        await this.profileModel.deleteOne({ userId: userObjectId }).exec();
        await this.paymentRecordModel
            .deleteMany({ userId: userObjectId })
            .exec();
        await this.creditLedgerModel
            .deleteMany({ userId: userObjectId })
            .exec();
        // `ProcessedWebhookEvent.userId` — рядок, а не ObjectId: маршрутизація
        // вебхука кодується в `orderReference`, звідки id приходить текстом.
        await this.webhookEventModel
            .deleteMany({ userId: userObjectId.toString() })
            .exec();
    }

    /**
     * Остаточне прибирання акаунта наприкінці вікна відновлення.
     *
     * **Порядок обережний і людина видаляється останньою.** Спершу гасне білінг
     * (щоб на неіснуючого платника не прийшла нова платіжна подія), потім
     * отримувачі, потім реконсиляція, потім решта хвостів — і лише в кінці сам
     * запис людини. Якщо прохід упаде посередині, наступний знайде людину на
     * місці і доробить залишок; зворотний порядок лишив би сироти без жодної
     * згадки, за якою їх шукати.
     *
     * Повертає `false`, якщо реконсиляція не завершилась: людина і погашений
     * профіль лишаються до наступного проходу, який доробить і видалить.
     * Недороблена реконсиляція ніколи не є приводом знищити профіль.
     *
     * **Файли у сховищі йдуть разом із записами, які на них вказують.**
     * Логотипи отримувачів — у момент каскаду по кожному запису, фото профілю —
     * останнім кроком. Адреси цих об'єктів ніде більше не зберігаються, тож
     * пропущений файл лишився б у публічному сховищі назавжди і без жодного
     * сліду, за яким його можна знайти.
     */
    async purgeUser(userId: string): Promise<boolean> {
        const userObjectId = new Types.ObjectId(userId);

        await this.retireBillingProfile(userObjectId);
        const survivingBusinessIds = await this.purgeBusinesses(userObjectId);

        const reconciled = await this.reconcileBeforeProfileRemoval(
            userObjectId,
            survivingBusinessIds
        );
        if (!reconciled) {
            this.logger.warn(
                `Reconcile incomplete for user ${userId} — billing profile kept ` +
                    'retired, purge deferred to next pass'
            );
            return false;
        }

        await this.purgeBillingTails(userObjectId);
        await this.slugReservations.consumeForUser(userObjectId);
        // Список платників містить персональні дані третіх осіб і мусить зникнути
        // разом з акаунтом. Порядок «до видалення користувача» crash-safe
        // навпаки не був би: без документа користувача не лишилось би нічого, що
        // вказує на осиротілі записи.
        await this.payersService.deleteAllForUser(userObjectId);
        await this.purgeAvatar(userObjectId);
        return true;
    }
}
