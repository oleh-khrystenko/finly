import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { PAYMENT_RECORD_STATUS, SUBSCRIPTION_STATUS } from '@finly/types';

import {
    BillingProfile,
    BillingProfileDocument,
} from './schemas/billing-profile.schema';
import {
    PaymentRecord,
    PaymentRecordDocument,
} from './schemas/payment-record.schema';
import { BillingProfileService } from './billing-profile.service';

/**
 * PENDING claim-запис, молодший за цей поріг, ще може бути в роботі синхронного
 * списання (живий творець утримує per-user лок). Звіряємо лише старші — завислі
 * (нетермінальний результат або крах після списання).
 */
const PENDING_RECONCILE_AGE_MS = 5 * 60 * 1000;

/**
 * Sprint 27 — billing-clock на білінг-профілях. monobank не має рекуренту, тож
 * місячне продовження ініціює наш погодинний cron, читаючи `nextChargeAt` з
 * профілю (єдине джерело правди). Пропущений запуск самолікується наступним
 * проходом. Кожен крок ізольовано (catch на per-item рівні у сервісі).
 */
@Injectable()
export class BillingClockService {
    private readonly logger = new Logger(BillingClockService.name);

    constructor(
        @InjectModel(BillingProfile.name)
        private readonly profileModel: Model<BillingProfileDocument>,
        @InjectModel(PaymentRecord.name)
        private readonly paymentRecordModel: Model<PaymentRecordDocument>,
        private readonly billing: BillingProfileService
    ) {}

    @Cron(CronExpression.EVERY_HOUR)
    async runBillingClock(): Promise<void> {
        await this.step('reconcilePending', () => this.reconcilePending());
        await this.step('chargeDueCycles', () => this.chargeDueCycles());
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

    /** ACTIVE профілі з насталою датою списання — продовжуємо цикл за токеном. */
    private async chargeDueCycles(): Promise<void> {
        const now = new Date();
        const due = await this.profileModel
            .find(
                {
                    status: SUBSCRIPTION_STATUS.ACTIVE,
                    cancelAtPeriodEnd: false,
                    nextChargeAt: { $ne: null, $lte: now },
                },
                { userId: 1 }
            )
            .lean();
        if (due.length === 0) return;
        this.logger.log(`Charging ${due.length} due profile(s)`);
        for (const p of due) {
            await this.chargeOne(p.userId.toString());
        }
    }

    /** PAST_DUE профілі з насталим часом повтору — повторна спроба списання. */
    private async retryDunning(): Promise<void> {
        const now = new Date();
        const due = await this.profileModel
            .find(
                {
                    status: SUBSCRIPTION_STATUS.PAST_DUE,
                    nextRetryAt: { $ne: null, $lte: now },
                },
                { userId: 1 }
            )
            .lean();
        if (due.length === 0) return;
        this.logger.log(`Retrying ${due.length} past-due profile(s)`);
        for (const p of due) {
            await this.chargeOne(p.userId.toString());
        }
    }

    /**
     * Завислі PENDING claim-записи — доводимо до фіналу. З invoiceId —
     * звіркою статусу у провайдера. БЕЗ invoiceId (крах процесу між claim-ом
     * і збереженням invoiceId, і вебхук так і не прийшов — інвойс,
     * найімовірніше, не був створений) авто-розвʼязки немає:
     * `resolveClaimEvent` ставить ops-прапор `needsManualReview`. Фільтрувати
     * такі записи геть не можна — вони були б вічно невидимими і мовчки
     * блокували б усі платні мутації платника (`assertNoUnsettledCharge`)
     * без жодного сигналу.
     */
    private async reconcilePending(): Promise<void> {
        const cutoff = new Date(Date.now() - PENDING_RECONCILE_AGE_MS);
        const stuck = await this.paymentRecordModel
            .find(
                {
                    status: PAYMENT_RECORD_STATUS.PENDING,
                    createdAt: { $lt: cutoff },
                },
                { userId: 1, orderReference: 1 }
            )
            .lean();
        if (stuck.length === 0) return;
        this.logger.log(`Reconciling ${stuck.length} pending charge(s)`);
        for (const record of stuck) {
            try {
                await this.billing.finalizePending(
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
            await this.billing.chargeDueCycle(userId);
        } catch (error) {
            this.logger.error(
                `Billing clock charge failed for user ${userId}`,
                error instanceof Error ? error.stack : String(error)
            );
        }
    }
}
