import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import { applyJsonTransform } from '../../../common/mongoose/json-transform';

export type AccountSlugHistoryDocument = HydratedDocument<AccountSlugHistory>;

/**
 * Sprint 15 — vanity-slug edit для Account (дзеркало `BusinessSlugHistory`).
 * Зберігає попередні slug-и рахунку для двох сценаріїв:
 *
 *  1. **308-redirect збережених посилань.** Клієнт зберіг
 *     `pay.finly.com.ua/{biz}/{oldAccountSlug}`; після rename public lookup
 *     fallback-ить у цю collection і повертає поточний рахунок, SC робить
 *     `permanentRedirect()` на новий canonical URL.
 *  2. **Anti-squatting у межах бізнесу.** Поки старий slug у history (TTL =
 *     90 днів), його не можна зайняти іншому рахунку **того самого бізнесу**.
 *     Cross-business той самий slug дозволено (account-namespace per-business).
 *
 * **Самовідновлення на revert.** `AccountsService.update` усередині TX видаляє
 * history entry `(businessId, slugLower=newLower)` ПЕРЕД insert-ом нового
 * old-slug → дозволяє re-claim власного слога без чекати TTL.
 *
 * **Cascade-cleanup.** `BusinessesService.delete` видаляє всі history-entries
 * бізнесу (`deleteMany({businessId})`); `AccountsService.delete` —
 * `deleteMany({accountId})`. Деактивований ресурс віддає посилання одразу.
 *
 * **TTL via Mongo background-thread.** `expireAfterSeconds` на `createdAt` —
 * cleanup робить mongod сам, без cron-а. `slug` (case-preserved) не зберігаємо:
 * redirect target — поточний `account.slug`, історичний display-form не потрібен.
 */
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class AccountSlugHistory {
    @Prop({ required: true, type: Types.ObjectId })
    businessId!: Types.ObjectId;

    @Prop({ required: true, type: Types.ObjectId, index: true })
    accountId!: Types.ObjectId;

    @Prop({ required: true, lowercase: true, trim: true })
    slugLower!: string;

    /**
     * Sprint 19 — `true` (default) для добровільного rename (308-redirect);
     * `false` для lapse-reset (ім'я резервується на холд без редіректу).
     */
    @Prop({ type: Boolean, default: true })
    redirect!: boolean;

    createdAt!: Date;
}

export const AccountSlugHistorySchema =
    SchemaFactory.createForClass(AccountSlugHistory);

applyJsonTransform(AccountSlugHistorySchema);

/**
 * Compound-unique `(businessId, slugLower)` — anti-squatting у межах бізнесу +
 * race-guard на concurrent rename (один success + один 11000 → `SLUG_TAKEN`).
 * `businessId`-prefix обслуговує cascade `deleteMany({businessId})`.
 */
AccountSlugHistorySchema.index(
    { businessId: 1, slugLower: 1 },
    { unique: true }
);

// TTL — 90 днів (узгоджено з BusinessSlugHistory): redirect-grace + anti-
// squatting у єдиному вікні.
AccountSlugHistorySchema.index(
    { createdAt: 1 },
    { expireAfterSeconds: 90 * 24 * 60 * 60 }
);
