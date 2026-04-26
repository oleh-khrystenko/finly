import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model } from 'mongoose';

import { User, UserDocument } from './schemas/user.schema';
import { UsersService } from './users.service';

const BATCH_LIMIT = 100;

@Injectable()
export class ReservationReconcileService {
    private readonly logger = new Logger(ReservationReconcileService.name);

    constructor(
        @InjectModel(User.name)
        private readonly userModel: Model<UserDocument>,
        private readonly usersService: UsersService
    ) {}

    @Cron(CronExpression.EVERY_5_MINUTES)
    async reconcileExpiredReservations(): Promise<void> {
        const now = new Date();

        const users = await this.userModel
            .find(
                { 'executions.activeReservation.expiresAt': { $lt: now } },
                { _id: 1, 'executions.activeReservation': 1 }
            )
            .limit(BATCH_LIMIT)
            .lean()
            .exec();

        if (users.length === 0) return;

        let refunded = 0;

        for (const user of users) {
            const reservation = user.executions.activeReservation;
            if (!reservation) continue;

            const userId = user._id.toString();

            try {
                await this.usersService.refundReservation(
                    userId,
                    reservation.id
                );
                refunded++;

                this.logger.warn(
                    `Reconciled expired reservation: ` +
                        `userId=${userId}, ` +
                        `reservationId=${reservation.id}, ` +
                        `feature=${reservation.feature}, ` +
                        `amount=${reservation.amount}, ` +
                        `expiredAt=${reservation.expiresAt.toISOString()}, ` +
                        `expiredAgoMs=${now.getTime() - reservation.expiresAt.getTime()}`
                );
            } catch (err) {
                this.logger.error(
                    `Failed to reconcile reservation ${reservation.id} ` +
                        `for user ${userId}: ${(err as Error).message}`
                );
            }
        }

        this.logger.log(
            `Reservation reconcile: ${refunded}/${users.length} refunded`
        );
    }
}
