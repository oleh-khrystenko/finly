import {
    BadRequestException,
    Body,
    Controller,
    Get,
    Headers,
    HttpCode,
    HttpStatus,
    Param,
    Post,
    Query,
    Req,
    ServiceUnavailableException,
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
import { ResumeSubscriptionDto } from './dto/manage-subscription.dto';
import type { PaymentRecordLean } from './schemas/payment-record.schema';

const DEFAULT_PAYMENTS_LIMIT = 10;
const MAX_PAYMENTS_LIMIT = 50;
const SUPPORTED_PROVIDERS = new Set(['monobank']);

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
    @Post('subscription/resume')
    @HttpCode(HttpStatus.OK)
    async resumeSubscription(
        @CurrentUser() user: UserDocument,
        @Body() dto: ResumeSubscriptionDto
    ): Promise<{ data: { checkoutUrl: string } }> {
        const result = await this.paymentsService.resumeSubscription(
            user._id.toString(),
            dto
        );
        return { data: result };
    }

    @UseGuards(JwtActiveGuard)
    @Post('subscription/cancel')
    @HttpCode(HttpStatus.OK)
    async cancelSubscription(
        @CurrentUser() user: UserDocument
    ): Promise<{ data: { ok: true } }> {
        await this.paymentsService.cancelSubscription(user._id.toString());
        return { data: { ok: true } };
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
        @Headers('x-sign') signature: string | undefined,
        @Req() req: RawBodyRequest<Request>
    ): Promise<{ ok: true }> {
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
        const acked = await this.paymentsService.handleWebhook(
            rawBody,
            signature
        );
        if (!acked) {
            // Crash-orphan / lock-busy: non-2xx → monobank передоставить подію.
            throw new ServiceUnavailableException({
                code: RESPONSE_CODE.INTERNAL_ERROR,
                message: 'Webhook deferred, will retry',
            });
        }
        return { ok: true };
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
