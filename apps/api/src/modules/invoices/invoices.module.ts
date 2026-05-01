import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Invoice, InvoiceSchema } from './schemas/invoice.schema';

/**
 * Sprint 1: модуль реєструє лише схему через `MongooseModule.forFeature` —
 * без controller'ів і service'ів. Endpoints / business-logic — Sprint 4.
 */
@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Invoice.name, schema: InvoiceSchema },
        ]),
    ],
    exports: [MongooseModule],
})
export class InvoicesModule {}
