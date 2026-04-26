import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AuthModule } from '../auth/auth.module';
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
    ],
    controllers: [UsersController],
    providers: [UsersService, CleanupService, ReservationReconcileService],
    exports: [UsersService, MongooseModule],
})
export class UsersModule {}
