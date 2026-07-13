import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AuthModule } from '../auth/auth.module';
import {
    BillingProfile,
    BillingProfileSchema,
} from '../payments/schemas/billing-profile.schema';
import { SlugReservationModule } from '../slug-reservation/slug-reservation.module';
import { StorageModule } from '../storage/storage.module';
import { AvatarController } from './avatar.controller';
import { AvatarService } from './avatar.service';
import { CleanupService } from './cleanup.service';
import { User, UserSchema } from './schemas/user.schema';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: User.name, schema: UserSchema },
            // Sprint 27 — hard-delete користувача мусить гасити його білінг-
            // профіль (schema-import, без Nest-залежності на PaymentsModule).
            { name: BillingProfile.name, schema: BillingProfileSchema },
        ]),
        forwardRef(() => AuthModule),
        // Sprint 13 §13 — AvatarService + AvatarController живуть тут;
        // потрібен доступ до StorageService для pure file-ops. StorageModule
        // autonomous, тому імпорт безризиковий — петлі немає.
        StorageModule,
        // Sprint 20 — `getMe` віддає активну бронь slug (відлік + добивання
        // наміру). SlugReservationModule standalone, циклу немає.
        SlugReservationModule,
    ],
    controllers: [UsersController, AvatarController],
    providers: [UsersService, AvatarService, CleanupService],
    exports: [UsersService, AvatarService, MongooseModule],
})
export class UsersModule {}
