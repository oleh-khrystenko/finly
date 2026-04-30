import {
    BadRequestException,
    ConflictException,
    Inject,
    Injectable,
    Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
    BILLING_EVENT_TYPE,
    EXECUTION_ACTION,
    EXECUTION_TRANSACTION_TYPE,
    PAYMENT_TYPE,
    RESPONSE_CODE,
    SUBSCRIPTION_STATUS,
    type BillingWebhookEvent,
    type CreateCheckoutSession,
} from '@neatslip/types';
import { ENV } from '../../config/env';
import {
    PAYMENT_PROVIDER,
    IPaymentProvider,
} from './interfaces/payment-provider.interface';
import { CatalogService } from './catalog.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
    ProcessedWebhookEvent,
    ProcessedWebhookEventDocument,
} from './schemas/processed-webhook-event.schema';
import {
    OrphanedProviderCustomer,
    OrphanedProviderCustomerDocument,
} from './schemas/orphaned-provider-customer.schema';
import { UsersService } from '../users/users.service';

/** Max time for any single MongoDB operation in the webhook path (ms). */
const WEBHOOK_MONGO_TIMEOUT_MS = 10_000;

@Injectable()
export class PaymentsService {
    private readonly logger = new Logger(PaymentsService.name);

    constructor(
        @Inject(PAYMENT_PROVIDER)
        private readonly paymentProvider: IPaymentProvider,

        @InjectModel(User.name)
        private readonly userModel: Model<UserDocument>,

        @InjectModel(ProcessedWebhookEvent.name)
        private readonly webhookEventModel: Model<ProcessedWebhookEventDocument>,

        @InjectModel(OrphanedProviderCustomer.name)
        private readonly orphanModel: Model<OrphanedProviderCustomerDocument>,

        private readonly usersService: UsersService,

        private readonly catalogService: CatalogService
    ) {}

    async createCheckoutSession(
        userId: string,
        dto: CreateCheckoutSession
    ): Promise<{ checkoutUrl: string }> {
        const { paymentType, planCode, packCode, returnPath } = dto;

        // Feature flag check
        if (
            paymentType === PAYMENT_TYPE.SUBSCRIPTION &&
            !ENV.PAYMENTS_SUBSCRIPTION_ENABLED
        ) {
            throw new BadRequestException({
                code: RESPONSE_CODE.PAYMENT_TYPE_DISABLED,
                message: 'Subscription payments are disabled',
            });
        }
        if (
            paymentType === PAYMENT_TYPE.ONE_OFF &&
            !ENV.PAYMENTS_ONE_OFF_ENABLED
        ) {
            throw new BadRequestException({
                code: RESPONSE_CODE.PAYMENT_TYPE_DISABLED,
                message: 'One-off payments are disabled',
            });
        }

        const user = await this.userModel.findById(userId).lean();
        if (!user) {
            throw new BadRequestException('User not found');
        }

        const returnQuery = returnPath
            ? `?returnPath=${encodeURIComponent(returnPath)}`
            : '';
        const successUrl = `${ENV.WEB_URL}/billing/success${returnQuery}`;
        const cancelUrl = `${ENV.WEB_URL}/billing/cancel${returnQuery}`;

        // Subscription-specific validation
        if (paymentType === PAYMENT_TYPE.SUBSCRIPTION) {
            if (user.billing?.hasActiveSubscription) {
                throw new ConflictException({
                    code: RESPONSE_CODE.ALREADY_SUBSCRIBED,
                    message: 'Already subscribed',
                });
            }
            const planEntry = await this.catalogService.getSubscriptionPlan(
                planCode!
            );
            if (!planEntry) {
                throw new BadRequestException('Invalid planCode');
            }
            const result = await this.paymentProvider.createCheckoutSession({
                userId,
                userEmail: user.email,
                providerCustomerId:
                    user.billing?.providerCustomerId ?? undefined,
                paymentType,
                planCode: planCode!,
                priceId: planEntry.priceId,
                executions: planEntry.executions,
                successUrl,
                cancelUrl,
            });
            return { checkoutUrl: result.checkoutUrl };
        }

        // One-off payment
        const pack = packCode
            ? await this.catalogService.getExecutionPack(packCode)
            : undefined;
        if (!pack) {
            throw new BadRequestException('Invalid packCode');
        }
        const result = await this.paymentProvider.createCheckoutSession({
            userId,
            userEmail: user.email,
            providerCustomerId: user.billing?.providerCustomerId ?? undefined,
            paymentType,
            planCode: packCode!,
            priceId: pack.priceId,
            executions: pack.executions,
            successUrl,
            cancelUrl,
        });
        return { checkoutUrl: result.checkoutUrl };
    }

    async createPortalSession(userId: string): Promise<{ portalUrl: string }> {
        const user = await this.userModel.findById(userId).lean();
        if (!user) {
            throw new BadRequestException('User not found');
        }

        if (!user.billing?.providerCustomerId) {
            throw new BadRequestException({
                code: RESPONSE_CODE.NO_BILLING_ACCOUNT,
                message: 'No billing account',
            });
        }

        const returnUrl = `${ENV.WEB_URL}/billing`;
        const result = await this.paymentProvider.createPortalSession(
            user.billing.providerCustomerId,
            returnUrl
        );

        return { portalUrl: result.portalUrl };
    }

    async resetBilling(userId: string): Promise<void> {
        const user = await this.userModel.findById(userId).lean();
        if (!user) {
            throw new BadRequestException('User not found');
        }

        const providerCustomerId = user.billing?.providerCustomerId;
        const previousBalance = user.executions.balance;

        // 1. Record reset transaction before clearing (if user had balance)
        if (previousBalance > 0) {
            await this.usersService.recordTransaction({
                userId,
                type: EXECUTION_TRANSACTION_TYPE.DEBIT,
                action: EXECUTION_ACTION.BILLING_RESET,
                amount: previousBalance,
                balanceAfter: 0,
            });
        }

        // 2. Reset DB — this prevents in-flight webhooks from
        //    re-creating billing (they'll hit billing=null and the
        //    out-of-order guard will skip them as orphan events).
        await this.userModel.findByIdAndUpdate(userId, {
            $set: {
                billing: null,
                executions: { balance: 0, freeReportUsed: false },
            },
        });
        await this.webhookEventModel.deleteMany({ userId });
        await this.usersService.clearTransactions(userId);

        // 3. Clean up Stripe — on failure, persist for retry by cron.
        if (providerCustomerId) {
            try {
                await this.paymentProvider.deleteCustomerData(
                    providerCustomerId
                );
            } catch (error) {
                this.logger.error(
                    `Failed to delete Stripe customer ${providerCustomerId} during reset, queued for retry`,
                    error instanceof Error ? error.stack : String(error)
                );
                await this.enqueueOrphanedCustomer(
                    'stripe',
                    providerCustomerId,
                    'billing_reset'
                );
            }
        }

        this.logger.log(`Billing reset for user ${userId}`);
    }

    async handleWebhook(
        provider: string,
        rawBody: Buffer,
        signatureHeader: string
    ): Promise<void> {
        // 1. Parse and verify webhook payload
        const event = await this.paymentProvider.handleWebhookPayload(
            rawBody,
            signatureHeader
        );
        if (!event) {
            return;
        }

        // 2. Resolve userId
        const userId = await this.resolveUserId(event);
        if (!userId) {
            this.logger.warn(
                `Cannot resolve userId for webhook event ${event.providerEventId}`
            );
            return;
        }

        // 3. Two-phase idempotency: insert as 'pending', mark 'applied' after success
        const insertResult = await this.insertWebhookEvent(
            provider,
            event,
            userId
        );
        if (insertResult === 'applied') {
            return;
        }

        // 4. Process event — rollback idempotency record on failure
        try {
            await this.processWebhookEvent(event, userId);
        } catch (error) {
            await this.rollbackPendingWebhookEvent(
                provider,
                event.providerEventId
            );
            throw error;
        }

        // 5. Mark as applied — non-fatal on failure (event was already processed;
        //    returning 200 prevents Stripe from retrying and double-counting).
        try {
            await this.markWebhookEventApplied(provider, event.providerEventId);
        } catch (error) {
            this.logger.error(
                `Failed to mark webhook event ${event.providerEventId} as applied ` +
                    `(event was processed successfully)`,
                error instanceof Error ? error.stack : String(error)
            );
        }
    }

    private async processWebhookEvent(
        event: BillingWebhookEvent,
        userId: string
    ): Promise<void> {
        if (event.type === BILLING_EVENT_TYPE.ONE_OFF_PAYMENT_COMPLETED) {
            // One-off: independent events, no ordering concern
            const user = await this.userModel
                .findById(userId)
                .maxTimeMS(WEBHOOK_MONGO_TIMEOUT_MS)
                .lean();
            if (!user) {
                this.logger.warn(
                    `User ${userId} not found for webhook event ${event.providerEventId}`
                );
                return;
            }
            await this.applyOneOffPayment(userId, event);
        } else {
            // Subscription: billing + execution adjustment in one atomic query
            const applied = await this.processSubscriptionEvent(event, userId);
            if (!applied) return;
        }

        this.logger.log(
            `Processed ${event.type} for user ${userId} (event: ${event.providerEventId})`
        );
    }

    /**
     * Processes subscription events atomically: billing state and execution
     * adjustment are combined in a single MongoDB aggregation pipeline update.
     *
     * The execution adjustment uses a $cond guard on lastProviderEventAt ($lt,
     * not $lte) so that replayed events (same occurredAt) do NOT double-count.
     * The billing $set itself is idempotent (same values re-applied on replay).
     */
    private async processSubscriptionEvent(
        event: BillingWebhookEvent,
        userId: string
    ): Promise<boolean> {
        const priceToPlan = await this.catalogService.getPriceToPlanMap();
        const billingFields = this.buildBillingUpdate(event, priceToPlan);
        const executionAdjustment =
            await this.resolveExecutionAdjustment(event);

        // Phase 1: dot-notation update for existing billing object
        const dotNotation: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(billingFields)) {
            dotNotation[`billing.${key}`] = value;
        }

        const phase1Update = this.buildAtomicUpdatePipeline(
            { $set: dotNotation },
            executionAdjustment,
            event.occurredAt
        );

        const updated = await this.userModel.findOneAndUpdate(
            {
                _id: userId,
                billing: { $ne: null },
                $or: [
                    { 'billing.lastProviderEventAt': null },
                    {
                        'billing.lastProviderEventAt': {
                            $lte: event.occurredAt,
                        },
                    },
                ],
            },
            phase1Update,
            { new: true, maxTimeMS: WEBHOOK_MONGO_TIMEOUT_MS }
        );

        let appliedUser = updated;

        if (!appliedUser) {
            // Phase 2: billing is null (first billing event) — set full subdocument.
            // The { billing: null } filter guarantees exactly-once, so no $cond
            // guard is needed — but buildAtomicUpdatePipeline still adds it for
            // consistency (it evaluates to true when lastProviderEventAt is null).
            const phase2Update = this.buildAtomicUpdatePipeline(
                { $set: { billing: billingFields } },
                executionAdjustment,
                event.occurredAt
            );

            appliedUser = await this.userModel.findOneAndUpdate(
                { _id: userId, billing: null },
                phase2Update,
                { new: true, maxTimeMS: WEBHOOK_MONGO_TIMEOUT_MS }
            );

            if (!appliedUser) {
                this.logger.debug(
                    `Skipping stale/orphan event ${event.providerEventId} for user ${userId}`
                );
                return false;
            }
        }

        if (executionAdjustment !== 0) {
            const txAction =
                event.type === BILLING_EVENT_TYPE.CHECKOUT_COMPLETED
                    ? EXECUTION_ACTION.SUBSCRIPTION_ACTIVATION
                    : EXECUTION_ACTION.PLAN_CHANGE;
            const txType =
                executionAdjustment > 0
                    ? EXECUTION_TRANSACTION_TYPE.CREDIT
                    : EXECUTION_TRANSACTION_TYPE.DEBIT;

            // Use the post-update document returned by findOneAndUpdate ({ new: true }).
            // This is the same atomic operation that applied the adjustment, so
            // balanceAfter reflects exactly this event — no race window with other
            // concurrent webhooks mutating balance between update and read.
            await this.usersService.recordTransaction({
                userId,
                type: txType,
                action: txAction,
                amount: Math.abs(executionAdjustment),
                balanceAfter: appliedUser.executions.balance,
            });

            const direction = executionAdjustment > 0 ? 'Added' : 'Deducted';
            const reason =
                event.type === BILLING_EVENT_TYPE.CHECKOUT_COMPLETED
                    ? 'subscription checkout'
                    : 'plan change proration';
            this.logger.log(
                `${direction} ${Math.abs(executionAdjustment)} executions for ${reason} ` +
                    `(user: ${userId}, event: ${event.providerEventId})`
            );
        }

        return true;
    }

    private async resolveUserId(
        event: BillingWebhookEvent
    ): Promise<string | null> {
        if (event.userId?.length > 0) {
            return event.userId;
        }

        // For subscription events, look up user by providerSubscriptionId
        const subscriptionId =
            typeof event.raw.id === 'string' ? event.raw.id : undefined;

        if (!subscriptionId) {
            return null;
        }

        const user = await this.userModel
            .findOne({ 'billing.providerSubscriptionId': subscriptionId })
            .maxTimeMS(WEBHOOK_MONGO_TIMEOUT_MS)
            .lean();

        return user?._id?.toString() ?? null;
    }

    private async insertWebhookEvent(
        provider: string,
        event: BillingWebhookEvent,
        userId: string
    ): Promise<'new' | 'retry' | 'applied'> {
        try {
            await this.webhookEventModel.create({
                provider,
                providerEventId: event.providerEventId,
                receivedAt: new Date(),
                occurredAt: event.occurredAt,
                type: event.type,
                userId,
                packCode: event.packCode ?? null,
                status: 'pending',
            });
            return 'new';
        } catch (error: unknown) {
            // Duplicate key error (MongoDB code 11000)
            if (
                error instanceof Error &&
                'code' in error &&
                (error as { code: number }).code === 11000
            ) {
                const existing = await this.webhookEventModel
                    .findOne({
                        provider,
                        providerEventId: event.providerEventId,
                    })
                    .lean();

                if (existing?.status === 'applied') {
                    this.logger.debug(
                        `Duplicate webhook event ${event.providerEventId}, already applied`
                    );
                    return 'applied';
                }

                this.logger.warn(
                    `Retrying pending webhook event ${event.providerEventId}`
                );
                return 'retry';
            }
            throw error;
        }
    }

    private async markWebhookEventApplied(
        provider: string,
        providerEventId: string
    ): Promise<void> {
        await this.webhookEventModel.updateOne(
            { provider, providerEventId },
            { $set: { status: 'applied' } },
            { maxTimeMS: WEBHOOK_MONGO_TIMEOUT_MS }
        );
    }

    private async rollbackPendingWebhookEvent(
        provider: string,
        providerEventId: string
    ): Promise<void> {
        try {
            await this.webhookEventModel.deleteOne(
                {
                    provider,
                    providerEventId,
                    status: 'pending',
                },
                { maxTimeMS: WEBHOOK_MONGO_TIMEOUT_MS }
            );
        } catch (deleteError) {
            this.logger.error(
                `Failed to rollback pending webhook event ${providerEventId}`,
                deleteError instanceof Error
                    ? deleteError.stack
                    : String(deleteError)
            );
        }
    }

    private async applyOneOffPayment(
        userId: string,
        event: BillingWebhookEvent
    ): Promise<void> {
        const executionsAmount = event.executionsAmount ?? 0;
        if (!Number.isFinite(executionsAmount) || executionsAmount <= 0) {
            this.logger.warn(
                `ONE_OFF_PAYMENT_COMPLETED event ${event.providerEventId} has no executionsAmount`
            );
            return;
        }
        await this.usersService.addExecutions(
            userId,
            executionsAmount,
            EXECUTION_ACTION.PACK_PURCHASE
        );
        this.logger.log(
            `Added ${executionsAmount} executions to user ${userId} (event: ${event.providerEventId})`
        );
    }

    private async resolveExecutionAdjustment(
        event: BillingWebhookEvent
    ): Promise<number> {
        if (event.type === BILLING_EVENT_TYPE.CHECKOUT_COMPLETED) {
            const amount = event.executionsAmount ?? 0;
            if (!Number.isFinite(amount) || amount <= 0) {
                this.logger.warn(
                    `CHECKOUT_COMPLETED event ${event.providerEventId} has no executionsAmount`
                );
                return 0;
            }
            return amount;
        }

        if (event.type === BILLING_EVENT_TYPE.SUBSCRIPTION_UPDATED) {
            return this.calculatePlanChangeAdjustment(event);
        }

        return 0;
    }

    private async calculatePlanChangeAdjustment(
        event: BillingWebhookEvent
    ): Promise<number> {
        if (!event.previousPriceId) return 0;

        const items = event.raw.items as
            | { data?: Array<{ price?: { id?: string } }> }
            | undefined;
        const currentPriceId =
            typeof items?.data?.[0]?.price?.id === 'string'
                ? items.data[0].price.id
                : null;

        if (!currentPriceId || currentPriceId === event.previousPriceId)
            return 0;

        const priceToExecutions =
            await this.catalogService.getPriceToExecutionsMap();
        const oldExecutions = priceToExecutions[event.previousPriceId];
        const newExecutions = priceToExecutions[currentPriceId];

        if (oldExecutions == null || newExecutions == null) {
            this.logger.warn(
                `Cannot calculate prorated executions: ` +
                    `old price ${event.previousPriceId} (${oldExecutions ?? 'unknown'}), ` +
                    `new price ${currentPriceId} (${newExecutions ?? 'unknown'}) ` +
                    `(event: ${event.providerEventId})`
            );
            return 0;
        }

        const delta = newExecutions - oldExecutions;
        if (delta === 0) return 0;

        const remainingRatio = this.calculateRemainingPeriodRatio(event);
        const adjustment = Math.floor(Math.abs(delta) * remainingRatio);
        if (adjustment <= 0) return 0;

        return delta > 0 ? adjustment : -adjustment;
    }

    /**
     * Wraps a billing $set stage in an aggregation pipeline that atomically
     * adjusts executions.balance. The adjustment is guarded by a $cond on
     * lastProviderEventAt ($lt, strict) so replayed events (same occurredAt)
     * do NOT double-count. When executionAdjustment is 0, returns the plain
     * billingStage (no pipeline overhead).
     */
    private buildAtomicUpdatePipeline(
        billingStage: Record<string, unknown>,
        executionAdjustment: number,
        occurredAt: Date
    ): Record<string, unknown>[] | Record<string, unknown> {
        if (executionAdjustment === 0) {
            return billingStage;
        }

        return [
            // Stage 1: adjust executions BEFORE lastProviderEventAt is overwritten.
            // Uses $lt (strict) so that replayed events (equal timestamp) are no-ops.
            {
                $set: {
                    'executions.balance': {
                        $cond: {
                            if: {
                                $or: [
                                    {
                                        $eq: [
                                            '$billing.lastProviderEventAt',
                                            null,
                                        ],
                                    },
                                    {
                                        $lt: [
                                            '$billing.lastProviderEventAt',
                                            occurredAt,
                                        ],
                                    },
                                ],
                            },
                            then: {
                                $max: [
                                    0,
                                    {
                                        $add: [
                                            '$executions.balance',
                                            executionAdjustment,
                                        ],
                                    },
                                ],
                            },
                            else: '$executions.balance',
                        },
                    },
                },
            },
            // Stage 2: update billing fields (including lastProviderEventAt)
            billingStage,
        ];
    }

    private calculateRemainingPeriodRatio(event: BillingWebhookEvent): number {
        const periodStart = event.currentPeriodStart;
        const periodEnd = event.currentPeriodEnd;

        if (!periodStart || !periodEnd) {
            this.logger.warn(
                `Missing period boundaries for proration (event: ${event.providerEventId}), ` +
                    `defaulting to full period`
            );
            return 1;
        }

        const now = event.occurredAt.getTime();
        const start = periodStart.getTime();
        const end = periodEnd.getTime();
        const totalPeriod = end - start;

        if (totalPeriod <= 0) return 0;

        const remaining = end - now;
        return Math.max(0, Math.min(1, remaining / totalPeriod));
    }

    private buildBillingUpdate(
        event: BillingWebhookEvent,
        priceToPlan: Record<string, string>
    ): Record<string, unknown> {
        const status = event.subscriptionStatus ?? SUBSCRIPTION_STATUS.UNKNOWN;
        const hasActive =
            status === SUBSCRIPTION_STATUS.ACTIVE ||
            status === SUBSCRIPTION_STATUS.TRIALING;

        const fields: Record<string, unknown> = {
            subscriptionStatus: status,
            hasActiveSubscription: hasActive,
            lastProviderEventAt: event.occurredAt,
            cancelAtPeriodEnd: event.cancelAtPeriodEnd ?? false,
        };

        if (event.currentPeriodEnd) {
            fields['currentPeriodEnd'] = event.currentPeriodEnd;
        }

        const str = (v: unknown): string | null =>
            typeof v === 'string' ? v : null;

        switch (event.type) {
            case BILLING_EVENT_TYPE.CHECKOUT_COMPLETED: {
                const { raw } = event;
                const metadata =
                    raw.metadata != null && typeof raw.metadata === 'object'
                        ? (raw.metadata as Record<string, unknown>)
                        : undefined;
                fields['provider'] = 'stripe';
                fields['providerCustomerId'] = str(raw.customer);
                fields['providerSubscriptionId'] = str(raw.subscription);
                fields['planCode'] = str(metadata?.planCode) ?? null;
                fields['currency'] = str(raw.currency);
                fields['providerSubscriptionStatus'] = str(raw.status);
                break;
            }

            case BILLING_EVENT_TYPE.SUBSCRIPTION_UPDATED: {
                fields['providerSubscriptionStatus'] = str(event.raw.status);

                // Detect plan switch via reverse priceId → planCode lookup
                const items = event.raw.items as
                    | { data?: Array<{ price?: { id?: string } }> }
                    | undefined;
                const priceId = str(items?.data?.[0]?.price?.id ?? null);
                if (priceId) {
                    const newPlanCode = priceToPlan[priceId];
                    if (newPlanCode) {
                        fields['planCode'] = newPlanCode;
                    }
                }

                // Scheduled plan change (downgrade deferred to period end)
                fields['scheduledPlanCode'] = event.scheduledPlanCode ?? null;
                fields['scheduledChangeDate'] =
                    event.scheduledChangeDate ?? null;
                break;
            }

            case BILLING_EVENT_TYPE.SUBSCRIPTION_DELETED: {
                fields['subscriptionStatus'] = SUBSCRIPTION_STATUS.CANCELED;
                fields['hasActiveSubscription'] = false;
                fields['providerSubscriptionStatus'] = 'canceled';
                break;
            }
        }

        return fields;
    }

    async enqueueOrphanedCustomer(
        provider: string,
        providerCustomerId: string,
        reason: string
    ): Promise<void> {
        try {
            await this.orphanModel.create({
                provider,
                providerCustomerId,
                reason,
                failedAt: new Date(),
                attempts: 0,
                lastAttemptAt: null,
            });
        } catch (error: unknown) {
            // Duplicate — already queued, nothing to do
            if (
                error instanceof Error &&
                'code' in error &&
                (error as { code: number }).code === 11000
            ) {
                return;
            }
            throw error;
        }
    }
}
