import {
    BadRequestException,
    ConflictException,
    Injectable,
    InternalServerErrorException,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, isValidObjectId } from 'mongoose';
import {
    RESPONSE_CODE,
    getAuthorById,
    type AdminGuideListItem,
    type PublicGuide,
    type PublicGuideCard,
    type PublicGuideView,
    type PublicGuidesTree,
    type UpsertGuideRequest,
} from '@finly/types';

import { isTransactionsUnsupportedError } from '../../common/mongoose/transactions-unsupported';
import { StorageService } from '../storage/storage.service';
import { GuidesRevalidationService } from './guides-revalidation.service';
import { Guide, GuideDocument } from './schemas/guide.schema';

const RELATED_LIMIT = 3;

/** Date-only ISO у київському часі — конвенція freshness-дат help/guides. */
function kyivToday(): string {
    // en-CA локаль форматує як YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Kyiv',
    }).format(new Date());
}

/** Стаття має хоч один непорожній блок тексту — умова публікації. */
function hasContent(blocks: { text: string }[]): boolean {
    return blocks.some((block) => block.text.trim() !== '');
}

function toCard(doc: GuideDocument): PublicGuideCard {
    return {
        slug: doc.slug,
        title: doc.title,
        description: doc.description,
    };
}

function toPublicGuide(doc: GuideDocument): PublicGuide {
    return {
        slug: doc.slug,
        title: doc.title,
        description: doc.description,
        authorId: doc.authorId,
        pillarSlug: doc.pillarSlug,
        blocks: doc.blocks,
        faq: doc.faq,
        datePublished: doc.datePublished,
        dateModified: doc.dateModified,
    };
}

@Injectable()
export class GuidesService {
    private readonly logger = new Logger(GuidesService.name);

    constructor(
        @InjectModel(Guide.name)
        private readonly guideModel: Model<GuideDocument>,
        @InjectConnection() private readonly connection: Connection,
        private readonly storage: StorageService,
        private readonly revalidation: GuidesRevalidationService
    ) {}

    /**
     * Дерево розділу /guides: published pillar-и з їх published cluster-ами.
     * Published cluster з неопублікованим pillar-ом у дерево не входить
     * (лишається доступним за прямим URL): у списку йому немає дому, а
     * повернення pillar-а повертає і його.
     */
    async getPublicTree(): Promise<PublicGuidesTree> {
        const published = await this.guideModel
            .find({ status: 'published' })
            .sort({ order: 1, createdAt: 1 })
            .exec();

        return published
            .filter((doc) => doc.pillarSlug === null)
            .map((pillar) => ({
                pillar: toCard(pillar),
                clusters: published
                    .filter((doc) => doc.pillarSlug === pillar.slug)
                    .map(toCard),
            }));
    }

    /** Slug-и всіх published статей — джерело для sitemap. */
    async getPublishedSlugs(): Promise<string[]> {
        const docs = await this.guideModel
            .find({ status: 'published' })
            .select('slug')
            .exec();
        return docs.map((doc) => doc.slug);
    }

    /**
     * Публічна сторінка статті: guide + обчислені звʼязки кластера. Pillar
     * для breadcrumb (null, якщо не опублікований — breadcrumb деградує до
     * кореня розділу), related за топікал-структурою: pillar показує свої
     * cluster-и, cluster — pillar і сусідів.
     */
    async getPublicView(slug: string): Promise<PublicGuideView | null> {
        const doc = await this.guideModel
            .findOne({ slug, status: 'published' })
            .exec();
        if (!doc) return null;

        let pillar: GuideDocument | null = null;
        if (doc.pillarSlug) {
            pillar = await this.guideModel
                .findOne({ slug: doc.pillarSlug, status: 'published' })
                .exec();
        }

        const siblingsFilter = doc.pillarSlug
            ? { status: 'published', pillarSlug: doc.pillarSlug }
            : { status: 'published', pillarSlug: doc.slug };
        const siblings = await this.guideModel
            .find(siblingsFilter)
            .sort({ order: 1, createdAt: 1 })
            .exec();

        const related: PublicGuideCard[] = [
            ...(pillar ? [toCard(pillar)] : []),
            ...siblings
                .filter((sibling) => sibling.slug !== doc.slug)
                .map(toCard),
        ].slice(0, RELATED_LIMIT);

        return {
            guide: toPublicGuide(doc),
            pillar: pillar ? toCard(pillar) : null,
            related,
        };
    }

    async adminList(): Promise<AdminGuideListItem[]> {
        const docs = await this.guideModel
            .find()
            .sort({ order: 1, createdAt: 1 })
            .exec();
        return docs.map((doc) => ({
            id: doc._id.toString(),
            slug: doc.slug,
            title: doc.title,
            status: doc.status,
            pillarSlug: doc.pillarSlug,
            order: doc.order,
            datePublished: doc.datePublished,
            dateModified: doc.dateModified,
            organicClicks: doc.organicClicks ?? 0,
            organicSyncedAt: doc.organicSyncedAt ?? null,
            updatedAt: doc.updatedAt,
        }));
    }

    async adminGetById(id: string): Promise<GuideDocument> {
        const doc = isValidObjectId(id)
            ? await this.guideModel.findById(id).exec()
            : null;
        if (!doc) {
            throw new NotFoundException({
                code: RESPONSE_CODE.GUIDE_NOT_FOUND,
                message: 'Guide not found',
            });
        }
        return doc;
    }

    async create(dto: UpsertGuideRequest): Promise<GuideDocument> {
        this.assertAuthorExists(dto.authorId);
        await this.assertPillarRefValid(dto.pillarSlug, dto.slug);

        // `order` не редагується у формі: нова стаття стає в кінець списку.
        // Точний порядок задається дією «підняти/опустити» (див. reorder).
        const order = (await this.maxOrder()) + 1;

        try {
            return await this.guideModel.create({
                ...dto,
                order,
                // Нова стаття народжується запланованою темою (backlog). До
                // чернетки її переводить окрема дія startDraft.
                status: 'planned',
                datePublished: null,
                dateModified: null,
            });
        } catch (err) {
            throw this.mapDuplicateSlug(err);
        }
    }

    /**
     * Присвоює послідовні `order` (1..N) за порядком переданих id. Клієнт шле
     * повний список; невалідні id тихо пропускаються (індекс зберігається, тож
     * відносний порядок решти не зсувається). Перегенеровуємо публічні
     * сторінки: порядок впливає на дерево /guides і блок «читайте також».
     */
    async reorder(ids: string[]): Promise<void> {
        const ops = ids
            .map((id, index) => ({ id, index }))
            .filter(({ id }) => isValidObjectId(id))
            .map(({ id, index }) => ({
                updateOne: {
                    filter: { _id: id },
                    update: { $set: { order: index + 1 } },
                },
            }));

        if (ops.length > 0) {
            await this.guideModel.bulkWrite(ops);
        }
        await this.revalidation.revalidate();
    }

    private async maxOrder(): Promise<number> {
        const last = await this.guideModel
            .findOne()
            .sort({ order: -1 })
            .select('order')
            .lean()
            .exec();
        return last?.order ?? 0;
    }

    async update(id: string, dto: UpsertGuideRequest): Promise<GuideDocument> {
        const doc = await this.adminGetById(id);

        this.assertAuthorExists(dto.authorId);

        // Опублікована стаття не може стати порожньою: її сторінка вже в
        // індексі. Для planned/draft порожній контент дозволений.
        if (doc.status === 'published' && !hasContent(dto.blocks)) {
            throw new BadRequestException({
                code: RESPONSE_CODE.GUIDE_CONTENT_REQUIRED,
                message: 'Published guide must keep at least one block',
            });
        }

        if (doc.datePublished !== null && dto.slug !== doc.slug) {
            throw new ConflictException({
                code: RESPONSE_CODE.GUIDE_SLUG_LOCKED,
                message: 'Slug is locked after first publish',
            });
        }

        await this.assertPillarRefValid(dto.pillarSlug, dto.slug, doc.slug);

        // Pillar → cluster перетворення заборонене, поки на статтю посилаються
        // cluster-и: вони втратили б дім (глибша вкладеність не підтримується).
        if (dto.pillarSlug !== null) {
            await this.assertHasNoClusters(doc.slug);
        }

        const previousSlug = doc.slug;
        const slugChanged = dto.slug !== previousSlug;
        doc.set({ ...dto });
        // PATCH опублікованої статті міняє live-контент одразу (draft-версій
        // немає, не-скоуп), тож це і є «публікація змін» — бампаємо чесну дату.
        if (doc.status === 'published') {
            doc.dateModified = kyivToday();
        }

        if (!slugChanged) {
            try {
                await doc.save();
            } catch (err) {
                throw this.mapDuplicateSlug(err);
            }
        } else {
            // Rename slug чернетки-pillar-а каскадно оновлює pillarSlug її
            // cluster-ів — atomic-or-nothing, як усі каскади проєкту
            // (replica-set вже інфра-вимога).
            const session = await this.connection.startSession();
            try {
                await session.withTransaction(async () => {
                    await doc.save({ session });
                    await this.guideModel.updateMany(
                        { pillarSlug: previousSlug },
                        { $set: { pillarSlug: dto.slug } },
                        { session }
                    );
                });
            } catch (err) {
                // Standalone mongod не підтримує транзакції — уніфікований код
                // TRANSACTION_REQUIRES_REPLICA_SET, як в усіх каскад-сайтах
                // проєкту (businesses/accounts), замість голої 500.
                if (isTransactionsUnsupportedError(err)) {
                    this.logger.error(
                        `Guide slug rename failed: replica-set required. slug=${previousSlug}→${dto.slug}. Original: ${
                            err instanceof Error ? err.message : String(err)
                        }`
                    );
                    throw new InternalServerErrorException({
                        code: RESPONSE_CODE.TRANSACTION_REQUIRES_REPLICA_SET,
                        message:
                            'Guide slug rename requires Mongo replica-set; check MONGODB_URI',
                    });
                }
                throw this.mapDuplicateSlug(err);
            } finally {
                await session.endSession();
            }
        }

        // Редагування опублікованої статті одразу міняє публічний контент.
        if (doc.status === 'published') {
            await this.revalidation.revalidate();
        }
        return doc;
    }

    /**
     * Запланована тема → чернетка («почали писати»). Контент не вимагається:
     * чернетка може бути ще порожньою. Не публічна, тож без revalidate.
     */
    async startDraft(id: string): Promise<GuideDocument> {
        const doc = await this.adminGetById(id);
        if (doc.status === 'published') {
            throw new ConflictException({
                code: RESPONSE_CODE.GUIDE_UNPUBLISH_FIRST,
                message: 'Unpublish the guide before moving it back to draft',
            });
        }
        doc.status = 'draft';
        await doc.save();
        return doc;
    }

    async publish(id: string): Promise<GuideDocument> {
        const doc = await this.adminGetById(id);
        // Публічна сторінка не може бути порожня.
        if (!hasContent(doc.blocks)) {
            throw new BadRequestException({
                code: RESPONSE_CODE.GUIDE_CONTENT_REQUIRED,
                message: 'Add at least one block before publishing',
            });
        }
        const today = kyivToday();
        doc.status = 'published';
        doc.datePublished = doc.datePublished ?? today;
        doc.dateModified = today;
        await doc.save();
        await this.revalidation.revalidate();
        return doc;
    }

    async unpublish(id: string): Promise<GuideDocument> {
        const doc = await this.adminGetById(id);
        // Дати не чіпаємо: datePublished — історичний факт першої публікації
        // (він же тримає slug-lock), dateModified — останньої зміни контенту.
        doc.status = 'draft';
        await doc.save();
        await this.revalidation.revalidate();
        return doc;
    }

    async delete(id: string): Promise<void> {
        const doc = await this.adminGetById(id);
        if (doc.status === 'published') {
            throw new ConflictException({
                code: RESPONSE_CODE.GUIDE_PUBLISHED_DELETE_FORBIDDEN,
                message: 'Unpublish the guide before deleting it',
            });
        }
        await this.assertHasNoClusters(doc.slug);

        await doc.deleteOne();

        // Best-effort прибирання ілюстрацій: осиротілий файл — менша проблема,
        // ніж відкат уже видаленої статті (safeDelete не кидає).
        for (const block of doc.blocks) {
            if (block.image) {
                await this.storage.safeDeleteByUrl(block.image.src);
            }
        }
    }

    /** Автори compile-time — посилання мусить резолвитись у HELP_AUTHORS. */
    private assertAuthorExists(authorId: string): void {
        if (!getAuthorById(authorId)) {
            throw new BadRequestException({
                code: RESPONSE_CODE.VALIDATION_ERROR,
                message: `Unknown author "${authorId}"`,
            });
        }
    }

    /**
     * `pillarSlug` вказує на наявний pillar: не на себе, не на cluster
     * (дворівнева структура). `previousSlug` дозволяє self-rename чернетки.
     */
    private async assertPillarRefValid(
        pillarSlug: string | null,
        selfSlug: string,
        previousSlug?: string
    ): Promise<void> {
        if (pillarSlug === null) return;
        if (pillarSlug === selfSlug || pillarSlug === previousSlug) {
            throw new BadRequestException({
                code: RESPONSE_CODE.GUIDE_PILLAR_INVALID,
                message: 'Guide cannot be its own pillar',
            });
        }
        const pillar = await this.guideModel
            .findOne({ slug: pillarSlug })
            .exec();
        if (!pillar || pillar.pillarSlug !== null) {
            throw new BadRequestException({
                code: RESPONSE_CODE.GUIDE_PILLAR_INVALID,
                message: 'Referenced pillar does not exist or is a cluster',
            });
        }
    }

    private async assertHasNoClusters(slug: string): Promise<void> {
        const clustersCount = await this.guideModel
            .countDocuments({ pillarSlug: slug })
            .exec();
        if (clustersCount > 0) {
            throw new ConflictException({
                code: RESPONSE_CODE.GUIDE_HAS_CLUSTERS,
                message: 'Detach or delete cluster guides first',
            });
        }
    }

    private mapDuplicateSlug(err: unknown): unknown {
        if (
            typeof err === 'object' &&
            err !== null &&
            'code' in err &&
            (err as { code: unknown }).code === 11000
        ) {
            return new ConflictException({
                code: RESPONSE_CODE.SLUG_TAKEN,
                message: 'Guide slug is already taken',
            });
        }
        return err;
    }
}
