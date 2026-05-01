import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';

import { EXECUTION_TRANSACTION_TYPE } from '@finly/types';
import {
    ExecutionTransaction,
    ExecutionTransactionDocument,
    ExecutionTransactionLean,
} from './schemas/execution-transaction.schema';
import { User, UserDocument } from './schemas/user.schema';
import type {
    CommitReservationOptions,
    CommitReservationResult,
} from './interfaces/reservation';

interface GoogleProfile {
    email: string;
    firstName?: string;
    lastName?: string;
    avatar?: string;
    providerId: string;
}

@Injectable()
export class UsersService {
    private readonly logger = new Logger(UsersService.name);

    constructor(
        @InjectModel(User.name)
        private readonly userModel: Model<UserDocument>,

        @InjectModel(ExecutionTransaction.name)
        private readonly executionTransactionModel: Model<ExecutionTransactionDocument>,

        @InjectConnection()
        private readonly connection: Connection
    ) {}

    async findByEmail(email: string): Promise<UserDocument | null> {
        return this.userModel.findOne({ email: email.toLowerCase() }).exec();
    }

    async findById(id: string): Promise<UserDocument | null> {
        return this.userModel.findById(id).exec();
    }

    async findOrCreateByGoogle(
        googleProfile: GoogleProfile
    ): Promise<UserDocument> {
        const existing = await this.userModel
            .findOne({ email: googleProfile.email.toLowerCase() })
            .exec();

        if (existing) {
            existing.lastLoginAt = new Date();

            if (!existing.provider) {
                existing.provider = {
                    name: 'google',
                    id: googleProfile.providerId,
                };
            }

            if (googleProfile.firstName && !existing.profile.firstName) {
                existing.profile.firstName = googleProfile.firstName;
            }

            if (googleProfile.lastName && !existing.profile.lastName) {
                existing.profile.lastName = googleProfile.lastName;
            }

            if (googleProfile.avatar && !existing.profile.avatar) {
                existing.profile.avatar = googleProfile.avatar;
            }

            return existing.save();
        }

        return this.userModel.create({
            email: googleProfile.email.toLowerCase(),
            provider: { name: 'google', id: googleProfile.providerId },
            profile: {
                firstName: googleProfile.firstName,
                lastName: googleProfile.lastName,
                avatar: googleProfile.avatar,
            },
            lastLoginAt: new Date(),
        });
    }

    async findOrCreateByEmail(email: string): Promise<UserDocument> {
        const normalizedEmail = email.toLowerCase();
        const existing = await this.userModel
            .findOne({ email: normalizedEmail })
            .exec();

        if (existing) {
            existing.lastLoginAt = new Date();
            return existing.save();
        }

        return this.userModel.create({
            email: normalizedEmail,
            lastLoginAt: new Date(),
        });
    }

    async addExecutions(
        userId: string,
        amount: number,
        action: string
    ): Promise<number> {
        const user = await this.userModel.findByIdAndUpdate(
            userId,
            { $inc: { 'executions.balance': amount } },
            { new: true }
        );
        const balanceAfter = user?.executions.balance ?? 0;

        await this.recordTransaction({
            userId,
            type: EXECUTION_TRANSACTION_TYPE.CREDIT,
            action,
            amount,
            balanceAfter,
        });

        return balanceAfter;
    }

    async spendExecutions(
        userId: string,
        amount: number,
        action: string
    ): Promise<{
        balanceAfter: number;
        transaction: ExecutionTransactionDocument;
    } | null> {
        const user = await this.userModel.findOneAndUpdate(
            { _id: userId, 'executions.balance': { $gte: amount } },
            { $inc: { 'executions.balance': -amount } },
            { new: true }
        );
        if (!user) return null;

        const balanceAfter = user.executions.balance;
        const transaction = await this.recordTransaction({
            userId,
            type: EXECUTION_TRANSACTION_TYPE.DEBIT,
            action,
            amount,
            balanceAfter,
        });

        return { balanceAfter, transaction };
    }

    async recordTransaction(data: {
        userId: string;
        type: string;
        action: string;
        amount: number;
        balanceAfter: number;
    }): Promise<ExecutionTransactionDocument> {
        return this.executionTransactionModel.create({
            userId: new Types.ObjectId(data.userId),
            type: data.type,
            action: data.action,
            amount: data.amount,
            balanceAfter: data.balanceAfter,
        });
    }

    async getRecentTransactions(
        userId: string,
        limit: number = 10,
        before?: Date
    ): Promise<{ items: ExecutionTransactionLean[]; hasMore: boolean }> {
        const filter: Record<string, unknown> = {
            userId: new Types.ObjectId(userId),
        };
        if (before) {
            filter.createdAt = { $lt: before };
        }

        const docs = await this.executionTransactionModel
            .find(filter)
            .sort({ createdAt: -1 })
            .limit(limit + 1)
            .lean();

        const hasMore = docs.length > limit;

        return {
            items: hasMore ? docs.slice(0, limit) : docs,
            hasMore,
        };
    }

    async clearTransactions(userId: string): Promise<void> {
        await this.executionTransactionModel.deleteMany({
            userId: new Types.ObjectId(userId),
        });
    }

    async deductExecution(userId: string): Promise<boolean> {
        // Try atomic paid-execution deduction first (no race condition).
        const paid = await this.userModel.findOneAndUpdate(
            { _id: userId, 'executions.balance': { $gt: 0 } },
            { $inc: { 'executions.balance': -1 } },
            { new: true }
        );
        if (paid) return true;

        // Fallback: consume free report atomically.
        const free = await this.userModel.findOneAndUpdate(
            { _id: userId, 'executions.freeReportUsed': false },
            { $set: { 'executions.freeReportUsed': true } },
            { new: true }
        );
        return free !== null;
    }

    async updateTimezone(userId: string, timezone: string): Promise<void> {
        await this.userModel.findByIdAndUpdate(userId, { timezone }).exec();
    }

    async setPasswordHash(userId: string, hash: string): Promise<void> {
        await this.userModel.findByIdAndUpdate(userId, { passwordHash: hash });
    }

    async setDeletionRequested(userId: string): Promise<void> {
        await this.userModel.findByIdAndUpdate(userId, {
            accountDeletionRequestedAt: new Date(),
        });
    }

    async softDelete(userId: string): Promise<void> {
        await this.userModel.findByIdAndUpdate(userId, {
            deletedAt: new Date(),
            accountDeletionRequestedAt: null,
        });
    }

    async restore(userId: string): Promise<void> {
        await this.userModel.findByIdAndUpdate(userId, {
            deletedAt: null,
            accountDeletionRequestedAt: null,
            deletionReminderSentAt: null,
        });
    }

    async updateProfile(
        userId: string,
        data: {
            firstName?: string;
            lastName?: string;
            avatar?: string;
        }
    ): Promise<UserDocument | null> {
        const update: Record<string, unknown> = {};
        if (data.firstName !== undefined)
            update['profile.firstName'] = data.firstName;
        if (data.lastName !== undefined)
            update['profile.lastName'] = data.lastName;
        if (data.avatar !== undefined) update['profile.avatar'] = data.avatar;
        return this.userModel.findByIdAndUpdate(userId, update, { new: true });
    }

    async clearAvatar(userId: string): Promise<UserDocument | null> {
        return this.userModel.findByIdAndUpdate(
            userId,
            { $unset: { 'profile.avatar': 1 } },
            { new: true }
        );
    }

    async acceptTerms(userId: string, termsVersion: string): Promise<void> {
        await this.userModel.updateOne(
            { _id: userId },
            {
                $set: {
                    termsAcceptedAt: new Date(),
                    termsVersion,
                },
            }
        );
    }

    async hasExecution(userId: string): Promise<boolean> {
        const user = await this.userModel.findById(userId).exec();
        if (!user) return false;

        return user.executions.balance > 0 || !user.executions.freeReportUsed;
    }

    // ── Reservation core API ─────────────────────────────────────

    async commitReservation(
        options: CommitReservationOptions
    ): Promise<CommitReservationResult> {
        const { userId, reservationId, ledgerEntry, sideEffectInTx } = options;

        const session = await this.connection.startSession();
        try {
            let balanceAfter = 0;

            await session.withTransaction(async () => {
                // Step 1 — Claim reservation (claim-first order).
                const claimResult = await this.userModel.updateOne(
                    {
                        _id: userId,
                        'executions.activeReservation.id': reservationId,
                    },
                    { $set: { 'executions.activeReservation': null } },
                    { session }
                );

                if (claimResult.matchedCount === 0) {
                    throw new Error('Reservation not found or already closed');
                }

                // Step 2 — Fresh balance read (concurrent-safe within transaction).
                const user = await this.userModel.findOne(
                    { _id: userId },
                    { 'executions.balance': 1 },
                    { session }
                );
                balanceAfter = user?.executions.balance ?? 0;

                // Step 3 — Ledger insert (unique sparse index on reservationId = defense-in-depth).
                await this.executionTransactionModel.create(
                    [
                        {
                            userId: new Types.ObjectId(userId),
                            type: ledgerEntry.type,
                            action: ledgerEntry.action,
                            amount: ledgerEntry.amount,
                            balanceAfter,
                            reservationId,
                        },
                    ],
                    { session }
                );

                // Step 4 — Feature side effects (within same transaction).
                if (sideEffectInTx) {
                    await sideEffectInTx(session);
                }
            });

            return { balanceAfter };
        } finally {
            await session.endSession();
        }
    }

    async refundReservation(
        userId: string,
        reservationId: string
    ): Promise<void> {
        // Phase A — Read compensationOps from active reservation.
        const user = await this.userModel.findOne(
            {
                _id: userId,
                'executions.activeReservation.id': reservationId,
            },
            { 'executions.activeReservation': 1 }
        );

        if (!user?.executions.activeReservation) {
            return; // Already closed — idempotent no-op.
        }

        const { amount, compensationOps } = user.executions.activeReservation;

        // Phase B — Atomic update: restore balance + apply compensation + clear reservation.
        const incOps: Record<string, number> = {
            'executions.balance': amount,
            ...(compensationOps?.inc ?? {}),
        };

        const result = await this.userModel.findOneAndUpdate(
            {
                _id: userId,
                'executions.activeReservation.id': reservationId,
            },
            {
                $inc: incOps,
                $set: { 'executions.activeReservation': null },
            }
        );

        if (!result) {
            return; // Race: another process closed it — idempotent no-op.
        }

        this.logger.log(
            `Refunded reservation ${reservationId} for user ${userId}: +${amount} balance`
        );
    }
}
