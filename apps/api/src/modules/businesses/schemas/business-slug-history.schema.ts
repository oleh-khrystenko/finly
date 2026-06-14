import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import { applyJsonTransform } from '../../../common/mongoose/json-transform';

export type BusinessSlugHistoryDocument = HydratedDocument<BusinessSlugHistory>;

/**
 * Sprint 14 — vanity-slug edit. Зберігає попередні slug-и бізнесу для двох
 * сценаріїв:
 *
 *  1. **308-redirect збережених посилань.** Клієнт зберіг
 *     `pay.finly.com.ua/{oldSlug}` у банк-апі чи скріншоті; після rename
 *     public lookup fallback-ить у цю collection і повертає canonical-business,
 *     SC робить `permanentRedirect()` на новий URL.
 *  2. **Anti-squatting.** Поки старий slug у history (TTL = 90 днів), його не
 *     можна зайняти іншим бізнесом — захищає від "захоплення" відомого
 *     посилання одразу після rename. Symmetric з GitHub org/repo rename pattern.
 *
 * **Самовідновлення на revert.** Якщо власник міняє slug назад (наприклад
 * `abc → xyz → abc`), `BusinessesService.update` усередині TX видаляє
 * history entry `(businessId, slugLower=newLower)` ПЕРЕД insert-ом нового
 * old-slug → дозволяє ре-claim власного слога без чекати TTL.
 *
 * **Cascade-delete на Business.** `BusinessesService.delete` видаляє всі
 * history-entries видаленого бізнесу в тій самій TX (cascade-cleanup).
 * Семантика: anti-squatting протягом TTL стосується **rename-flow**, не
 * delete-flow — деактивований бізнес добровільно віддає всі свої посилання,
 * вони мають стати доступними для нових бізнесів одразу. Anti-impersonation
 * захист гарантує payment-app: банк рендерить payee name з QR-payload,
 * customer бачить mismatch на чужому імені і скасовує платіж.
 *
 * **TTL via Mongo background-thread, не cron.** Mongo `expireAfterSeconds`
 * на `createdAt`-індексі — cleanup робить mongod сам кожні ~60 сек.
 * Ніякого `OnModuleInit` cron-а не потрібно.
 *
 * **`slug` (case-preserved) навмисно НЕ зберігаємо.** Redirect target — це
 * **поточний** `business.slug`; історичний display-form не потрібен. Збереження
 * лише `slugLower` робить collection вдвічі легшим і прибирає race із
 * case-only rename-ами.
 */
@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class BusinessSlugHistory {
    @Prop({ required: true, type: Types.ObjectId, index: true })
    businessId!: Types.ObjectId;

    /**
     * Lowercase-нормалізована форма старого slug-а. Unique-index гарантує
     * anti-squatting: дві різні rename-операції не можуть створити дублі
     * (race ловиться на 11000).
     */
    @Prop({ required: true, lowercase: true, trim: true })
    slugLower!: string;

    /**
     * Sprint 19 — чи робить запис 308-redirect на канонічний бізнес. `true`
     * (default) для добровільного rename: старе посилання веде на новий slug.
     * `false` для lapse-reset (втрата доступу): ім'я лише резервується на холд
     * (anti-squatting через unique-index лишається), але публічний хіт на нього
     * НЕ редіректить на колишнього неплатника — інакше його надруковані QR
     * лишались би робочими, а ім'я не можна було б перепродати.
     */
    @Prop({ type: Boolean, default: true })
    redirect!: boolean;

    createdAt!: Date;
}

export const BusinessSlugHistorySchema =
    SchemaFactory.createForClass(BusinessSlugHistory);

applyJsonTransform(BusinessSlugHistorySchema);

BusinessSlugHistorySchema.index({ slugLower: 1 }, { unique: true });

// TTL — 90 днів. Збігається з real-world нормами для permanent-redirect-grace
// (GitHub: 30 днів anti-squatting + indefinite redirect; ми обʼєднуємо обидва
// у єдине вікно: history-entry живе 90 днів, після чого і redirect зникає, і
// slug стає вільним для нового бізнесу). Bumping TTL пізніше — безболісно
// (старіші entries не зникнуть швидше); зменшення — також OK (entries
// почнуть expirat-ись швидше).
BusinessSlugHistorySchema.index(
    { createdAt: 1 },
    { expireAfterSeconds: 90 * 24 * 60 * 60 }
);
