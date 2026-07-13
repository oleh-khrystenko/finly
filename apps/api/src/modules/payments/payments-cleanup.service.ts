import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Model } from 'mongoose';
import { SUBSCRIPTION_STATUS } from '@finly/types';

import {
    ProcessedWebhookEvent,
    ProcessedWebhookEventDocument,
} from './schemas/processed-webhook-event.schema';
import {
    BillingProfile,
    BillingProfileDocument,
    BillingProfileLean,
} from './schemas/billing-profile.schema';
import { ReconciliationService } from '../businesses/reconciliation.service';

/**
 * `pending` webhook-подія, старша за цей поріг, — crash-orphan. Видаляємо, щоб
 * наступна доставка monobank створила свіжий запис і застосувала ефект.
 */
const STALE_PENDING_EVENT_MS = 15 * 60 * 1000;

/**
 * Sprint 27 — cron-обслуговування білінг-профілів: згасання скасованих у кінці
 * періоду, добивання відкладених реконсиляцій, чистка crash-orphan вебхуків.
 */
@Injectable()
export class PaymentsCleanupService {
    private readonly logger = new Logger(PaymentsCleanupService.name);

    constructor(
        @InjectModel(ProcessedWebhookEvent.name)
        private readonly webhookEventModel: Model<ProcessedWebhookEventDocument>,
        @InjectModel(BillingProfile.name)
        private readonly profileModel: Model<BillingProfileDocument>,
        private readonly reconciliation: ReconciliationService
    ) {}

    // Щогодини (такт billing-clock), не раз на добу: добовий крок лишав би
    // скасованому профілю до ~24 год неоплаченого доступу після межі періоду
    // і на той самий час блокував повторну купівлю (startCheckout на ще-ACTIVE
    // профілі → BILLING_ALREADY_ACTIVE; сам checkout додатково має інлайн-гасіння
    // такого профілю, але бренд-фічі гасить саме цей прохід).
    @Cron(CronExpression.EVERY_HOUR)
    async runHourlyExpiry(): Promise<void> {
        await this.step('expireCanceledProfiles', () =>
            this.expireCanceledProfiles()
        );
    }

    @Cron(CronExpression.EVERY_DAY_AT_4AM)
    async runDailyCleanup(): Promise<void> {
        await this.step('retryPendingReconciles', () =>
            this.retryPendingReconciles()
        );
    }

    @Cron(CronExpression.EVERY_10_MINUTES)
    async runStalePendingSweep(): Promise<void> {
        await this.step('sweepStalePendingEvents', () =>
            this.sweepStalePendingEvents()
        );
    }

    private async step(label: string, fn: () => Promise<void>): Promise<void> {
        try {
            await fn();
        } catch (error) {
            this.logger.error(
                `Daily cleanup step ${label} failed, continuing`,
                error instanceof Error ? error.stack : String(error)
            );
        }
    }

    /**
     * Бізнеси профілю для реконсиляції: прикріплені (обидва склади) плюс
     * durable-список detached (`pendingReconcileBusinessIds`) — відкріплені
     * флипом, чия реконсиляція не завершилась; у складах їх уже немає.
     */
    private attachedBusinessIds(profile: BillingProfileLean): string[] {
        const ids = [
            ...profile.brand.attachedBusinessIds,
            ...profile.documents.attachedBusinessIds,
            ...(profile.pendingReconcileBusinessIds ?? []),
        ].map((id) => id.toString());
        return [...new Set(ids)];
    }

    /**
     * Реконсилює прикріплення профілів. Повертає лише ті, чий прохід був ПОВНИМ
     * (без збоїв і без урізаного батч-лімітом slug-rent): маркер можна знімати
     * тільки їм, решта мусить дочекатись наступного проходу.
     */
    private async reconcileProfiles(
        profiles: BillingProfileLean[]
    ): Promise<BillingProfileLean[]> {
        const completed: BillingProfileLean[] = [];
        for (const profile of profiles) {
            const ids = this.attachedBusinessIds(profile);
            if (ids.length === 0) {
                completed.push(profile);
                continue;
            }
            try {
                const complete =
                    await this.reconciliation.reconcileBusinesses(ids);
                if (complete) completed.push(profile);
            } catch (error) {
                this.logger.error(
                    `Reconcile on cleanup failed for profile ${profile.userId.toString()}`,
                    error instanceof Error ? error.stack : String(error)
                );
            }
        }
        return completed;
    }

    /**
     * Скасований-в-кінці-періоду профіль просто перестав поновлюватись
     * (billing-clock його не чіпає, `nextChargeAt` null). Коли межа періоду
     * минула — переводимо у CANCELED і реконсилюємо прикріплені бізнеси (гаснуть
     * бренд-фічі). Стемп `reconcileRequiredAt` тримає durable-retry.
     */
    private async expireCanceledProfiles(): Promise<void> {
        const now = new Date();
        const filter = {
            cancelAtPeriodEnd: true,
            status: { $ne: SUBSCRIPTION_STATUS.CANCELED },
            currentPeriodEnd: { $lt: now },
        };
        // Стемп фіксується ДО читання (як `notAfter` у retryPendingReconciles):
        // флип під user-локом, що впишеться між find і clear, поставить власний
        // НОВІШИЙ маркер, і $lte-гейт clearReconcileMarkers його не зачепить.
        const stampedAt = new Date();
        const profiles = await this.profileModel.find(filter).lean();
        if (profiles.length === 0) return;
        await this.profileModel.updateMany(filter, {
            $set: { status: SUBSCRIPTION_STATUS.CANCELED },
            // $max, НЕ $set: stampedAt зафіксовано до find, і безумовний запис
            // перезаписав би НОВІШИЙ конкурентний стемп (attach/detach під
            // user-локом у вікні find→updateMany) старішою датою. Тоді clear
            // того тригера ($lte його стемпа) зняв би і наш маркер, і при
            // збої проходу нижче durable-retry зник би назавжди (бізнес
            // лишився б з brandedAt без жодного тригера). $max тримає маркер
            // монотонним — він лише росте; null/відсутній перекривається
            // (BSON: Null < Date).
            $max: { reconcileRequiredAt: stampedAt },
        });
        this.logger.log(`Expired ${profiles.length} canceled profile(s)`);
        const completed = await this.reconcileProfiles(profiles);
        await this.clearReconcileMarkers(completed, stampedAt);
    }

    /**
     * Добиває реконсиляції, що не завершились у своєму тригері (збій, батч-ліміт
     * slug-rent). Джерело — durable-стемп `reconcileRequiredAt`.
     */
    private async retryPendingReconciles(): Promise<void> {
        // Межа фіксується ДО читання: стемп, поставлений конкурентним тригером
        // після старту проходу, мусить пережити зняття (див. clearReconcileMarkers).
        const notAfter = new Date();
        const profiles = await this.profileModel
            .find({ reconcileRequiredAt: { $ne: null } })
            .lean();
        if (profiles.length === 0) return;
        this.logger.log(`Retrying ${profiles.length} pending reconcile(s)`);
        const completed = await this.reconcileProfiles(profiles);
        await this.clearReconcileMarkers(completed, notAfter);
    }

    /**
     * Знімає маркер лише профілям з повним проходом і лише якщо маркер не
     * новіший за `notAfter` (початок проходу): свіжіший стемп означає, що після
     * нашого читання стався ще один флип, і його реконсиляція ще попереду.
     * `$lte` не матчить null (BSON type bracketing) — повторне зняття no-op.
     */
    private async clearReconcileMarkers(
        profiles: BillingProfileLean[],
        notAfter: Date
    ): Promise<void> {
        if (profiles.length === 0) return;
        const ids = profiles.map((p) => p._id);
        await this.profileModel.updateMany(
            { _id: { $in: ids }, reconcileRequiredAt: { $lte: notAfter } },
            // Durable-список detached чиститься разом з маркером; $lte-гейт
            // лишає недоторканими ID від свіжішого конкурентного стемпа.
            {
                $set: {
                    reconcileRequiredAt: null,
                    pendingReconcileBusinessIds: [],
                },
            }
        );
    }

    private async sweepStalePendingEvents(): Promise<void> {
        const cutoff = new Date(Date.now() - STALE_PENDING_EVENT_MS);
        const result = await this.webhookEventModel.deleteMany({
            status: 'pending',
            receivedAt: { $lt: cutoff },
        });
        if (result.deletedCount > 0) {
            this.logger.warn(
                `Swept ${result.deletedCount} stale pending webhook events`
            );
        }
    }
}
