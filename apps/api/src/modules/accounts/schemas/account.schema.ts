import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
    MVP_BANKS,
    SLUG_PRESETS,
    type BankCode,
    type SlugPreset,
} from '@finly/types';

import { applyJsonTransform } from '../../../common/mongoose/json-transform';

export type AccountDocument = HydratedDocument<Account>;

/**
 * Sprint 9 §SP-1 — банківський рахунок під бізнесом. Розщеплення `Business`-
 * сутності: до Sprint 9 IBAN жив на `Business.requisites`, що плутало юр-особу
 * і банківський рахунок. Account — окрема сутність з IBAN + auto-name +
 * stored `bankCode` (§SP-9).
 *
 * **Інваріанти, що Mongoose НЕ перевіряє** (живуть у Zod / service-layer):
 *  - `iban` immutable post-creation (§SP-2) — DTO-rule, `UpdateAccountSchema`
 *    не містить `iban`.
 *  - `bankCode === bankCodeFromIban(iban)` — write-time, ставиться у
 *    `AccountsService.create` один раз. IBAN immutability + stored bankCode
 *    → drift неможливий.
 *  - Format-валідація IBAN (MOD-97 checksum, UA-prefix) — `ibanZod` Zod-шар.
 *
 * **`deletedAt` навмисно невикористане** (mirror-pattern `Business.deletedAt`).
 * §SP-3 — hard-delete всередині `withTransaction`. Поле залишене для forward-
 * compat з потенційним soft-delete-pattern-ом (Sprint 13+).
 */
@Schema({ timestamps: true })
export class Account {
    @Prop({ required: true, type: Types.ObjectId })
    businessId!: Types.ObjectId;

    /**
     * UA IBAN, 29 символів. Format-валідація на write-DTO `ibanZod`; тут
     * структурна вимога NOT NULL.
     */
    @Prop({ required: true, trim: true })
    iban!: string;

    /**
     * §SP-9 — stored derived value з `bankCodeFromIban(iban)`, ставиться в
     * `AccountsService.create` рівно один раз. `null` для нерозпізнаних МФО
     * (поза `BANK_MFO_MAP`). UI-rule: на null-bankCode bank-label-row
     * ховається (4 UI-точки).
     */
    @Prop({ type: String, enum: MVP_BANKS, default: null })
    bankCode!: BankCode | null;

    /**
     * Display-name 1..60 chars, **nullable**. `null` = ФОП не ввів власну назву;
     * display-лейбл деривується на льоту (`deriveAccountLabel`) як
     * `"{BANK_LABEL} •{last4}"`. Раніше service матеріалізував цей рядок у поле,
     * але він дублювався з bank-label/mask-рядками картки (§Sprint-design-fix).
     * Format-валідація введеного значення (length, byte, NBU-charset) — Zod write-DTO.
     */
    @Prop({ type: String, trim: true, default: null })
    name!: string | null;

    /**
     * Sprint 15 — редаговуваний vanity-slug (раніше §SP-10 immutable 8-char
     * random). Display case-preserved; uniqueness/lookup на `slugLower`.
     * Create авто-генерує 8-char tail; ФОП може перейменувати у кабінеті.
     */
    @Prop({ required: true, trim: true })
    slug!: string;

    /**
     * Sprint 15 — lowercase-нормалізована форма `slug` (дзеркало Business).
     * Compound-unique `(businessId, slugLower)` — case-insensitive uniqueness
     * у межах бізнесу. Сервіс — єдина точка `slug.toLowerCase()`.
     */
    @Prop({ required: true, trim: true, lowercase: true })
    slugLower!: string;

    /**
     * §SP-6 — per-account дефолт slug-preset для нових інвойсів. `null` =
     * "не визначено", форма створення інвойсу fallback-ить на global system
     * default `'simple'`. Sprint 9 переніс власника поля з Business на
     * Account (нумерація інвойсів per-account).
     */
    @Prop({ type: String, enum: SLUG_PRESETS, default: null })
    invoiceSlugPresetDefault!: SlugPreset | null;

    @Prop({ type: Date, default: null })
    deletedAt!: Date | null;

    createdAt!: Date;
    updatedAt!: Date;
}

export const AccountSchema = SchemaFactory.createForClass(Account);

applyJsonTransform(AccountSchema);

/**
 * Sprint 15 — compound-unique переходить з `(businessId, slug)` на
 * `(businessId, slugLower)`: case-insensitive uniqueness у межах бізнесу
 * (дзеркало Business). Vanity-slug редаговуваний, тому регістронезалежність
 * захищає публічне посилання від case-mismatch. Міграція
 * `2026-06-03-nested-slug-lower` drop-ає старий `(businessId, slug)` unique.
 */
AccountSchema.index({ businessId: 1, slugLower: 1 }, { unique: true });

/**
 * Sprint 9 §SP-2 — compound-unique `(businessId, iban)`. Два account-документи
 * з однаковим IBAN під одним бізнесом заборонені на DB-рівні. Cross-business
 * duplicate (ФОП і ТОВ ділять рахунок) — дозволено.
 */
AccountSchema.index({ businessId: 1, iban: 1 }, { unique: true });

/**
 * Sprint 9 — list-sort index для `AccountsService.getByBusinessId`. Mongo
 * однаково обслуговує `sort: { createdAt: 1 }` і `sort: { createdAt: -1 }`
 * через цей direction-neutral index.
 */
AccountSchema.index({ businessId: 1, createdAt: 1 });
