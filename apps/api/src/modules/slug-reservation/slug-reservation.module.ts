import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import {
    SlugReservation,
    SlugReservationSchema,
} from './schemas/slug-reservation.schema';
import { SlugReservationService } from './slug-reservation.service';

/**
 * Sprint 20 — standalone-модуль броні slug. Залежить лише від власної колекції
 * і глобального `RedisLockService` (з `@Global() RedisModule`), тож імпорт у
 * Businesses/Accounts/Invoices/Users не створює циклів у DAG
 * `Users ← Businesses ← Accounts ← Invoices`.
 */
@Module({
    imports: [
        MongooseModule.forFeature([
            { name: SlugReservation.name, schema: SlugReservationSchema },
        ]),
    ],
    providers: [SlugReservationService],
    exports: [SlugReservationService, MongooseModule],
})
export class SlugReservationModule {}
