import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import {
    BillingWebhookEvent,
    BILLING_EVENT_TYPE,
    PAYMENT_TYPE,
    SUBSCRIPTION_STATUS,
    type SubscriptionStatus,
} from '@finly/types';
import { ENV } from '../../../config/env';
import {
    IPaymentProvider,
    CreateCheckoutInput,
    CheckoutResult,
    PortalResult,
} from '../interfaces/payment-provider.interface';
import { CatalogService } from '../catalog.service';

@Injectable()
export class StripeService implements IPaymentProvider {
    private readonly stripe: Stripe;
    private readonly logger = new Logger(StripeService.name);

    constructor(private readonly catalogService: CatalogService) {
        this.stripe = new Stripe(ENV.STRIPE_SECRET_KEY, {
            apiVersion: '2026-02-25.clover',
        });
    }

    async createCheckoutSession(
        input: CreateCheckoutInput
    ): Promise<CheckoutResult> {
        const mode =
            input.paymentType === PAYMENT_TYPE.ONE_OFF
                ? 'payment'
                : 'subscription';

        const session = await this.stripe.checkout.sessions.create({
            mode,
            payment_method_types: ['card'],
            ...(input.providerCustomerId
                ? { customer: input.providerCustomerId }
                : { customer_email: input.userEmail }),
            line_items: [{ price: input.priceId, quantity: 1 }],
            metadata: {
                userId: input.userId,
                planCode: input.planCode,
                executions: String(input.executions ?? 0),
            },
            client_reference_id: input.userId,
            success_url: input.successUrl,
            cancel_url: input.cancelUrl,
        });

        if (!session.url) {
            throw new Error('Stripe checkout session created without URL');
        }

        return {
            checkoutUrl: session.url,
            providerSessionId: session.id,
        };
    }

    async createPortalSession(
        providerCustomerId: string,
        returnUrl: string
    ): Promise<PortalResult> {
        const session = await this.stripe.billingPortal.sessions.create({
            customer: providerCustomerId,
            return_url: returnUrl,
        });

        return { portalUrl: session.url };
    }

    async handleWebhookPayload(
        rawBody: Buffer,
        signatureHeader: string
    ): Promise<BillingWebhookEvent | null> {
        const event = this.stripe.webhooks.constructEvent(
            rawBody,
            signatureHeader,
            ENV.STRIPE_WEBHOOK_SECRET
        );

        switch (event.type) {
            case 'checkout.session.completed':
            case 'checkout.session.async_payment_succeeded':
                return this.handleCheckoutCompleted(event);
            case 'customer.subscription.updated':
                return this.handleSubscriptionEvent(
                    event,
                    BILLING_EVENT_TYPE.SUBSCRIPTION_UPDATED
                );
            case 'customer.subscription.deleted':
                return this.handleSubscriptionEvent(
                    event,
                    BILLING_EVENT_TYPE.SUBSCRIPTION_DELETED
                );
            default:
                this.logger.debug(`Ignoring Stripe event: ${event.type}`);
                return null;
        }
    }

    private async handleCheckoutCompleted(
        event: Stripe.Event
    ): Promise<BillingWebhookEvent | null> {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId =
            session.metadata?.userId || session.client_reference_id || '';

        // One-off payment (mode=payment, paid)
        if (session.mode === 'payment' && session.payment_status === 'paid') {
            const executions = parseInt(
                session.metadata?.executions ?? '0',
                10
            );
            return {
                type: BILLING_EVENT_TYPE.ONE_OFF_PAYMENT_COMPLETED,
                providerEventId: event.id,
                occurredAt: new Date(event.created * 1000),
                userId,
                executionsAmount: executions,
                packCode: session.metadata?.planCode || undefined,
                raw: this.toRaw(event.data.object),
            };
        }

        // Subscription checkout (mode=subscription)
        if (session.mode === 'subscription') {
            const executions = parseInt(
                session.metadata?.executions ?? '0',
                10
            );
            const currentPeriodEnd = await this.resolveSubscriptionPeriodEnd(
                session.subscription
            );

            return {
                type: BILLING_EVENT_TYPE.CHECKOUT_COMPLETED,
                providerEventId: event.id,
                occurredAt: new Date(event.created * 1000),
                userId,
                subscriptionStatus: SUBSCRIPTION_STATUS.ACTIVE,
                currentPeriodEnd,
                cancelAtPeriodEnd: false,
                raw: this.toRaw(event.data.object),
                executionsAmount: executions || undefined,
            };
        }

        // Unexpected mode/status — e.g. async payment not yet paid
        this.logger.debug(
            `Ignoring checkout.session.completed with mode=${session.mode} payment_status=${session.payment_status}`
        );
        return null;
    }

    private async handleSubscriptionEvent(
        event: Stripe.Event,
        type:
            | typeof BILLING_EVENT_TYPE.SUBSCRIPTION_UPDATED
            | typeof BILLING_EVENT_TYPE.SUBSCRIPTION_DELETED
    ): Promise<BillingWebhookEvent> {
        const subscription = event.data.object as Stripe.Subscription;
        const periodStart =
            subscription.items?.data?.[0]?.current_period_start ?? null;
        const periodEnd =
            subscription.items?.data?.[0]?.current_period_end ?? null;

        // Detect plan change via previous_attributes (only present when items changed)
        const previousPriceId = this.extractPreviousPriceId(
            event.data.previous_attributes as
                | Record<string, unknown>
                | undefined
        );

        // Resolve scheduled plan change (downgrade deferred to period end)
        const schedule = await this.resolveScheduledChange(subscription);

        return {
            type,
            providerEventId: event.id,
            occurredAt: new Date(event.created * 1000),
            userId: '',
            subscriptionStatus: this.mapSubscriptionStatus(subscription.status),
            currentPeriodStart: periodStart
                ? new Date(periodStart * 1000)
                : null,
            currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
            cancelAtPeriodEnd:
                subscription.cancel_at_period_end ||
                subscription.cancel_at != null,
            previousPriceId,
            scheduledPlanCode: schedule?.planCode ?? null,
            scheduledChangeDate: schedule?.changeDate ?? null,
            raw: this.toRaw(event.data.object),
        };
    }

    private extractPreviousPriceId(
        previousAttributes: Record<string, unknown> | undefined
    ): string | null {
        if (!previousAttributes) return null;

        const items = previousAttributes.items as
            | { data?: Array<{ price?: { id?: string } }> }
            | undefined;
        const priceId = items?.data?.[0]?.price?.id;
        return typeof priceId === 'string' ? priceId : null;
    }

    private async resolveSubscriptionPeriodEnd(
        subscriptionRef: string | Stripe.Subscription | null | undefined
    ): Promise<Date | null> {
        const subscriptionId =
            typeof subscriptionRef === 'string'
                ? subscriptionRef
                : subscriptionRef?.id;

        if (!subscriptionId) {
            return null;
        }

        try {
            const subscription =
                await this.stripe.subscriptions.retrieve(subscriptionId);
            const periodEnd =
                subscription.items?.data?.[0]?.current_period_end ?? null;
            return periodEnd ? new Date(periodEnd * 1000) : null;
        } catch (error) {
            this.logger.error(
                `Failed to retrieve subscription ${subscriptionId} for period end`,
                error instanceof Error ? error.stack : String(error)
            );
            return null;
        }
    }

    private async resolveScheduledChange(
        subscription: Stripe.Subscription
    ): Promise<{ planCode: string; changeDate: Date } | null> {
        const scheduleId =
            typeof subscription.schedule === 'string'
                ? subscription.schedule
                : subscription.schedule?.id;

        if (!scheduleId) {
            return null;
        }

        try {
            const schedule =
                await this.stripe.subscriptionSchedules.retrieve(scheduleId);
            const phases = schedule.phases;
            if (!phases || phases.length < 2) {
                return null;
            }

            // The last phase contains the upcoming plan after the switch
            const lastPhase = phases[phases.length - 1];
            const priceId =
                typeof lastPhase.items[0]?.price === 'string'
                    ? lastPhase.items[0].price
                    : lastPhase.items[0]?.price?.id;

            if (!priceId) {
                return null;
            }

            const priceToPlan = await this.catalogService.getPriceToPlanMap();
            const planCode = priceToPlan[priceId];
            if (!planCode) {
                this.logger.warn(
                    `Unknown priceId ${priceId} in subscription schedule ${scheduleId}`
                );
                return null;
            }

            return {
                planCode,
                changeDate: new Date(lastPhase.start_date * 1000),
            };
        } catch (error) {
            this.logger.error(
                `Failed to retrieve subscription schedule ${scheduleId}`,
                error instanceof Error ? error.stack : String(error)
            );
            return null;
        }
    }

    async deleteCustomerData(providerCustomerId: string): Promise<void> {
        // Cancel all non-canceled subscriptions (auto-paginate handles >10)
        for await (const sub of this.stripe.subscriptions.list({
            customer: providerCustomerId,
            status: 'all',
        })) {
            if (sub.status !== 'canceled') {
                await this.stripe.subscriptions.cancel(sub.id);
            }
        }

        // Delete the customer (removes payment methods, invoices, etc.)
        await this.stripe.customers.del(providerCustomerId);
        this.logger.log(
            `Deleted Stripe customer ${providerCustomerId} and all subscriptions`
        );
    }

    private mapSubscriptionStatus(stripeStatus: string): SubscriptionStatus {
        const mapping: Record<string, SubscriptionStatus> = {
            active: SUBSCRIPTION_STATUS.ACTIVE,
            trialing: SUBSCRIPTION_STATUS.TRIALING,
            past_due: SUBSCRIPTION_STATUS.PAST_DUE,
            canceled: SUBSCRIPTION_STATUS.CANCELED,
            incomplete: SUBSCRIPTION_STATUS.INCOMPLETE,
            unpaid: SUBSCRIPTION_STATUS.UNPAID,
            incomplete_expired: SUBSCRIPTION_STATUS.CANCELED,
            paused: SUBSCRIPTION_STATUS.UNKNOWN,
        };
        return mapping[stripeStatus] ?? SUBSCRIPTION_STATUS.UNKNOWN;
    }

    private toRaw(obj: object): Record<string, unknown> {
        return JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
    }
}
