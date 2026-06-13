import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
    RESPONSE_CODE,
    SLUG_RESERVATION_TTL_MINUTES,
    type SlugEntityType,
    type SlugReservationView,
} from '@finly/types';

import {
    RedisLockBusyError,
    RedisLockService,
} from '../../common/services/redis-lock.service';
import {
    SlugReservation,
    SlugReservationDocument,
} from './schemas/slug-reservation.schema';

const RESERVE_LOCK_PREFIX = 'slug_reservation:';
const RESERVE_LOCK_TTL_MS = 5_000;
// Конкурентний self-reserve (та сама сутність у двох вкладках) контендить на
// per-user лок. Критична секція коротка (3 DB-оп), тож короткий bounded-retry
// дочікується попередньої броні замість 500 на unhandled RedisLockBusyError
// (симетрично до create-флоу у BusinessesService).
const RESERVE_LOCK_MAX_ATTEMPTS = 5;
const RESERVE_LOCK_RETRY_DELAY_MS = 150;
const TTL_MS = SLUG_RESERVATION_TTL_MINUTES * 60 * 1000;

export interface ReserveSlugParams {
    userId: Types.ObjectId;
    entityType: SlugEntityType;
    targetId: Types.ObjectId;
    scopeKey: string;
    slug: string;
    businessSlug: string;
    accountSlug: string | null;
    invoiceSlug: string | null;
}

/**
 * Sprint 20 — операції над колекцією броней slug (модель C upsell-flow).
 * Sp-specific live/history-перевірки лишаються у доменних сервісах
 * (Businesses/Accounts/Invoices); тут — спільна механіка холду: блокування
 * чужими, створення з delete-first, споживання, читання активної.
 *
 * **Сплив на read.** Усі read-и фільтрують `expiresAt > now` — мертві (але ще
 * не зібрані TTL-ом) рядки не блокують і не повертаються.
 */
@Injectable()
export class SlugReservationService {
    constructor(
        @InjectModel(SlugReservation.name)
        private readonly model: Model<SlugReservationDocument>,
        private readonly locks: RedisLockService
    ) {}

    /** Scope унікальності для бізнес-броні — глобальний. */
    static businessScopeKey(): string {
        return 'business';
    }

    static accountScopeKey(businessId: Types.ObjectId): string {
        return `account:${businessId.toString()}`;
    }

    static invoiceScopeKey(accountId: Types.ObjectId): string {
        return `invoice:${accountId.toString()}`;
    }

    /**
     * Чи тримає ім'я активна бронь ІНШОГО користувача у цьому scope. Власна
     * бронь не блокує (її споживає rename). Викликається з availability-check і
     * з rename-resolve доменних сервісів — нарівні із зайнятим живим slug.
     */
    async isNameHeldByOther(
        scopeKey: string,
        slugLower: string,
        userId: Types.ObjectId
    ): Promise<boolean> {
        const held = await this.model.exists({
            scopeKey,
            slugLower,
            userId: { $ne: userId },
            expiresAt: { $gt: new Date() },
        });
        return held !== null;
    }

    /**
     * Кладе ім'я на холд за користувачем. Під per-user Redis-локом, щоб
     * concurrent self-Save не створив дві броні:
     *  1. delete-first попередньої броні користувача (інваріант «одна на
     *     користувача»; нова звільняє стару, навіть на інше ім'я);
     *  2. прибирання мертвого (expired, ще не зібраного TTL) хвоста на цьому
     *     імені — інакше lazy-TTL-рядок давав би хибний 11000 для нового
     *     легітимного холду;
     *  3. insert.
     *
     * 11000 на `(scopeKey, slugLower)` → ім'я щойно зайняли активною бронню
     * іншого → `SLUG_TAKEN` (нарівні із зайнятим живим slug).
     */
    async reserve(params: ReserveSlugParams): Promise<SlugReservationDocument> {
        const lockKey = `${RESERVE_LOCK_PREFIX}${params.userId.toString()}`;
        for (let attempt = 1; attempt <= RESERVE_LOCK_MAX_ATTEMPTS; attempt++) {
            try {
                return await this.locks.withLock(
                    lockKey,
                    RESERVE_LOCK_TTL_MS,
                    () => this.reserveLocked(params)
                );
            } catch (err) {
                if (!(err instanceof RedisLockBusyError)) {
                    throw err;
                }
                if (attempt < RESERVE_LOCK_MAX_ATTEMPTS) {
                    await delay(RESERVE_LOCK_RETRY_DELAY_MS);
                }
            }
        }
        throw new ConflictException({
            code: RESPONSE_CODE.SLUG_RESERVATION_IN_PROGRESS,
            message: 'Slug reservation already in progress',
        });
    }

    private async reserveLocked(
        params: ReserveSlugParams
    ): Promise<SlugReservationDocument> {
        const now = new Date();
        await this.model.deleteMany({ userId: params.userId }).exec();
        await this.model
            .deleteMany({
                scopeKey: params.scopeKey,
                slugLower: params.slug.toLowerCase(),
                expiresAt: { $lte: now },
            })
            .exec();
        try {
            return await this.model.create({
                userId: params.userId,
                entityType: params.entityType,
                targetId: params.targetId,
                businessSlug: params.businessSlug,
                accountSlug: params.accountSlug,
                invoiceSlug: params.invoiceSlug,
                scopeKey: params.scopeKey,
                slug: params.slug,
                slugLower: params.slug.toLowerCase(),
                expiresAt: new Date(now.getTime() + TTL_MS),
            });
        } catch (err) {
            if (isDuplicateKeyError(err)) {
                throw new ConflictException({
                    code: RESPONSE_CODE.SLUG_TAKEN,
                    message: 'Slug is currently reserved by another user',
                });
            }
            throw err;
        }
    }

    /**
     * Споживає (видаляє) активну бронь користувача. Викликається у rename-TX
     * доменного сервісу після успішного запису slug — атомарно зі зняттям
     * холду. Idempotent (deleteMany на відсутньому — no-op).
     */
    async consumeForUser(
        userId: Types.ObjectId,
        session?: ClientSession
    ): Promise<void> {
        await this.model.deleteMany({ userId }, { session }).exec();
    }

    /** Активна бронь користувача для `GET /users/me` (відлік + добивання наміру). */
    async getActiveForUser(
        userId: Types.ObjectId
    ): Promise<SlugReservationDocument | null> {
        return this.model
            .findOne({ userId, expiresAt: { $gt: new Date() } })
            .exec();
    }
}

export function toSlugReservationView(
    doc: SlugReservationDocument
): SlugReservationView {
    return {
        entityType: doc.entityType,
        desiredSlug: doc.slug,
        expiresAt: doc.expiresAt,
        businessSlug: doc.businessSlug,
        accountSlug: doc.accountSlug,
        invoiceSlug: doc.invoiceSlug,
    };
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isDuplicateKeyError(err: unknown): boolean {
    return (
        err instanceof Error &&
        'code' in err &&
        (err as { code: unknown }).code === 11000
    );
}
