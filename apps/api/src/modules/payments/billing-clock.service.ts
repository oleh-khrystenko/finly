import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { PAYMENT_RECORD_STATUS, SUBSCRIPTION_STATUS } from '@finly/types';

import { User, UserDocument } from '../users/schemas/user.schema';
import {
    PaymentRecord,
    PaymentRecordDocument,
} from './schemas/payment-record.schema';
import { PaymentsService } from './payments.service';

/**
 * PENDING claim-запис, молодший за цей поріг, ще може бути в роботі синхронного
 * списання (живий творець утримує per-user лок). Звіряємо лише старші — це
 * завислі (нетермінальний результат або крах після списання).
 */
const PENDING_RECONCILE_AGE_MS = 5 * 60 * 1000;

/**
 * Sprint 22 — billing-clock: серце self-managed білінгу. monobank не має
 * рекуренту, тож продовження ініціює наш погодинний cron, читаючи дату
 * наступного списання з бази (єдине джерело правди). Пропущений запуск
 * самолікується наступним проходом — правда лежить у базі. Кожен крок ізольовано
 * (catch на per-item рівні в `PaymentsService`); top-level find захищає `step`.
 */
@Injectable()
export class BillingClockService {
    private readonly logger = new Logger(BillingClockService.name);

    constructor(
        @InjectModel(User.name)
        private readonly userModel: Model<UserDocument>,

        @InjectModel(PaymentRecord.name)
        private readonly paymentRecordModel: Model<PaymentRecordDocument>,

        private readonly paymentsService: PaymentsService
    ) {}

    @Cron(CronExpression.EVERY_HOUR)
    async runBillingClock(): Promise<void> {
        // Спершу доводимо завислі спроби (звірка статусом), щоб не списати поверх
        // незакритого продовження; далі нові продовження і повтори прострочки.
        await this.step('reconcilePendingRenewals', () =>
            this.reconcilePendingRenewals()
        );
        await this.step('chargeDueRenewals', () => this.chargeDueRenewals());
        await this.step('retryDunning', () => this.retryDunning());
    }

    private async step(label: string, fn: () => Promise<void>): Promise<void> {
        try {
            await fn();
        } catch (error) {
            this.logger.error(
                `Billing clock step ${label} failed, continuing`,
                error instanceof Error ? error.stack : String(error)
            );
        }
    }

    /** ACTIVE підписки з насталою датою списання — продовжуємо за токеном. */
    private async chargeDueRenewals(): Promise<void> {
        const now = new Date();
        const due = await this.userModel
            .find(
                {
                    'billing.hasActiveSubscription': true,
                    'billing.subscriptionStatus': SUBSCRIPTION_STATUS.ACTIVE,
                    'billing.cancelAtPeriodEnd': false,
                    'billing.nextChargeAt': { $ne: null, $lte: now },
                },
                { _id: 1 }
            )
            .lean();
        if (due.length === 0) return;
        this.logger.log(`Charging ${due.length} due subscription(s)`);
        for (const user of due) {
            await this.chargeOne(user._id.toString());
        }
    }

    /** PAST_DUE підписки з насталим часом повтору — повторна спроба списання. */
    private async retryDunning(): Promise<void> {
        const now = new Date();
        const due = await this.userModel
            .find(
                {
                    'billing.hasActiveSubscription': true,
                    'billing.subscriptionStatus': SUBSCRIPTION_STATUS.PAST_DUE,
                    'billing.nextRetryAt': { $ne: null, $lte: now },
                },
                { _id: 1 }
            )
            .lean();
        if (due.length === 0) return;
        this.logger.log(`Retrying ${due.length} past-due subscription(s)`);
        for (const user of due) {
            await this.chargeOne(user._id.toString());
        }
    }

    /** Завислі PENDING claim-записи з invoiceId — доводимо звіркою статусу. */
    private async reconcilePendingRenewals(): Promise<void> {
        const cutoff = new Date(Date.now() - PENDING_RECONCILE_AGE_MS);
        const stuck = await this.paymentRecordModel
            .find(
                {
                    status: PAYMENT_RECORD_STATUS.PENDING,
                    providerTransactionId: { $ne: null },
                    createdAt: { $lt: cutoff },
                },
                { userId: 1, orderReference: 1 }
            )
            .lean();
        if (stuck.length === 0) return;
        this.logger.log(`Reconciling ${stuck.length} pending charge(s)`);
        for (const record of stuck) {
            try {
                await this.paymentsService.finalizePendingRenewal(
                    record.userId.toString(),
                    record.orderReference
                );
            } catch (error) {
                this.logger.error(
                    `Failed to reconcile pending ${record.orderReference}`,
                    error instanceof Error ? error.stack : String(error)
                );
            }
        }
    }

    private async chargeOne(userId: string): Promise<void> {
        try {
            await this.paymentsService.chargeDueSubscription(userId);
        } catch (error) {
            this.logger.error(
                `Billing clock charge failed for user ${userId}`,
                error instanceof Error ? error.stack : String(error)
            );
        }
    }
}
