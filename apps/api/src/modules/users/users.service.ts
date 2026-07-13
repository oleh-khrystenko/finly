import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { RESPONSE_CODE, validateSameOriginPath } from '@finly/types';
import { User, UserDocument } from './schemas/user.schema';

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
        private readonly userModel: Model<UserDocument>
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
            worksAsBookkeeper?: boolean;
        }
    ): Promise<UserDocument | null> {
        const update: Record<string, unknown> = {};
        if (data.firstName !== undefined)
            update['profile.firstName'] = data.firstName;
        if (data.lastName !== undefined)
            update['profile.lastName'] = data.lastName;
        if (data.avatar !== undefined) update['profile.avatar'] = data.avatar;
        // Sprint 3 §3.4 — bookkeeper toggle (рішення E5). Поле живе на
        // корені user-документа (не у `profile`), бо це capability акаунту,
        // не онбординг-атрибут — toggle перемикається багато разів за
        // життям акаунту, а profile-поля сетяться один раз при онбордингу.
        // Sprint 3 розкриває toggle усім (без Paid-перевірки); gating —
        // Sprint 6 (frontend модалка "Доступно на Paid").
        if (data.worksAsBookkeeper !== undefined)
            update.worksAsBookkeeper = data.worksAsBookkeeper;
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

    /**
     * Sprint 10 §SP-12 — terms-pre-stamp у magic-link verify-flow ДО claim.
     * Idempotent: filter `termsVersion: $ne: version` блокує перезапис того
     * самого значення; на новий version — overwrite. Викликається з
     * `AuthService.verifyMagicLink` order-step (2), uniform across `login` /
     * `register` / `reset-password` purpose-ів (`delete-account` структурно
     * виключений: terms-stamp до видалення акаунту не має сенсу).
     *
     * Відрізняється від `acceptTerms` саме idempotency-семантикою: `acceptTerms`
     * — public user-action endpoint (POST /users/me/accept-terms), завжди
     * стемпить новий `termsAcceptedAt`; `stampAcceptedTerms` — server-side
     * automatic у magic-link flow, не повинен оновлювати `termsAcceptedAt`
     * якщо version не змінилася (іначе верифікація поверни-знов-знов сторінки
     * безпідставно пере-стемпило б дату).
     */
    async stampAcceptedTerms(
        userId: string,
        termsVersion: string
    ): Promise<void> {
        await this.userModel.updateOne(
            { _id: userId, termsVersion: { $ne: termsVersion } },
            {
                $set: {
                    termsAcceptedAt: new Date(),
                    termsVersion,
                },
            }
        );
    }

    /**
     * Sprint 11 — write-once stamp на success-claim (`LandingClaimService`).
     * Runtime validation через shared helper зберігає invariant навіть на
     * прямих сервіс-call-сайтах поза DTO-pipeline. Невалідний target — throw
     * `INVALID_REDIRECT_TARGET` як programming-error-marker: caller
     * (`LandingClaimService.stampPostLoginTarget`) розрізняє його від
     * infra-failures і пише у `logger.error` (alertable severity), без
     * re-throw — stamp non-blocking за дизайном claim-flow.
     */
    async setPendingPostLoginTarget(
        userId: string,
        target: string
    ): Promise<void> {
        if (!validateSameOriginPath(target)) {
            throw new BadRequestException({
                code: RESPONSE_CODE.INVALID_REDIRECT_TARGET,
                message: 'Invalid pending post-login target',
            });
        }
        await this.userModel.updateOne(
            { _id: userId },
            { $set: { pendingPostLoginTarget: target } }
        );
    }

    /**
     * Sprint 11 — consume-and-clear; викликається frontend через PATCH
     * `/users/me { pendingPostLoginTarget: null }` (verify-handler same-device
     * + AuthInitializer cold-login). Sprint 12 cron Stage 3 cleanup-flow теж
     * скористається цим методом напряму. Idempotent — `$unset` на відсутньому
     * полі — no-op.
     */
    async clearPendingPostLoginTarget(userId: string): Promise<void> {
        await this.userModel.updateOne(
            { _id: userId },
            { $unset: { pendingPostLoginTarget: 1 } }
        );
    }

    /**
     * Sprint 12 §12.1a — atomic claim-first stamp для 3-stage orphan-cleanup
     * email-pipeline. Conditional-filter включає prereq-guard для `'final'`
     * (stamp finalWarningSentAt дозволено тільки якщо firstReminderSentAt уже
     * non-null). Caller отримує boolean: `true` → ми claim-нули і мусимо
     * відправити лист; `false` → інший concurrent cron-instance уже claim-нув
     * АБО prereq-guard відхилив (Stage 2 без Stage 1 stamp у race-window).
     */
    async stampProfileCompletionReminder(
        userId: string,
        stage: 'first' | 'final'
    ): Promise<boolean> {
        const filter: Record<string, unknown> =
            stage === 'first'
                ? {
                      _id: userId,
                      'profileCompletionReminders.firstReminderSentAt': null,
                  }
                : {
                      _id: userId,
                      'profileCompletionReminders.finalWarningSentAt': null,
                      'profileCompletionReminders.firstReminderSentAt': {
                          $ne: null,
                      },
                  };
        const fieldPath =
            stage === 'first'
                ? 'profileCompletionReminders.firstReminderSentAt'
                : 'profileCompletionReminders.finalWarningSentAt';
        const result = await this.userModel.updateOne(filter, {
            $set: { [fieldPath]: new Date() },
        });
        return result.matchedCount > 0;
    }

    /**
     * Sprint 12 §12.1a — revert щойно-claim-нутого stamp-а на email-send-
     * failure path-у. Non-conditional `$set:null` — caller гарантує що
     * викликається тільки після successful claim і failed email-send (поза
     * цим контекстом використовувати не можна — стерти non-null stamp без
     * перевірки prereq-у Stage 2/3 порушить email-trail invariant).
     */
    async resetSingleStamp(
        userId: string,
        stage: 'first' | 'final'
    ): Promise<void> {
        const fieldPath =
            stage === 'first'
                ? 'profileCompletionReminders.firstReminderSentAt'
                : 'profileCompletionReminders.finalWarningSentAt';
        await this.userModel.updateOne(
            { _id: userId },
            { $set: { [fieldPath]: null } }
        );
    }

    /**
     * Sprint 12 §12.1a — post-Stage-3 atomic housekeeping. Викликається ТІЛЬКИ
     * після cascade-deletion full-success (history-bucket consumed; цикл
     * рестартує якщо user знову створить orphan-Business). Partial-cascade
     * failure → метод НЕ викликається, наступний cron-cycle ретраїть Stage 3.
     *
     * Single `updateOne` з комбінованим `$set` + `$unset` — atomic-within-doc
     * write. Альтернатива (два sequential update-и) ризикує stuck-stamps-станом
     * на transient Mongo-failure між ними: cascade committed, reminders stuck,
     * наступний цикл silent-видалить новий orphan-Business без листа (порушує
     * compliance-invariant "warned twice before deletion").
     */
    async finalizeOrphanCleanup(userId: string): Promise<void> {
        await this.userModel.updateOne(
            { _id: userId },
            {
                $set: {
                    'profileCompletionReminders.firstReminderSentAt': null,
                    'profileCompletionReminders.finalWarningSentAt': null,
                },
                $unset: { pendingPostLoginTarget: 1 },
            }
        );
    }
}
