import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';

import { ENV } from '../../config/env';
import {
    Business,
    BusinessDocument,
} from '../businesses/schemas/business.schema';
import { BusinessesService } from '../businesses/businesses.service';
import { EmailService } from '../email/email.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';

const MS_PER_DAY = 86_400_000;

interface OrphanCandidate {
    _id: Types.ObjectId;
    email: string;
    orphanBusinesses: Array<{ name: string; createdAt: Date }>;
    oldestBusinessCreatedAt: Date;
    firstReminderSentAt: Date | null;
    finalWarningSentAt: Date | null;
}

type CleanupStage = 1 | 2 | 3;

@Injectable()
export class OrphanProfileCleanupService {
    private readonly logger = new Logger(OrphanProfileCleanupService.name);

    constructor(
        @InjectModel(User.name)
        private readonly userModel: Model<UserDocument>,
        @InjectModel(Business.name)
        private readonly businessModel: Model<BusinessDocument>,
        private readonly usersService: UsersService,
        private readonly businessesService: BusinessesService,
        private readonly emailService: EmailService
    ) {}

    @Cron('0 5 * * *', { timeZone: 'Europe/Kyiv' })
    async runDailyCleanup(): Promise<void> {
        const now = new Date();
        const candidates = await this.findCandidates();

        if (candidates.length === 0) {
            this.logger.log('Orphan cleanup: no candidates');
            return;
        }

        let stage1Sent = 0;
        let stage2Sent = 0;
        let stage3Deleted = 0;
        let skipped = 0;

        for (const candidate of candidates) {
            try {
                const stage = this.resolveStage(candidate, now);
                if (stage === null) {
                    skipped++;
                    continue;
                }

                if (stage === 1 || stage === 2) {
                    const sent = await this.runReminderStage(
                        candidate,
                        stage === 1 ? 'first' : 'final'
                    );
                    if (sent) {
                        if (stage === 1) stage1Sent++;
                        else stage2Sent++;
                    }
                } else {
                    const ok = await this.runDeletionStage(candidate);
                    if (ok) stage3Deleted++;
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                this.logger.error(
                    `Unhandled per-candidate failure for user ${candidate._id.toString()}: ${message}. ` +
                        'Continuing with remaining candidates.'
                );
            }
        }

        this.logger.log(
            `Orphan cleanup: candidates=${candidates.length} ` +
                `stage1=${stage1Sent} stage2=${stage2Sent} stage3=${stage3Deleted} ` +
                `skipped=${skipped}`
        );
    }

    private async findCandidates(): Promise<OrphanCandidate[]> {
        return this.userModel
            .aggregate<OrphanCandidate>([
                {
                    $match: {
                        deletedAt: null,
                        $or: [
                            { 'profile.firstName': { $exists: false } },
                            { 'profile.firstName': null },
                            { 'profile.firstName': '' },
                            { 'profile.lastName': { $exists: false } },
                            { 'profile.lastName': null },
                            { 'profile.lastName': '' },
                        ],
                    },
                },
                {
                    $lookup: {
                        from: 'businesses',
                        localField: '_id',
                        foreignField: 'ownerId',
                        as: 'orphanBusinesses',
                    },
                },
                { $match: { 'orphanBusinesses.0': { $exists: true } } },
                {
                    $addFields: {
                        oldestBusinessCreatedAt: {
                            $min: '$orphanBusinesses.createdAt',
                        },
                        firstReminderSentAt: {
                            $ifNull: [
                                '$profileCompletionReminders.firstReminderSentAt',
                                null,
                            ],
                        },
                        finalWarningSentAt: {
                            $ifNull: [
                                '$profileCompletionReminders.finalWarningSentAt',
                                null,
                            ],
                        },
                    },
                },
                {
                    $project: {
                        _id: 1,
                        email: 1,
                        orphanBusinesses: { name: 1, createdAt: 1 },
                        oldestBusinessCreatedAt: 1,
                        firstReminderSentAt: 1,
                        finalWarningSentAt: 1,
                    },
                },
            ])
            .exec();
    }

    private resolveStage(
        candidate: OrphanCandidate,
        now: Date
    ): CleanupStage | null {
        const ageDays =
            (now.getTime() - candidate.oldestBusinessCreatedAt.getTime()) /
            MS_PER_DAY;
        const { firstReminderSentAt, finalWarningSentAt } = candidate;

        if (
            ageDays >= ENV.ORPHAN_CLEANUP_DELETION_DAYS &&
            finalWarningSentAt !== null
        ) {
            return 3;
        }
        if (
            ageDays >= ENV.ORPHAN_REMINDER_FINAL_DAYS &&
            finalWarningSentAt === null &&
            firstReminderSentAt !== null
        ) {
            return 2;
        }
        if (
            ageDays >= ENV.ORPHAN_REMINDER_FIRST_DAYS &&
            firstReminderSentAt === null
        ) {
            return 1;
        }
        return null;
    }

    private async runReminderStage(
        candidate: OrphanCandidate,
        stage: 'first' | 'final'
    ): Promise<boolean> {
        const userId = candidate._id.toString();
        const claimed = await this.usersService.stampProfileCompletionReminder(
            userId,
            stage
        );
        if (!claimed) return false;

        const user = { email: candidate.email };
        const businesses = candidate.orphanBusinesses.map((b) => ({
            name: b.name,
        }));

        try {
            if (stage === 'first') {
                await this.emailService.sendProfileCompletionReminder({
                    user,
                    businesses,
                });
            } else {
                await this.emailService.sendProfileCompletionFinalWarning({
                    user,
                    businesses,
                });
            }
            return true;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.error(
                `Failed to send ${stage}-stage reminder to ${candidate.email} ` +
                    `(user ${userId}): ${message}. Reverting stamp.`
            );
            await this.usersService.resetSingleStamp(userId, stage);
            return false;
        }
    }

    private async runDeletionStage(
        candidate: OrphanCandidate
    ): Promise<boolean> {
        const userId = candidate._id.toString();
        const businesses = await this.businessModel
            .find({ ownerId: candidate._id })
            .sort({ createdAt: 1 })
            .exec();

        let deleted = 0;
        for (const business of businesses) {
            try {
                await this.businessesService.delete(business);
                deleted++;
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                this.logger.error(
                    `Cascade delete failed for business ${business._id.toString()} ` +
                        `(user ${userId}): ${message}. Aborting deletion stage for this user.`
                );
                break;
            }
        }

        const remaining = await this.businessModel.countDocuments({
            ownerId: candidate._id,
        });
        if (remaining === 0) {
            await this.usersService.finalizeOrphanCleanup(userId);
            this.logger.log(
                `Orphan cleanup: deleted ${deleted} businesses for user ${userId}; ` +
                    'reminders and pendingPostLoginTarget cleared.'
            );
            return true;
        }

        this.logger.warn(
            `Orphan cleanup: partial cascade for user ${userId} ` +
                `(${deleted}/${businesses.length} deleted, ${remaining} remaining). ` +
                'Reminders kept for next-cycle retry.'
        );
        return false;
    }
}
