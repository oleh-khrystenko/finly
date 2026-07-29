import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import { applyJsonTransform } from '../../../common/mongoose/json-transform';

export type PayerDocument = HydratedDocument<Payer>;

/**
 * Sprint 30 — платник, за якого користувач платить регулярно (бухгалтер і його
 * клієнти). Джерело підстановки ПІБ і РНОКПП на публічній податковій сторінці;
 * у платіжних сутностях (Business/Account/Invoice) не бере участі жодним чином.
 *
 * **Інваріанти, яких Mongoose не бачить** (живуть у сервісі):
 *  - верхня межа записів на користувача (`PAYERS_MAX_PER_USER`);
 *  - формат ПІБ і РНОКПП — Zod DTO, ті самі правила, що на формі підстановки.
 */
@Schema({ timestamps: true })
export class Payer {
    @Prop({ type: Types.ObjectId, required: true })
    userId!: Types.ObjectId;

    @Prop({ required: true, trim: true })
    fullName!: string;

    @Prop({ required: true, trim: true })
    taxId!: string;

    createdAt!: Date;
    updatedAt!: Date;
}

export const PayerSchema = SchemaFactory.createForClass(Payer);

applyJsonTransform(PayerSchema);

/**
 * РНОКПП унікальний у межах ОДНОГО користувача: повторне збереження того самого
 * клієнта (бухгалтер платить за нього щокварталу) не має створювати дубль, але
 * два різні бухгалтери законно ведуть того самого клієнта. Унікальність на
 * рівні колекції зробила б другого заручником першого.
 */
PayerSchema.index({ userId: 1, taxId: 1 }, { unique: true });

/** Список у профілі — стабільний порядок «нові зверху». */
PayerSchema.index({ userId: 1, createdAt: -1 });
