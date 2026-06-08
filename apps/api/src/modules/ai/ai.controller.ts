import {
    Body,
    Controller,
    Logger,
    Req,
    Res,
    Post,
    UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import {
    HELP_CHAT_EVENT,
    type HelpChatDoneEvent,
    type HelpChatErrorEvent,
    type HelpChatTokenEvent,
} from '@finly/types';

import { SkipOnboarding } from '../../common/decorators/skip-onboarding.decorator';
import { AiService } from './ai.service';
import { HelpChatDto } from './dto/help-chat.dto';
import { HelpChatRateLimitGuard } from './guards/help-chat-rate-limit.guard';

@Controller('ai')
export class AiController {
    private readonly logger = new Logger(AiController.name);

    constructor(private readonly aiService: AiService) {}

    /**
     * Public help assistant (Sprint 16). Anon, no auth, no executions, no DB:
     * history arrives from the client and the server is stateless. Own throttle
     * bucket + own IP/budget guard.
     */
    @Post('help/chat')
    @SkipThrottle({ default: true })
    @Throttle({ 'help-chat': { limit: 20, ttl: 60_000 } })
    @SkipOnboarding()
    @UseGuards(HelpChatRateLimitGuard)
    async helpChat(
        @Body() dto: HelpChatDto,
        @Req() req: Request,
        @Res() res: Response
    ): Promise<void> {
        const abortController = new AbortController();
        let aborted = false;

        const onClose = () => {
            aborted = true;
            abortController.abort();
        };
        req.on('close', onClose);

        const messages = this.aiService.buildHelpChatMessages(
            dto.message,
            dto.history
        );

        if (aborted) {
            req.off('close', onClose);
            return;
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.socket?.setNoDelay(true);
        res.flushHeaders();

        try {
            const stream = await this.aiService.streamHelpChat(
                messages,
                abortController.signal
            );

            for await (const chunk of stream) {
                if (aborted) break;
                this.writeSSE<HelpChatTokenEvent>(res, {
                    type: HELP_CHAT_EVENT.TOKEN,
                    content: chunk as string,
                });
            }

            if (!aborted) {
                this.writeSSE<HelpChatDoneEvent>(res, {
                    type: HELP_CHAT_EVENT.DONE,
                });
            }
        } catch (err) {
            this.logger.error(`Help chat error: ${(err as Error).message}`);
            if (!aborted) {
                this.writeSSE<HelpChatErrorEvent>(res, {
                    type: HELP_CHAT_EVENT.ERROR,
                    code: 'AI_PROVIDER_ERROR',
                });
            }
        } finally {
            req.off('close', onClose);
            if (!res.writableEnded) {
                res.end();
            }
        }
    }

    private writeSSE<T>(res: Response, data: T): void {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
}
