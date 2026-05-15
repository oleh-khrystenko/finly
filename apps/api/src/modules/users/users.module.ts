import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { AvatarService } from './avatar.service';
import { CleanupService } from './cleanup.service';
import { ReservationReconcileService } from './reservation-reconcile.service';
import {
    ExecutionTransaction,
    ExecutionTransactionSchema,
} from './schemas/execution-transaction.schema';
import { User, UserSchema } from './schemas/user.schema';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: User.name, schema: UserSchema },
            {
                name: ExecutionTransaction.name,
                schema: ExecutionTransactionSchema,
            },
        ]),
        forwardRef(() => AuthModule),
        // Sprint 13 §13 — AvatarService живе тут, отже потрібен доступ до
        // StorageService для pure file-ops. Цикл Storage↔Users на module-graph
        // тимчасово закритий через forwardRef у StorageModule (видаляється
        // останнім кроком спринта; на той момент Storage вже не залежить від
        // Users на class-level).
        StorageModule,
    ],
    controllers: [UsersController],
    providers: [
        UsersService,
        AvatarService,
        CleanupService,
        ReservationReconcileService,
    ],
    exports: [UsersService, AvatarService, MongooseModule],
})
export class UsersModule {}
