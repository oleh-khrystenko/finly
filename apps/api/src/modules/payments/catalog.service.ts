import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import Stripe from 'stripe';
import Redis from 'ioredis';
import {
    SUBSCRIPTION_PLAN_CODES,
    EXECUTION_PACK_CODES,
    type PaymentsCatalog,
    type SubscriptionPlanItem,
    type ExecutionPackItem,
} from '@neatslip/types';
import { ENV } from '../../config/env';
import { REDIS_CLIENT } from '../../common/modules/redis.module';

const CACHE_KEY = 'payments:catalog';
const CACHE_TTL_SEC = 300; // 5 minutes

@Injectable()
export class CatalogService implements OnModuleInit {
    private readonly stripe: Stripe;
    private readonly logger = new Logger(CatalogService.name);

    constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
        this.stripe = new Stripe(ENV.STRIPE_SECRET_KEY, {
            apiVersion: '2026-02-25.clover',
        });
    }

    /**
     * Warm cache on startup (fail-fast if Stripe unreachable or misconfigured).
     * Validates that all expected plan/pack codes are present — catches metadata typos at deploy time.
     */
    async onModuleInit(): Promise<void> {
        const catalog = await this.refreshCatalog();
        this.validateCatalog(catalog);
        this.logger.log('Catalog cache warmed from Stripe');
    }

    /**
     * Returns catalog from Redis cache, falling back to Stripe on cache miss or Redis error.
     * Redis failures are non-fatal — the service degrades to direct Stripe fetches.
     */
    async getCatalog(): Promise<PaymentsCatalog> {
        try {
            const cached = await this.redis.get(CACHE_KEY);
            if (cached) {
                return JSON.parse(cached) as PaymentsCatalog;
            }
        } catch (error) {
            this.logger.warn(
                'Failed to read catalog from Redis, falling back to Stripe',
                error instanceof Error ? error.message : String(error)
            );
        }

        return this.refreshCatalog();
    }

    /** Forces a fresh fetch from Stripe and updates the Redis cache. */
    async refreshCatalog(): Promise<PaymentsCatalog> {
        const catalog = await this.fetchFromStripe();

        try {
            await this.redis.set(
                CACHE_KEY,
                JSON.stringify(catalog),
                'EX',
                CACHE_TTL_SEC
            );
        } catch (error) {
            this.logger.warn(
                'Failed to write catalog to Redis cache',
                error instanceof Error ? error.message : String(error)
            );
        }

        return catalog;
    }

    /** Returns a subscription plan by code, or undefined if not found. */
    async getSubscriptionPlan(
        code: string
    ): Promise<SubscriptionPlanItem | undefined> {
        const catalog = await this.getCatalog();
        return catalog.subscriptionPlans.find((p) => p.code === code);
    }

    /** Returns an execution pack by code, or undefined if not found. */
    async getExecutionPack(
        code: string
    ): Promise<ExecutionPackItem | undefined> {
        const catalog = await this.getCatalog();
        return catalog.executionPacks.find((p) => p.code === code);
    }

    /** Returns a reverse lookup map: Stripe priceId → plan code (subscription plans only). */
    async getPriceToPlanMap(): Promise<Record<string, string>> {
        const catalog = await this.getCatalog();
        const map: Record<string, string> = {};
        for (const plan of catalog.subscriptionPlans) {
            map[plan.priceId] = plan.code;
        }
        return map;
    }

    /** Returns a reverse lookup map: Stripe priceId → executions count (subscription plans only). */
    async getPriceToExecutionsMap(): Promise<Record<string, number>> {
        const catalog = await this.getCatalog();
        const map: Record<string, number> = {};
        for (const plan of catalog.subscriptionPlans) {
            map[plan.priceId] = plan.executions;
        }
        return map;
    }

    private validateCatalog(catalog: PaymentsCatalog): void {
        const planCodes = new Set(catalog.subscriptionPlans.map((p) => p.code));
        const packCodes = new Set(catalog.executionPacks.map((p) => p.code));

        const missingPlans = ENV.PAYMENTS_SUBSCRIPTION_ENABLED
            ? SUBSCRIPTION_PLAN_CODES.filter((c) => !planCodes.has(c))
            : [];
        const missingPacks = ENV.PAYMENTS_ONE_OFF_ENABLED
            ? EXECUTION_PACK_CODES.filter((c) => !packCodes.has(c))
            : [];

        const missing = [
            ...missingPlans.map((c) => `subscription "${c}"`),
            ...missingPacks.map((c) => `execution pack "${c}"`),
        ];

        if (missing.length > 0) {
            throw new Error(
                `❌ Stripe catalog validation failed. Missing products: ${missing.join(', ')}. ` +
                    'Check that each Stripe Product has metadata.code and metadata.purchase_type set correctly.'
            );
        }

        // Check for duplicate codes
        if (planCodes.size !== catalog.subscriptionPlans.length) {
            throw new Error(
                '❌ Stripe catalog has duplicate subscription plan codes. Each metadata.code must be unique.'
            );
        }
        if (packCodes.size !== catalog.executionPacks.length) {
            throw new Error(
                '❌ Stripe catalog has duplicate execution pack codes. Each metadata.code must be unique.'
            );
        }
    }

    private async fetchFromStripe(): Promise<PaymentsCatalog> {
        const products = await this.stripe.products.list({
            active: true,
            expand: ['data.default_price'],
        });

        const subscriptionPlans: SubscriptionPlanItem[] = [];
        const executionPacks: ExecutionPackItem[] = [];

        for (const product of products.data) {
            const meta = product.metadata;
            const purchaseType = meta.purchase_type;
            const code = meta.code;

            // Skip products without billing metadata (non-billing Stripe products)
            if (!code || !purchaseType) continue;

            const price = product.default_price as Stripe.Price | null;
            if (!price || !price.unit_amount) {
                this.logger.warn(
                    `Stripe product "${product.name}" (${product.id}) has code="${code}" but no default_price with unit_amount — skipped`
                );
                continue;
            }

            const executions = parseInt(meta.executions ?? '0', 10);
            const displayOrder = parseInt(meta.display_order ?? '0', 10);
            const featured = meta.featured === 'true';

            if (purchaseType === 'subscription') {
                subscriptionPlans.push({
                    code,
                    priceId: price.id,
                    priceAmount: price.unit_amount,
                    currency: price.currency,
                    interval: price.recurring?.interval ?? 'month',
                    executions,
                    displayOrder,
                    featured,
                });
            } else if (purchaseType === 'executions_pack') {
                executionPacks.push({
                    code,
                    priceId: price.id,
                    priceAmount: price.unit_amount,
                    currency: price.currency,
                    executions,
                    displayOrder,
                    featured,
                });
            } else {
                this.logger.warn(
                    `Stripe product "${product.name}" (${product.id}) has unknown purchase_type="${purchaseType}" — skipped`
                );
            }
        }

        subscriptionPlans.sort((a, b) => a.displayOrder - b.displayOrder);
        executionPacks.sort((a, b) => a.displayOrder - b.displayOrder);

        return { subscriptionPlans, executionPacks };
    }
}
