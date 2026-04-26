import { Body, Controller, Ip, Post, UseGuards } from '@nestjs/common';
import { RESPONSE_CODE } from '@cyanship/types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SkipOnboarding } from '../../common/decorators/skip-onboarding.decorator';
import { JwtActiveGuard } from '../../common/guards/jwt-active.guard';
import type { UserDocument } from '../users/schemas/user.schema';
import { SubmitBriefDto } from './dto/submit-brief.dto';
import { BriefService } from './services/brief.service';
import { TurnstileService } from './services/turnstile.service';

@Controller('agency')
export class BriefController {
    constructor(
        private readonly briefService: BriefService,
        private readonly turnstileService: TurnstileService
    ) {}

    @Post('brief')
    @SkipOnboarding()
    async submitBrief(
        @Body() dto: SubmitBriefDto,
        @Ip() ip: string
    ): Promise<{ data: null; code: string }> {
        await this.turnstileService.verify(dto.captchaToken, ip);
        await this.briefService.submit({ dto });

        return {
            data: null,
            code: RESPONSE_CODE.BRIEF_SUBMITTED,
        };
    }

    @Post('brief/authenticated')
    @UseGuards(JwtActiveGuard)
    async submitAuthenticatedBrief(
        @Body() dto: SubmitBriefDto,
        @Ip() ip: string,
        @CurrentUser() user: UserDocument
    ): Promise<{ data: { aiBonusGranted: boolean }; code: string }> {
        await this.turnstileService.verify(dto.captchaToken, ip);

        const { aiBonusGranted } = await this.briefService.submit({
            dto,
            userId: user._id.toString(),
            requestAiBonus: true,
        });

        return {
            data: { aiBonusGranted },
            code: RESPONSE_CODE.BRIEF_SUBMITTED,
        };
    }
}
