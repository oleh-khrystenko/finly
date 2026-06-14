import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { SLUG_ENTITY_TYPES, type SlugEntityType } from '@finly/types';

import { applyJsonTransform } from '../../../common/mongoose/json-transform';

export type SlugReservationDocument = HydratedDocument<SlugReservation>;

/**
 * Sprint 20 — ефемерна бронь бажаного slug за неплатником (модель C upsell-
 * flow). Тримає ім'я від інших на короткий строк, але сам slug у БД не
 * комітиться і публічна сторінка не змінюється: надруковані QR і живі посилання
 * не страждають, після спливу нічого не відкочується.
 *
 * **Одна колекція, не три** (на відміну від `*SlugHistory`). Інваріант «одна
 * активна бронь на користувача» — глобальний (через усі три рівні матрьошки),
 * тож його чисто виражає `unique(userId)` в одному місці; три колекції вимагали
 * б крос-колекційного enforcement-у. Scope унікальності самого імені різний на
 * рівнях, тож кодується у `scopeKey` (`business` глобально, `account:<bizId>`,
 * `invoice:<accId>`) і закривається `unique(scopeKey, slugLower)`.
 *
 * **Сплив миттєвий на read.** Запити доступності/блокування фільтрують
 * `expiresAt > now` — не чекають лінивого Mongo-TTL (cleanup кожні ~60с). TTL-
 * індекс лише прибирає мертві рядки фоном; семантику спливу він не визначає.
 */
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class SlugReservation {
    /**
     * Власник броні. Unique-індекс — одна активна бронь на користувача. Нова
     * бронь звільняє попередню (delete-first у `SlugReservationService.reserve`
     * під per-user Redis-локом).
     */
    @Prop({ required: true, type: Types.ObjectId })
    userId!: Types.ObjectId;

    @Prop({ required: true, type: String, enum: SLUG_ENTITY_TYPES })
    entityType!: SlugEntityType;

    /** Сутність, до якої застосується ім'я після оплати (business/account/invoice _id). */
    @Prop({ required: true, type: Types.ObjectId })
    targetId!: Types.ObjectId;

    /**
     * Snapshot канонічного шляху до цільової сутності на момент броні. Web будує
     * з нього PATCH-URL для застосування наміру і success-повідомлення. Для
     * business-броні заповнений лише `businessSlug`; account додає `accountSlug`;
     * invoice — усі три.
     */
    @Prop({ required: true, type: String })
    businessSlug!: string;

    // Nullable (не `required`): для business-броні обидва null, account-бронь
    // заповнює `accountSlug`, invoice — обидва.
    @Prop({ type: String, default: null })
    accountSlug!: string | null;

    @Prop({ type: String, default: null })
    invoiceSlug!: string | null;

    /**
     * Scope унікальності імені: `business` (глобально), `account:<businessId>`,
     * `invoice:<accountId>`. Префікси не перетинаються між типами, тож один
     * `unique(scopeKey, slugLower)` обслуговує всі три рівні без крос-type
     * колізій.
     */
    @Prop({ required: true, type: String })
    scopeKey!: string;

    /** Бажане ім'я, case-preserved (display). */
    @Prop({ required: true, type: String })
    slug!: string;

    @Prop({ required: true, type: String, lowercase: true, trim: true })
    slugLower!: string;

    /** Момент спливу. TTL-індекс прибирає рядок фоном після цієї дати. */
    @Prop({ required: true, type: Date })
    expiresAt!: Date;

    createdAt!: Date;
}

export const SlugReservationSchema =
    SchemaFactory.createForClass(SlugReservation);

applyJsonTransform(SlugReservationSchema);

// Одна активна бронь на користувача. Race на concurrent self-create закриває
// per-user Redis-лок у сервісі; індекс — структурний backstop.
SlugReservationSchema.index({ userId: 1 }, { unique: true });

// Hold-унікальність імені у межах scope: два користувачі не можуть тримати одне
// ім'я в тому самому scope одночасно (другий insert → 11000 → SLUG_TAKEN).
SlugReservationSchema.index({ scopeKey: 1, slugLower: 1 }, { unique: true });

// TTL — авто-сплив броні (background-thread mongod, ~60с гранулярність). Точну
// семантику «вільне після спливу» дає `expiresAt > now`-фільтр на read.
SlugReservationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
