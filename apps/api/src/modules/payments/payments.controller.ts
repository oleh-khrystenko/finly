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
    type BillingCatalog,
    type BillingProfileView,
    type CreditLedgerEntry,
    type PaymentRecord,
    type PriceCalculation,
} from '@finly/types';
import { JwtActiveGuard } from '../../common/guards/jwt-active.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SkipOnboarding } from '../../common/decorators/skip-onboarding.decorator';
import { UserDocument } from '../users/schemas/user.schema';
import { BillingProfileService } from './billing-profile.service';
import { CatalogService } from './catalog.service';
import {
    BuyCreditsDto,
    ChangeCapacityDto,
    ManageAttachmentDto,
    PriceCalculatorDto,
    ResumeSubscriptionDto,
    StartCheckoutDto,
} from './dto/billing.dto';
import type { PaymentRecordLean } from './schemas/payment-record.schema';
import type { CreditLedgerEntryLean } from './schemas/credit-ledger-entry.schema';

const DEFAULT_LIST_LIMIT = 10;
const MAX_LIST_LIMIT = 50;
const SUPPORTED_PROVIDERS = new Set(['monobank']);

@Controller('payments')
export class PaymentsController {
    constructor(
        private readonly billing: BillingProfileService,
        private readonly catalog: CatalogService
    ) {}

    @SkipThrottle()
    @SkipOnboarding()
    @Get('catalog')
    getCatalog(): { data: BillingCatalog } {
        return { data: this.catalog.getCatalog() };
    }

    @UseGuards(JwtActiveGuard)
    @Get('profile')
    async getProfileView(
        @CurrentUser() user: UserDocument
    ): Promise<{ data: BillingProfileView | null }> {
        const view = await this.billing.getProfileView(user._id.toString());
        return { data: view };
    }

    // ── First purchase (hosted checkout) ─────────────────────────────────

    @UseGuards(JwtActiveGuard)
    @Post('checkout')
    async checkout(
        @CurrentUser() user: UserDocument,
        @Body() dto: StartCheckoutDto
    ): Promise<{ data: { checkoutUrl: string } }> {
        const result = await this.billing.startCheckout(
            user._id.toString(),
            dto
        );
        return { data: result };
    }

    // ── Capacity / attachments (existing token) ──────────────────────────

    @UseGuards(JwtActiveGuard)
    @Post('capacity')
    @HttpCode(HttpStatus.OK)
    async changeCapacity(
        @CurrentUser() user: UserDocument,
        @Body() dto: ChangeCapacityDto
    ): Promise<{ data: { immediateCharge: number; scheduled: boolean } }> {
        const result = await this.billing.changeCapacity(
            user._id.toString(),
            dto
        );
        return { data: result };
    }

    @UseGuards(JwtActiveGuard)
    @Post('attach')
    @HttpCode(HttpStatus.OK)
    async attach(
        @CurrentUser() user: UserDocument,
        @Body() dto: ManageAttachmentDto
    ): Promise<{ data: { ok: true } }> {
        await this.billing.attachBusiness(user._id.toString(), dto);
        return { data: { ok: true } };
    }

    @UseGuards(JwtActiveGuard)
    @Post('detach')
    @HttpCode(HttpStatus.OK)
    async detach(
        @CurrentUser() user: UserDocument,
        @Body() dto: ManageAttachmentDto
    ): Promise<{ data: { ok: true } }> {
        await this.billing.detachBusiness(user._id.toString(), dto);
        return { data: { ok: true } };
    }

    @UseGuards(JwtActiveGuard)
    @Post('credits/buy')
    @HttpCode(HttpStatus.OK)
    async buyCredits(
        @CurrentUser() user: UserDocument,
        @Body() dto: BuyCreditsDto
    ): Promise<{ data: { charged: number; scheduled: boolean } }> {
        const result = await this.billing.buyCredits(user._id.toString(), dto);
        return { data: result };
    }

    @UseGuards(JwtActiveGuard)
    @Post('calculator')
    @HttpCode(HttpStatus.OK)
    async calculate(
        @CurrentUser() user: UserDocument,
        @Body() dto: PriceCalculatorDto
    ): Promise<{ data: PriceCalculation }> {
        const result = await this.billing.calculate(user._id.toString(), dto);
        return { data: result };
    }

    // ── Cancel / resume ──────────────────────────────────────────────────

    @UseGuards(JwtActiveGuard)
    @Post('subscription/cancel')
    @HttpCode(HttpStatus.OK)
    async cancel(
        @CurrentUser() user: UserDocument
    ): Promise<{ data: { ok: true } }> {
        await this.billing.cancel(user._id.toString());
        return { data: { ok: true } };
    }

    @UseGuards(JwtActiveGuard)
    @Post('subscription/resume')
    @HttpCode(HttpStatus.OK)
    async resume(
        @CurrentUser() user: UserDocument,
        @Body() dto: ResumeSubscriptionDto
    ): Promise<{ data: { checkoutUrl: string } }> {
        const result = await this.billing.resume(
            user._id.toString(),
            dto.returnPath
        );
        return { data: result };
    }

    // ── History ──────────────────────────────────────────────────────────

    @UseGuards(JwtActiveGuard)
    @Get('payments')
    async listPayments(
        @CurrentUser() user: UserDocument,
        @Query('limit') limitParam?: string
    ): Promise<{ data: PaymentRecord[] }> {
        const records = await this.billing.listPayments(
            user._id.toString(),
            clampLimit(limitParam)
        );
        return { data: records.map(mapPaymentRecord) };
    }

    @UseGuards(JwtActiveGuard)
    @Get('credits/ledger')
    async listLedger(
        @CurrentUser() user: UserDocument,
        @Query('limit') limitParam?: string
    ): Promise<{ data: CreditLedgerEntry[] }> {
        const entries = await this.billing.listLedger(
            user._id.toString(),
            clampLimit(limitParam)
        );
        return { data: entries.map(mapLedgerEntry) };
    }

    // ── Webhook ──────────────────────────────────────────────────────────

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
        const acked = await this.billing.handleWebhook(rawBody, signature);
        if (!acked) {
            throw new ServiceUnavailableException({
                code: RESPONSE_CODE.INTERNAL_ERROR,
                message: 'Webhook deferred, will retry',
            });
        }
        return { ok: true };
    }
}

function clampLimit(raw: string | undefined): number {
    const parsed = raw ? parseInt(raw, 10) : DEFAULT_LIST_LIMIT;
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIST_LIMIT;
    return Math.min(parsed, MAX_LIST_LIMIT);
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

function mapLedgerEntry(entry: CreditLedgerEntryLean): CreditLedgerEntry {
    return {
        id: entry._id.toString(),
        type: entry.type,
        credits: entry.credits,
        balanceAfter: entry.balanceAfter,
        createdAt: entry.createdAt,
    };
}
