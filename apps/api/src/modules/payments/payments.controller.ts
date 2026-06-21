import {
    BadRequestException,
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Post,
    Query,
    Req,
    UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { RawBodyRequest } from '@nestjs/common/interfaces';
import { Request } from 'express';
import {
    RESPONSE_CODE,
    type PaymentRecord,
    type PaymentsCatalog,
} from '@finly/types';
import { JwtActiveGuard } from '../../common/guards/jwt-active.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SkipOnboarding } from '../../common/decorators/skip-onboarding.decorator';
import { UserDocument } from '../users/schemas/user.schema';
import { ENV } from '../../config/env';
import { PaymentsService } from './payments.service';
import { CatalogService } from './catalog.service';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';
import {
    CancelSubscriptionDto,
    ChangePlanDto,
} from './dto/manage-subscription.dto';
import type { PaymentRecordLean } from './schemas/payment-record.schema';

const DEFAULT_PAYMENTS_LIMIT = 10;
const MAX_PAYMENTS_LIMIT = 50;
const SUPPORTED_PROVIDERS = new Set(['wayforpay']);

@Controller('payments')
export class PaymentsController {
    constructor(
        private readonly paymentsService: PaymentsService,
        private readonly catalogService: CatalogService
    ) {}

    @SkipThrottle()
    @SkipOnboarding()
    @Get('catalog')
    getCatalog(): { data: PaymentsCatalog } {
        const catalog = this.catalogService.getCatalog();
        return {
            data: {
                subscriptionPlans: ENV.PAYMENTS_SUBSCRIPTION_ENABLED
                    ? catalog.subscriptionPlans
                    : [],
                oneOffAccesses: ENV.PAYMENTS_ONE_OFF_ENABLED
                    ? catalog.oneOffAccesses
                    : [],
            },
        };
    }

    @UseGuards(JwtActiveGuard)
    @Post('checkout-session')
    async createCheckoutSession(
        @CurrentUser() user: UserDocument,
        @Body() dto: CreateCheckoutSessionDto
    ): Promise<{ data: { checkoutUrl: string } }> {
        const { checkoutUrl } =
            await this.paymentsService.createCheckoutSession(
                user._id.toString(),
                dto
            );
        return { data: { checkoutUrl } };
    }

    @UseGuards(JwtActiveGuard)
    @Post('subscription/cancel')
    @HttpCode(HttpStatus.OK)
    async cancelSubscription(
        @CurrentUser() user: UserDocument,
        @Body() dto: CancelSubscriptionDto
    ): Promise<{ data: { refundedAmount: number | null } }> {
        const result = await this.paymentsService.cancelSubscription(
            user._id.toString(),
            dto
        );
        return { data: result };
    }

    @UseGuards(JwtActiveGuard)
    @Post('subscription/change-plan')
    @HttpCode(HttpStatus.OK)
    async changePlan(
        @CurrentUser() user: UserDocument,
        @Body() dto: ChangePlanDto
    ): Promise<{ data: { scheduled: boolean } }> {
        const result = await this.paymentsService.changePlan(
            user._id.toString(),
            dto
        );
        return { data: result };
    }

    @UseGuards(JwtActiveGuard)
    @Get('payments')
    async listPayments(
        @CurrentUser() user: UserDocument,
        @Query('limit') limitParam?: string
    ): Promise<{ data: PaymentRecord[] }> {
        const limit = clampLimit(limitParam);
        const records = await this.paymentsService.listPayments(
            user._id.toString(),
            limit
        );
        return { data: records.map(mapPaymentRecord) };
    }

    @SkipThrottle()
    @SkipOnboarding()
    @Post('webhook/:provider')
    @HttpCode(HttpStatus.OK)
    async handleWebhook(
        @Param('provider') provider: string,
        @Req() req: RawBodyRequest<Request>
    ): Promise<Record<string, unknown>> {
        if (!SUPPORTED_PROVIDERS.has(provider)) {
            throw new BadRequestException({
                code: RESPONSE_CODE.VALIDATION_ERROR,
                message: `Unsupported provider: ${provider}`,
            });
        }
        const rawBody = req.rawBody;
        if (!rawBody) {
            throw new BadRequestException({
                code: RESPONSE_CODE.VALIDATION_ERROR,
                message: 'Missing raw body',
            });
        }
        const accept = await this.paymentsService.handleWebhook(rawBody);
        // Невалідний підпис → accept null. Віддаємо порожній об'єкт (200), щоб
        // не зливати інформацію про причину; валідний колбек отримує підписаний
        // accept, без якого WayForPay шле повтори.
        return accept ?? {};
    }
}

function clampLimit(raw: string | undefined): number {
    const parsed = raw ? parseInt(raw, 10) : DEFAULT_PAYMENTS_LIMIT;
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PAYMENTS_LIMIT;
    return Math.min(parsed, MAX_PAYMENTS_LIMIT);
}

function mapPaymentRecord(record: PaymentRecordLean): PaymentRecord {
    return {
        id: record._id.toString(),
        type: record.type,
        amount: record.amount,
        currency: record.currency,
        status: record.status,
        cardMask: record.cardMask,
        refundAmount: record.refundAmount,
        createdAt: record.createdAt,
    };
}
