import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { RESPONSE_CODE } from '@cyanship/types';

import { User } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { ChatMessage } from './schemas/chat-message.schema';
import { AI_PROVIDER } from './interfaces/ai-provider.interface';
import { AiService } from './ai.service';

jest.mock('../../config/env', () => ({
    ENV: {
        AI_CHAT_MAX_TOKENS: 800,
        AI_CHAT_FREE_LIMIT: 5,
        AI_CHAT_BONUS_AMOUNT: 5,
        AI_CHAT_IP_LIMIT: 20,
    },
}));

const mockUserModel = {
    findOneAndUpdate: jest.fn(),
    findById: jest.fn(),
};

function createFindChain(result: unknown[] = []) {
    const chain: Record<string, jest.Mock> = {};
    chain.sort = jest.fn().mockReturnValue(chain);
    chain.limit = jest.fn().mockReturnValue(chain);
    chain.select = jest.fn().mockReturnValue(chain);
    chain.lean = jest.fn().mockResolvedValue(result);
    return chain;
}

const mockChatMessageModel = {
    find: jest.fn().mockReturnValue(createFindChain()),
    insertMany: jest.fn(),
    deleteMany: jest.fn(),
};

const mockAiProvider = {
    contextWindow: 200_000,
    countTokens: jest.fn().mockResolvedValue(500),
    streamChat: jest.fn(),
};

const mockUsersService = {
    commitReservation: jest.fn(),
    refundReservation: jest.fn(),
};

describe('AiService', () => {
    let service: AiService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AiService,
                { provide: getModelToken(User.name), useValue: mockUserModel },
                {
                    provide: getModelToken(ChatMessage.name),
                    useValue: mockChatMessageModel,
                },
                { provide: AI_PROVIDER, useValue: mockAiProvider },
                { provide: UsersService, useValue: mockUsersService },
            ],
        }).compile();

        service = module.get<AiService>(AiService);
        jest.clearAllMocks();
    });

    describe('reserveChatRequest', () => {
        const userId = '507f1f77bcf86cd799439011';

        it('should reserve successfully and return ticket with all fields', async () => {
            mockUserModel.findOneAndUpdate.mockResolvedValue({
                executions: { balance: 800 },
                ai: { requestsUsed: 3, bonusGranted: false },
            });

            const ticket = await service.reserveChatRequest(userId);

            expect(ticket.userId).toBe(userId);
            expect(ticket.amount).toBe(200);
            expect(ticket.feature).toBe('ai_chat');
            expect(ticket.balanceAfterReserve).toBe(800);
            expect(ticket.aiRequestsUsedAfterReserve).toBe(3);
            expect(ticket.bonusGranted).toBe(false);
            expect(ticket.reservationId).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
            );
            expect(ticket.expiresAt.getTime()).toBeGreaterThan(Date.now());
        });

        it('should use atomic findOneAndUpdate with correct filter', async () => {
            mockUserModel.findOneAndUpdate.mockResolvedValue({
                executions: { balance: 800 },
                ai: { requestsUsed: 1, bonusGranted: false },
            });

            await service.reserveChatRequest(userId);

            const [filter, update, options] =
                mockUserModel.findOneAndUpdate.mock.calls[0];

            expect(filter._id).toBe(userId);
            expect(filter['executions.balance']).toEqual({ $gte: 200 });
            expect(filter['executions.activeReservation']).toBeNull();
            expect(filter.$expr).toBeDefined();
            expect(update.$inc).toEqual({
                'executions.balance': -200,
                'ai.requestsUsed': 1,
            });
            expect(
                update.$set['executions.activeReservation'].compensationOps
            ).toEqual({ inc: { 'ai.requestsUsed': -1 } });
            expect(options).toEqual({ new: true });
        });

        it('should throw INSUFFICIENT_EXECUTIONS when balance is too low', async () => {
            mockUserModel.findOneAndUpdate.mockResolvedValue(null);
            mockUserModel.findById.mockResolvedValue({
                executions: { balance: 50, activeReservation: null },
                ai: { requestsUsed: 0, bonusGranted: false },
            });

            await expect(service.reserveChatRequest(userId)).rejects.toThrow(
                BadRequestException
            );
            await expect(
                service.reserveChatRequest(userId)
            ).rejects.toMatchObject({
                response: { code: RESPONSE_CODE.INSUFFICIENT_EXECUTIONS },
            });
        });

        it('should throw EXECUTIONS_RESERVATION_ACTIVE when another reservation exists', async () => {
            mockUserModel.findOneAndUpdate.mockResolvedValue(null);
            mockUserModel.findById.mockResolvedValue({
                executions: {
                    balance: 1000,
                    activeReservation: { id: 'existing-uuid' },
                },
                ai: { requestsUsed: 0, bonusGranted: false },
            });

            await expect(service.reserveChatRequest(userId)).rejects.toThrow(
                ConflictException
            );
            await expect(
                service.reserveChatRequest(userId)
            ).rejects.toMatchObject({
                response: {
                    code: RESPONSE_CODE.EXECUTIONS_RESERVATION_ACTIVE,
                },
            });
        });

        it('should throw AI_LIMIT_EXHAUSTED when lifetime limit reached', async () => {
            mockUserModel.findOneAndUpdate.mockResolvedValue(null);
            mockUserModel.findById.mockResolvedValue({
                executions: { balance: 1000, activeReservation: null },
                ai: { requestsUsed: 5, bonusGranted: false },
            });

            await expect(service.reserveChatRequest(userId)).rejects.toThrow(
                ForbiddenException
            );
            await expect(
                service.reserveChatRequest(userId)
            ).rejects.toMatchObject({
                response: { code: RESPONSE_CODE.AI_LIMIT_EXHAUSTED },
            });
        });

        it('should throw NotFoundException when user does not exist', async () => {
            mockUserModel.findOneAndUpdate.mockResolvedValue(null);
            mockUserModel.findById.mockResolvedValue(null);

            await expect(service.reserveChatRequest(userId)).rejects.toThrow(
                NotFoundException
            );
        });

        it('should allow user with bonus when requestsUsed equals free limit', async () => {
            mockUserModel.findOneAndUpdate.mockResolvedValue({
                executions: { balance: 800 },
                ai: { requestsUsed: 6, bonusGranted: true },
            });

            const ticket = await service.reserveChatRequest(userId);

            expect(ticket.aiRequestsUsedAfterReserve).toBe(6);
            expect(ticket.bonusGranted).toBe(true);
        });

        it('should handle null ai subdocument', async () => {
            mockUserModel.findOneAndUpdate.mockResolvedValue({
                executions: { balance: 800 },
                ai: null,
            });

            const ticket = await service.reserveChatRequest(userId);

            expect(ticket.aiRequestsUsedAfterReserve).toBe(0);
            expect(ticket.bonusGranted).toBe(false);
        });
    });

    describe('commitChatRequest', () => {
        const ticket = {
            reservationId: 'test-uuid',
            userId: '507f1f77bcf86cd799439011',
            amount: 200,
            balanceAfterReserve: 800,
            expiresAt: new Date(Date.now() + 300_000),
            feature: 'ai_chat' as const,
            aiRequestsUsedAfterReserve: 3,
            bonusGranted: false,
        };

        it('should call usersService.commitReservation with correct params', async () => {
            mockUsersService.commitReservation.mockResolvedValue({
                balanceAfter: 800,
            });

            await service.commitChatRequest(ticket, 'hello', 'hi there');

            expect(mockUsersService.commitReservation).toHaveBeenCalledWith({
                userId: ticket.userId,
                reservationId: ticket.reservationId,
                ledgerEntry: {
                    type: 'debit',
                    action: 'ai_chat',
                    amount: 200,
                },
                sideEffectInTx: expect.any(Function),
            });
        });

        it('should compute aiRequestsRemaining correctly (no bonus)', async () => {
            mockUsersService.commitReservation.mockResolvedValue({
                balanceAfter: 800,
            });

            const result = await service.commitChatRequest(
                ticket,
                'hello',
                'response'
            );

            // limit=5, used=3 → remaining=2
            expect(result.aiRequestsRemaining).toBe(2);
            expect(result.balanceAfter).toBe(800);
        });

        it('should compute aiRequestsRemaining correctly (with bonus)', async () => {
            mockUsersService.commitReservation.mockResolvedValue({
                balanceAfter: 600,
            });

            const result = await service.commitChatRequest(
                {
                    ...ticket,
                    bonusGranted: true,
                    aiRequestsUsedAfterReserve: 8,
                },
                'hello',
                'response'
            );

            // limit=5+5=10, used=8 → remaining=2
            expect(result.aiRequestsRemaining).toBe(2);
        });

        it('should propagate commitReservation errors', async () => {
            mockUsersService.commitReservation.mockRejectedValue(
                new Error('Reservation not found or already closed')
            );

            await expect(
                service.commitChatRequest(ticket, 'hello', 'response')
            ).rejects.toThrow('Reservation not found or already closed');
        });

        it('should pass sideEffectInTx that inserts chat messages', async () => {
            mockUsersService.commitReservation.mockImplementation(
                async (opts: {
                    sideEffectInTx?: (s: unknown) => Promise<void>;
                }) => {
                    if (opts.sideEffectInTx) {
                        await opts.sideEffectInTx('mock-session');
                    }
                    return { balanceAfter: 800 };
                }
            );
            mockChatMessageModel.insertMany.mockResolvedValue([]);

            await service.commitChatRequest(ticket, 'user msg', 'ai response');

            expect(mockChatMessageModel.insertMany).toHaveBeenCalledWith(
                [
                    expect.objectContaining({
                        role: 'user',
                        content: 'user msg',
                    }),
                    expect.objectContaining({
                        role: 'assistant',
                        content: 'ai response',
                    }),
                ],
                { session: 'mock-session', ordered: true }
            );
        });
    });

    describe('refundChatRequest', () => {
        const ticket = {
            reservationId: 'test-uuid',
            userId: '507f1f77bcf86cd799439011',
            amount: 200,
            balanceAfterReserve: 800,
            expiresAt: new Date(Date.now() + 300_000),
            feature: 'ai_chat' as const,
            aiRequestsUsedAfterReserve: 3,
            bonusGranted: false,
        };

        it('should call usersService.refundReservation', async () => {
            mockUsersService.refundReservation.mockResolvedValue(undefined);

            await service.refundChatRequest(ticket);

            expect(mockUsersService.refundReservation).toHaveBeenCalledWith(
                ticket.userId,
                ticket.reservationId
            );
        });

        it('should not propagate errors (catches internally)', async () => {
            mockUsersService.refundReservation.mockRejectedValue(
                new Error('DB down')
            );

            // Should not throw
            await service.refundChatRequest(ticket);
        });

        it('should be safe to call multiple times', async () => {
            mockUsersService.refundReservation.mockResolvedValue(undefined);

            await service.refundChatRequest(ticket);
            await service.refundChatRequest(ticket);

            expect(mockUsersService.refundReservation).toHaveBeenCalledTimes(2);
        });
    });

    describe('buildChatMessages', () => {
        const userId = '507f1f77bcf86cd799439011';

        it('should return history + new message', async () => {
            const history = [
                { role: 'assistant', content: 'hi there' },
                { role: 'user', content: 'hello' },
            ];
            mockChatMessageModel.find.mockReturnValue(createFindChain(history));

            const result = await service.buildChatMessages(
                userId,
                'new question'
            );

            expect(result).toEqual([
                { role: 'user', content: 'hello' },
                { role: 'assistant', content: 'hi there' },
                { role: 'user', content: 'new question' },
            ]);
        });

        it('should return only new message when no history', async () => {
            mockChatMessageModel.find.mockReturnValue(createFindChain([]));

            const result = await service.buildChatMessages(
                userId,
                'first message'
            );

            expect(result).toEqual([
                { role: 'user', content: 'first message' },
            ]);
        });

        it('should drop leading assistant message from truncated history', async () => {
            const history = [
                { role: 'assistant', content: 'reply' },
                { role: 'user', content: 'follow-up' },
                { role: 'assistant', content: 'orphaned response' },
            ];
            mockChatMessageModel.find.mockReturnValue(createFindChain(history));

            const result = await service.buildChatMessages(userId, 'next');

            expect(result[0].role).toBe('user');
            expect(result).toHaveLength(3);
        });

        it('should limit history to most recent messages', async () => {
            mockChatMessageModel.find.mockReturnValue(createFindChain([]));

            await service.buildChatMessages(userId, 'msg');

            const findChain = mockChatMessageModel.find.mock.results[0].value;
            expect(findChain.sort).toHaveBeenCalledWith({
                createdAt: -1,
                _id: -1,
            });
            expect(findChain.limit).toHaveBeenCalledWith(50);
        });

        it('should truncate history when countTokens exceeds budget', async () => {
            const history = [
                { role: 'assistant', content: 'reply-4' },
                { role: 'user', content: 'q4' },
                { role: 'assistant', content: 'reply-3' },
                { role: 'user', content: 'q3' },
                { role: 'assistant', content: 'reply-2' },
                { role: 'user', content: 'q2' },
                { role: 'assistant', content: 'reply-1' },
                { role: 'user', content: 'q1' },
            ];
            mockChatMessageModel.find.mockReturnValue(createFindChain(history));

            const inputBudget = mockAiProvider.contextWindow - 800;
            mockAiProvider.countTokens
                .mockResolvedValueOnce(inputBudget + 5000)
                .mockResolvedValueOnce(inputBudget - 100);

            const result = await service.buildChatMessages(userId, 'new msg');

            expect(mockAiProvider.countTokens).toHaveBeenCalledTimes(2);
            expect(result.length).toBeLessThan(9);
            expect(result[0].role).toBe('user');
            expect(result[result.length - 1].content).toBe('new msg');
        });

        it('should not truncate when within budget', async () => {
            const history = [
                { role: 'assistant', content: 'reply' },
                { role: 'user', content: 'hello' },
            ];
            mockChatMessageModel.find.mockReturnValue(createFindChain(history));
            mockAiProvider.countTokens.mockResolvedValue(500);

            const result = await service.buildChatMessages(userId, 'new msg');

            expect(mockAiProvider.countTokens).toHaveBeenCalledTimes(1);
            expect(result).toHaveLength(3);
        });

        it('should ensure user-first after truncation removes leading assistant', async () => {
            const history = [
                { role: 'user', content: 'q3' },
                { role: 'assistant', content: 'r2' },
                { role: 'user', content: 'q2' },
                { role: 'assistant', content: 'r1' },
                { role: 'user', content: 'q1' },
            ];
            mockChatMessageModel.find.mockReturnValue(createFindChain(history));

            const inputBudget = mockAiProvider.contextWindow - 800;
            mockAiProvider.countTokens
                .mockResolvedValueOnce(inputBudget + 1000)
                .mockResolvedValueOnce(inputBudget - 100);

            const result = await service.buildChatMessages(userId, 'new');

            expect(result[0].role).toBe('user');
        });

        it('should never drop current user message during truncation', async () => {
            const history = [
                { role: 'user', content: 'q2' },
                { role: 'assistant', content: 'r1' },
                { role: 'user', content: 'q1' },
            ];
            mockChatMessageModel.find.mockReturnValue(createFindChain(history));

            const inputBudget = mockAiProvider.contextWindow - 800;
            mockAiProvider.countTokens
                .mockResolvedValueOnce(inputBudget + 5000)
                .mockResolvedValueOnce(inputBudget + 2000)
                .mockResolvedValueOnce(inputBudget - 100);

            const result = await service.buildChatMessages(
                userId,
                'current msg'
            );

            expect(result[result.length - 1].content).toBe('current msg');
            expect(result[result.length - 1].role).toBe('user');
        });

        it('should throw AI_MESSAGE_TOO_LONG when single message exceeds budget', async () => {
            mockChatMessageModel.find.mockReturnValue(createFindChain([]));

            const inputBudget = mockAiProvider.contextWindow - 800;
            mockAiProvider.countTokens.mockResolvedValue(inputBudget + 1000);

            await expect(
                service.buildChatMessages(userId, 'huge message')
            ).rejects.toMatchObject({
                response: { code: 'AI_MESSAGE_TOO_LONG' },
            });
        });
    });

    describe('streamChat', () => {
        it('should forward messages and signal to provider', async () => {
            mockAiProvider.streamChat.mockResolvedValue('mock-stream');
            const signal = new AbortController().signal;
            const messages = [{ role: 'user' as const, content: 'hello' }];

            const result = await service.streamChat(messages, signal);

            expect(result).toBe('mock-stream');
            expect(mockAiProvider.streamChat).toHaveBeenCalledWith(
                messages,
                expect.any(String),
                800,
                signal
            );
        });
    });
});
