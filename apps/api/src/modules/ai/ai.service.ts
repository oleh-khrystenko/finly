import {
    BadRequestException,
    ConflictException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';

import {
    AI_CHAT_COST,
    AI_CHAT_RESERVATION_TTL_MS,
    EXECUTION_ACTION,
    EXECUTION_TRANSACTION_TYPE,
    RESPONSE_CODE,
} from '@neatslip/types';

import { ENV } from '../../config/env';
import { User, UserDocument } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import type { ReservationTicket } from '../users/interfaces/reservation';
import {
    ChatMessage,
    ChatMessageDocument,
} from './schemas/chat-message.schema';
import {
    AI_PROVIDER,
    type AiChatMessage,
    type IAiProvider,
} from './interfaces/ai-provider.interface';

const SYSTEM_PROMPT = `You are the AI assistant on NeatSlip.

RESPONSE GUIDELINES
- Always respond in the same language as the user's message. Use only that language's script — never mix in characters from other languages.
- Keep responses focused and concise — aim for 150-250 words maximum. You have a hard output limit, so prioritize the most relevant information for the question asked, then offer to elaborate on specific aspects.
- Tone: warm, professional, confident. Be helpful and approachable, but not overly casual.
- Use markdown formatting: **bold** for emphasis, bullet lists for structure. Avoid heavy formatting (tables, emoji headers, horizontal rules) — keep it clean and readable.
- If you don't know something specific, say so honestly. Never invent facts about NeatSlip, its features, pricing, or policies that you have not been told.`;

const AI_CHAT_MAX_HISTORY_MESSAGES = 50;

@Injectable()
export class AiService {
    private readonly logger = new Logger(AiService.name);

    constructor(
        @Inject(AI_PROVIDER)
        private readonly aiProvider: IAiProvider,

        @InjectModel(ChatMessage.name)
        private readonly chatMessageModel: Model<ChatMessageDocument>,

        @InjectModel(User.name)
        private readonly userModel: Model<UserDocument>,

        private readonly usersService: UsersService
    ) {}

    async buildChatMessages(
        userId: string,
        userMessage: string
    ): Promise<AiChatMessage[]> {
        const history = await this.chatMessageModel
            .find({ userId: new Types.ObjectId(userId) })
            .sort({ createdAt: -1, _id: -1 })
            .limit(AI_CHAT_MAX_HISTORY_MESSAGES)
            .select({ role: 1, content: 1 })
            .lean();

        history.reverse();

        if (history.length > 0 && history[0].role === 'assistant') {
            history.shift();
        }

        const currentMessage: AiChatMessage = {
            role: 'user',
            content: userMessage,
        };
        let historyMessages: AiChatMessage[] = history.map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
        }));

        const inputBudget =
            this.aiProvider.contextWindow - ENV.AI_CHAT_MAX_TOKENS;

        let messages = [...historyMessages, currentMessage];
        let inputTokens = await this.aiProvider.countTokens(
            messages,
            SYSTEM_PROMPT
        );

        while (inputTokens > inputBudget && historyMessages.length > 0) {
            const removeCount = Math.max(
                2,
                Math.ceil(historyMessages.length * 0.2)
            );
            historyMessages = historyMessages.slice(removeCount);
            if (
                historyMessages.length > 0 &&
                historyMessages[0].role === 'assistant'
            ) {
                historyMessages.shift();
            }
            messages = [...historyMessages, currentMessage];
            inputTokens = await this.aiProvider.countTokens(
                messages,
                SYSTEM_PROMPT
            );
        }

        if (inputTokens > inputBudget) {
            throw new BadRequestException({
                code: RESPONSE_CODE.AI_MESSAGE_TOO_LONG,
                message: 'Message exceeds context budget',
            });
        }

        return messages;
    }

    async streamChat(
        messages: AiChatMessage[],
        signal?: AbortSignal
    ): Promise<Readable> {
        return this.aiProvider.streamChat(
            messages,
            SYSTEM_PROMPT,
            ENV.AI_CHAT_MAX_TOKENS,
            signal
        );
    }

    async reserveChatRequest(userId: string): Promise<ReservationTicket> {
        const reservationId = randomUUID();
        const now = new Date();
        const expiresAt = new Date(now.getTime() + AI_CHAT_RESERVATION_TTL_MS);

        const updated = await this.userModel.findOneAndUpdate(
            {
                _id: userId,
                'executions.balance': { $gte: AI_CHAT_COST },
                'executions.activeReservation': null,
            },
            {
                $inc: {
                    'executions.balance': -AI_CHAT_COST,
                },
                $set: {
                    'executions.activeReservation': {
                        id: reservationId,
                        amount: AI_CHAT_COST,
                        reservedAt: now,
                        expiresAt,
                        feature: 'ai_chat',
                        compensationOps: {
                            inc: {},
                        },
                    },
                },
            },
            { new: true }
        );

        if (updated) {
            return {
                reservationId,
                userId,
                amount: AI_CHAT_COST,
                balanceAfterReserve: updated.executions.balance,
                expiresAt,
                feature: 'ai_chat',
            };
        }

        // Diagnostic read to distinguish failure cause.
        const user = await this.userModel.findById(userId, {
            'executions.balance': 1,
            'executions.activeReservation': 1,
        });

        if (!user) {
            throw new NotFoundException('User not found');
        }

        if (user.executions.activeReservation !== null) {
            throw new ConflictException({
                code: RESPONSE_CODE.EXECUTIONS_RESERVATION_ACTIVE,
                message: 'A reservation is already active',
            });
        }

        throw new BadRequestException({
            code: RESPONSE_CODE.INSUFFICIENT_EXECUTIONS,
            message: 'Insufficient executions',
        });
    }

    async commitChatRequest(
        ticket: ReservationTicket,
        userMessage: string,
        assistantContent: string
    ): Promise<{ balanceAfter: number }> {
        const result = await this.usersService.commitReservation({
            userId: ticket.userId,
            reservationId: ticket.reservationId,
            ledgerEntry: {
                type: EXECUTION_TRANSACTION_TYPE.DEBIT,
                action: EXECUTION_ACTION.AI_CHAT,
                amount: ticket.amount,
            },
            sideEffectInTx: async (session) => {
                await this.chatMessageModel.insertMany(
                    [
                        {
                            userId: new Types.ObjectId(ticket.userId),
                            role: 'user',
                            content: userMessage,
                        },
                        {
                            userId: new Types.ObjectId(ticket.userId),
                            role: 'assistant',
                            content: assistantContent,
                        },
                    ],
                    { session, ordered: true }
                );
            },
        });

        return {
            balanceAfter: result.balanceAfter,
        };
    }

    async refundChatRequest(ticket: ReservationTicket): Promise<void> {
        try {
            await this.usersService.refundReservation(
                ticket.userId,
                ticket.reservationId
            );
        } catch (err) {
            this.logger.error(
                `Failed to refund reservation ${ticket.reservationId} for user ${ticket.userId}: ${(err as Error).message}`
            );
        }
    }

    async getHistory(userId: string): Promise<
        Array<{
            id: string;
            role: 'user' | 'assistant';
            content: string;
            createdAt: Date;
        }>
    > {
        const messages = await this.chatMessageModel
            .find({ userId: new Types.ObjectId(userId) })
            .sort({ createdAt: 1, _id: 1 })
            .lean();

        return messages.map((m) => ({
            id: m._id.toString(),
            role: m.role as 'user' | 'assistant',
            content: m.content,
            createdAt: m.createdAt,
        }));
    }

    async clearHistory(userId: string): Promise<void> {
        await this.chatMessageModel.deleteMany({
            userId: new Types.ObjectId(userId),
        });
    }
}
