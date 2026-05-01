import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Business, BusinessSchema } from './schemas/business.schema';

/**
 * Sprint 1: модуль реєструє лише схему через `MongooseModule.forFeature` —
 * без controller'ів і service'ів. Endpoints / business-logic — Sprint 3.
 *
 * `MongooseModule` re-exported, щоб майбутні модулі (наприклад, `Invoices`,
 * `BookkeeperOps`) могли інжектувати `BusinessModel` без повторного `forFeature`.
 */
@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Business.name, schema: BusinessSchema },
        ]),
    ],
    exports: [MongooseModule],
})
export class BusinessesModule {}
