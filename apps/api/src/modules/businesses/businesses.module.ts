import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { QrModule } from '../qr/qr.module';
import { UsersModule } from '../users/users.module';
import { BusinessAccessGuard } from './business-access.guard';
import { BusinessesController } from './businesses.controller';
import { BusinessesService } from './businesses.service';
import { PublicBusinessesController } from './public-businesses.controller';
import { Business, BusinessSchema } from './schemas/business.schema';
import { SlugGeneratorService } from './slug-generator.service';

/**
 * Sprint 3 §3.2 + §3.3 — повний BusinessesModule.
 *
 * **Залежності:**
 *   - `MongooseModule.forFeature([Business])` — ModelToken для service і
 *     slug-generator.
 *   - `QrModule` — публічний controller інжектує `QrService` для двох
 *     QR-endpoint-ів (`/qr/business.png`, `/qr/nbu.png?host=...`).
 *   - `UsersModule` — `BusinessAccessGuard` залежить від `UserDocument` типу
 *     (через `request.user`); сам user injection йде через JwtActiveGuard,
 *     але ми залишаємо UsersModule в imports на майбутнє (Sprint 3 §3.4
 *     bookkeeper toggle endpoint живе у UsersModule, не тут).
 *
 * **Експорт `MongooseModule`** — для `InvoicesModule` (Sprint 4), що
 * інжектить BusinessModel у валідацію `Invoice.businessId`. Re-export
 * collapse-ить boilerplate `forFeature` повторного registration-у.
 */
@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Business.name, schema: BusinessSchema },
        ]),
        QrModule,
        UsersModule,
    ],
    controllers: [BusinessesController, PublicBusinessesController],
    providers: [BusinessesService, SlugGeneratorService, BusinessAccessGuard],
    exports: [MongooseModule, BusinessesService],
})
export class BusinessesModule {}
