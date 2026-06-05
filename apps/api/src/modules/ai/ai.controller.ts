import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Logger,
    Req,
    Res,
    Post,
    UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import {
    AI_CHAT_EVENT,
    type AiChatDoneEvent,
    type AiChatErrorEvent,
    type AiChatTokenEvent,
    type ChatMessageItem,
    type HelpChatDoneEvent,
} from '@finly/types';

import { JwtActiveGuard } from '../../common/guards/jwt-active.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SkipOnboarding } from '../../common/decorators/skip-onboarding.decorator';
import { UserDocument } from '../users/schemas/user.schema';
import { AiService } from './ai.service';
import { AiChatDto } from './dto/ai-chat.dto';
import { HelpChatDto } from './dto/help-chat.dto';
import { AiRateLimitGuard } from './guards/ai-rate-limit.guard';
import { HelpChatRateLimitGuard } from './guards/help-chat-rate-limit.guard';

@Controller('ai')
export class AiController {
    private readonly logger = new Logger(AiController.name);

    constructor(private readonly aiService: AiService) {}

    @Post('chat')
    @UseGuards(JwtActiveGuard, AiRateLimitGuard)
    async chat(
        @CurrentUser() user: UserDocument,
        @Body() dto: AiChatDto,
        @Req() req: Request,
        @Res() res: Response
    ): Promise<void> {
        const userId = user._id.toString();

        // Pre-stream phase: any 4xx exception propagates as HTTP error — SSE headers not yet set.
        const reservation = await this.aiService.reserveChatRequest(userId);

        const abortController = new AbortController();
        let aborted = false;

        const onClose = () => {
            aborted = true;
            abortController.abort();
        };
        req.on('close', onClose);

        let messages;
        try {
            messages = await this.aiService.buildChatMessages(
                userId,
                dto.message
            );
        } catch (err) {
            req.off('close', onClose);
            await this.aiService.refundChatRequest(reservation);
            throw err;
        }

        if (aborted) {
            req.off('close', onClose);
            await this.aiService.refundChatRequest(reservation);
            return;
        }

        // SSE bootstrap — after this point, errors go as SSE events.
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.socket?.setNoDelay(true);
        res.flushHeaders();

        let firstTokenReceived = false;
        let committed = false;
        let assistantContent = '';

        try {
            const stream = await this.aiService.streamChat(
                messages,
                abortController.signal
            );

            for await (const chunk of stream) {
                if (aborted) break;

                if (!firstTokenReceived) {
                    firstTokenReceived = true;
                }

                assistantContent += chunk as string;
                this.writeSSE<AiChatTokenEvent>(res, {
                    type: AI_CHAT_EVENT.TOKEN,
                    content: chunk as string,
                });
            }

            if (!aborted) {
                // Happy path — commit and send DONE.
                const result = await this.aiService.commitChatRequest(
                    reservation,
                    dto.message,
                    assistantContent
                );
                committed = true;

                this.writeSSE<AiChatDoneEvent>(res, {
                    type: AI_CHAT_EVENT.DONE,
                    balanceAfter: result.balanceAfter,
                });
            } else if (firstTokenReceived) {
                // Client aborted after first token — non-refundable, commit silently.
                try {
                    await this.aiService.commitChatRequest(
                        reservation,
                        dto.message,
                        assistantContent
                    );
                    committed = true;
                } catch (commitErr) {
                    this.logger.error(
                        `Commit after abort failed for reservation ${reservation.reservationId}: ${(commitErr as Error).message}`
                    );
                }
            }
            // aborted && !firstTokenReceived → do nothing, refund in finally
        } catch (err) {
            this.logger.error(
                `AI chat error for user ${userId}, reservation ${reservation.reservationId}: ${(err as Error).message}`
            );

            // Abort signal may cause provider to throw after first token — still non-refundable.
            if (aborted && firstTokenReceived && !committed) {
                try {
                    await this.aiService.commitChatRequest(
                        reservation,
                        dto.message,
                        assistantContent
                    );
                    committed = true;
                } catch {
                    // Commit failed — will refund in finally.
                }
            }

            if (!aborted) {
                this.writeSSE<AiChatErrorEvent>(res, {
                    type: AI_CHAT_EVENT.ERROR,
                    code: 'AI_PROVIDER_ERROR',
                });
            }
        } finally {
            req.off('close', onClose);

            if (!committed) {
                await this.aiService.refundChatRequest(reservation);
            }

            if (!res.writableEnded) {
                res.end();
            }
        }
    }

    /**
     * Public help assistant (Sprint 16). Anon, no auth, no executions, no DB:
     * history arrives from the client and the server is stateless. Own throttle
     * bucket + own IP/budget guard, fully separate from the cabinet chat above.
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
                this.writeSSE<AiChatTokenEvent>(res, {
                    type: AI_CHAT_EVENT.TOKEN,
                    content: chunk as string,
                });
            }

            if (!aborted) {
                this.writeSSE<HelpChatDoneEvent>(res, {
                    type: AI_CHAT_EVENT.DONE,
                });
            }
        } catch (err) {
            this.logger.error(`Help chat error: ${(err as Error).message}`);
            if (!aborted) {
                this.writeSSE<AiChatErrorEvent>(res, {
                    type: AI_CHAT_EVENT.ERROR,
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

    @Get('chat/history')
    @UseGuards(JwtActiveGuard)
    async getHistory(
        @CurrentUser() user: UserDocument
    ): Promise<{ data: { messages: ChatMessageItem[] } }> {
        const messages = await this.aiService.getHistory(user._id.toString());
        return { data: { messages } };
    }

    @Delete('chat/history')
    @UseGuards(JwtActiveGuard)
    @HttpCode(HttpStatus.OK)
    async clearHistory(
        @CurrentUser() user: UserDocument
    ): Promise<{ data: { cleared: boolean } }> {
        await this.aiService.clearHistory(user._id.toString());
        return { data: { cleared: true } };
    }

    private writeSSE<T>(res: Response, data: T): void {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
}
