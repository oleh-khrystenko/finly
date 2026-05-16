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
    Req,
    UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { RawBodyRequest } from '@nestjs/common/interfaces';
import { Request } from 'express';
import type { PaymentsCatalog } from '@finly/types';
import { JwtActiveGuard } from '../../common/guards/jwt-active.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SkipOnboarding } from '../../common/decorators/skip-onboarding.decorator';
import { UserDocument } from '../users/schemas/user.schema';
import { ENV } from '../../config/env';
import { PaymentsService } from './payments.service';
import { CatalogService } from './catalog.service';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';

@Controller('payments')
export class PaymentsController {
    constructor(
        private readonly paymentsService: PaymentsService,
        private readonly catalogService: CatalogService
    ) {}

    @SkipThrottle()
    @SkipOnboarding()
    @Get('catalog')
    async getCatalog(): Promise<{ data: PaymentsCatalog }> {
        const catalog = await this.catalogService.getCatalog();
        return {
            data: {
                subscriptionPlans: ENV.PAYMENTS_SUBSCRIPTION_ENABLED
                    ? catalog.subscriptionPlans
                    : [],
                executionPacks: ENV.PAYMENTS_ONE_OFF_ENABLED
                    ? catalog.executionPacks
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
    @Post('portal-session')
    async createPortalSession(
        @CurrentUser() user: UserDocument
    ): Promise<{ data: { portalUrl: string } }> {
        const result = await this.paymentsService.createPortalSession(
            user._id.toString()
        );
        return { data: { portalUrl: result.portalUrl } };
    }

    @UseGuards(JwtActiveGuard)
    @Post('reset')
    @HttpCode(HttpStatus.OK)
    async resetBilling(
        @CurrentUser() user: UserDocument
    ): Promise<{ data: null }> {
        await this.paymentsService.resetBilling(user._id.toString());
        return { data: null };
    }

    private static readonly SUPPORTED_PROVIDERS = new Set(['stripe']);

    @SkipThrottle()
    @Post('webhook/:provider')
    async handleWebhook(
        @Param('provider') provider: string,
        @Req() req: RawBodyRequest<Request>,
        @Headers('stripe-signature') signature: string
    ): Promise<{ received: true }> {
        if (!PaymentsController.SUPPORTED_PROVIDERS.has(provider)) {
            throw new BadRequestException(`Unsupported provider: ${provider}`);
        }
        if (!signature) {
            throw new BadRequestException('Missing webhook signature');
        }
        const rawBody = req.rawBody;
        if (!rawBody) {
            throw new BadRequestException('Missing raw body');
        }
        await this.paymentsService.handleWebhook(provider, rawBody, signature);
        return { received: true };
    }
}
