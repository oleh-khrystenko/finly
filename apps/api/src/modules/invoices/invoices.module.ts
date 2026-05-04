import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { InvoiceSlugGeneratorService } from './invoice-slug-generator.service';
import { Invoice, InvoiceSchema } from './schemas/invoice.schema';

/**
 * Sprint 1: реєстрація схеми. Sprint 4 §4.1: реєстрація
 * `InvoiceSlugGeneratorService` як provider — buнесений у окремий module-
 * exposed primitive, щоб controllers/services Sprint 4 §4.2 могли його
 * інжектити без cyclic-DI.
 *
 * Sprint 4 §4.2 розширить цей module на CRUD-controller + service + access-
 * guard + DTO + payload-mapper.
 */
@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Invoice.name, schema: InvoiceSchema },
        ]),
    ],
    providers: [InvoiceSlugGeneratorService],
    exports: [MongooseModule, InvoiceSlugGeneratorService],
})
export class InvoicesModule {}
