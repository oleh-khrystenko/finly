import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { PayersController } from './payers.controller';
import { PayersService } from './payers.service';
import { Payer, PayerSchema } from './schemas/payer.schema';

/**
 * Sprint 30 — список платників. Модуль самодостатній: залежностей від інших
 * доменних модулів немає, а `UsersModule` (чистка при остаточному видаленні
 * акаунта) споживає лише експортований сервіс — напрям залежності `Users →
 * Payers`, без зворотного ребра.
 */
@Module({
    imports: [
        MongooseModule.forFeature([{ name: Payer.name, schema: PayerSchema }]),
    ],
    controllers: [PayersController],
    providers: [PayersService],
    exports: [PayersService],
})
export class PayersModule {}
