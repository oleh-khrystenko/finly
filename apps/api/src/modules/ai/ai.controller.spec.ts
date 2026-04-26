import { Test, TestingModule } from '@nestjs/testing';
import { Readable } from 'stream';
import { EventEmitter } from 'events';

import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiRateLimitGuard } from './guards/ai-rate-limit.guard';
import type { AiChatReservationTicket } from './interfaces/ai-chat-reservation';

const mockTicket: AiChatReservationTicket = {
    reservationId: 'test-reservation-uuid',
    userId: '507f1f77bcf86cd799439011',
    amount: 200,
    balanceAfterReserve: 800,
    expiresAt: new Date(Date.now() + 300_000),
    feature: 'ai_chat',
    aiRequestsUsedAfterReserve: 3,
    bonusGranted: false,
};

const mockAiService = {
    reserveChatRequest: jest.fn(),
    buildChatMessages: jest.fn(),
    streamChat: jest.fn(),
    commitChatRequest: jest.fn(),
    refundChatRequest: jest.fn(),
    getHistory: jest.fn(),
    clearHistory: jest.fn(),
};

const buildReq = () => {
    const req = new EventEmitter() as EventEmitter & {
        on: (
            event: string,
            listener: (...args: unknown[]) => void
        ) => EventEmitter;
        off: (
            event: string,
            listener: (...args: unknown[]) => void
        ) => EventEmitter;
    };
    return req;
};

const buildRes = () => {
    const chunks: string[] = [];
    return {
        setHeader: jest.fn(),
        flushHeaders: jest.fn(),
        write: jest.fn((data: string) => chunks.push(data)),
        end: jest.fn(),
        writableEnded: false,
        socket: { setNoDelay: jest.fn() },
        chunks,
    };
};

const buildUser = () =>
    ({ _id: { toString: () => '507f1f77bcf86cd799439011' } }) as never;

describe('AiController', () => {
    let controller: AiController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [AiController],
            providers: [{ provide: AiService, useValue: mockAiService }],
        })
            .overrideGuard(AiRateLimitGuard)
            .useValue({ canActivate: () => true })
            .compile();

        controller = module.get<AiController>(AiController);
        jest.clearAllMocks();
        mockAiService.buildChatMessages.mockResolvedValue([
            { role: 'user', content: 'hello' },
        ]);
    });

    describe('chat — exit matrix', () => {
        it('Happy path: reserve → stream → commit → DONE', async () => {
            mockAiService.reserveChatRequest.mockResolvedValue(mockTicket);
            mockAiService.streamChat.mockResolvedValue(
                Readable.from(['chunk1', 'chunk2', 'chunk3'])
            );
            mockAiService.commitChatRequest.mockResolvedValue({
                balanceAfter: 800,
                aiRequestsRemaining: 2,
            });

            const req = buildReq();
            const res = buildRes();

            await controller.chat(
                buildUser(),
                { message: 'hello' },
                req as never,
                res as never
            );

            // 3 TOKEN events + 1 DONE event
            expect(res.write).toHaveBeenCalledTimes(4);
            expect(res.chunks[0]).toContain('"type":"token"');
            expect(res.chunks[3]).toContain('"type":"done"');
            expect(mockAiService.commitChatRequest).toHaveBeenCalled();
            expect(mockAiService.refundChatRequest).not.toHaveBeenCalled();
            expect(res.end).toHaveBeenCalled();
        });

        it('Reserve fail (4xx): no SSE headers, exception propagates', async () => {
            mockAiService.reserveChatRequest.mockRejectedValue(
                new Error('Insufficient executions')
            );

            const req = buildReq();
            const res = buildRes();

            await expect(
                controller.chat(
                    buildUser(),
                    { message: 'hello' },
                    req as never,
                    res as never
                )
            ).rejects.toThrow('Insufficient executions');

            expect(res.flushHeaders).not.toHaveBeenCalled();
            expect(mockAiService.commitChatRequest).not.toHaveBeenCalled();
            expect(mockAiService.refundChatRequest).not.toHaveBeenCalled();
        });

        it('buildChatMessages fail after reserve: refund + propagate as HTTP error', async () => {
            mockAiService.reserveChatRequest.mockResolvedValue(mockTicket);
            mockAiService.buildChatMessages.mockRejectedValue(
                new Error('AI_MESSAGE_TOO_LONG')
            );
            mockAiService.refundChatRequest.mockResolvedValue(undefined);

            const req = buildReq();
            const res = buildRes();

            await expect(
                controller.chat(
                    buildUser(),
                    { message: 'huge message' },
                    req as never,
                    res as never
                )
            ).rejects.toThrow('AI_MESSAGE_TOO_LONG');

            expect(res.flushHeaders).not.toHaveBeenCalled();
            expect(mockAiService.refundChatRequest).toHaveBeenCalledWith(
                mockTicket
            );
            expect(mockAiService.streamChat).not.toHaveBeenCalled();
        });

        it('Client disconnect during buildChatMessages: refund, no SSE, no stream', async () => {
            mockAiService.reserveChatRequest.mockResolvedValue(mockTicket);
            mockAiService.refundChatRequest.mockResolvedValue(undefined);
            mockAiService.buildChatMessages.mockImplementation(
                () =>
                    new Promise((resolve) => {
                        setTimeout(
                            () => resolve([{ role: 'user', content: 'hello' }]),
                            50
                        );
                    })
            );

            const req = buildReq();
            const res = buildRes();

            const chatPromise = controller.chat(
                buildUser(),
                { message: 'hello' },
                req as never,
                res as never
            );

            // Let microtasks drain so req.on('close') is registered
            await new Promise((r) => setImmediate(r));

            // Client disconnects while buildChatMessages is pending
            req.emit('close');

            await chatPromise;

            expect(res.flushHeaders).not.toHaveBeenCalled();
            expect(mockAiService.refundChatRequest).toHaveBeenCalledWith(
                mockTicket
            );
            expect(mockAiService.streamChat).not.toHaveBeenCalled();
            expect(mockAiService.commitChatRequest).not.toHaveBeenCalled();
        });

        it('Provider error before first token: refund, SSE ERROR', async () => {
            mockAiService.reserveChatRequest.mockResolvedValue(mockTicket);
            mockAiService.streamChat.mockRejectedValue(
                new Error('Anthropic API down')
            );
            mockAiService.refundChatRequest.mockResolvedValue(undefined);

            const req = buildReq();
            const res = buildRes();

            await controller.chat(
                buildUser(),
                { message: 'hello' },
                req as never,
                res as never
            );

            expect(mockAiService.refundChatRequest).toHaveBeenCalledWith(
                mockTicket
            );
            expect(
                res.chunks.some((c: string) => c.includes('"type":"error"'))
            ).toBe(true);
            expect(mockAiService.commitChatRequest).not.toHaveBeenCalled();
        });

        it('Provider error after first token: refund, SSE ERROR', async () => {
            mockAiService.reserveChatRequest.mockResolvedValue(mockTicket);

            // Stream that yields one chunk then errors
            const errorStream = new Readable({
                read() {
                    this.push('chunk1');
                    this.destroy(new Error('Mid-stream failure'));
                },
            });
            mockAiService.streamChat.mockResolvedValue(errorStream);
            mockAiService.refundChatRequest.mockResolvedValue(undefined);

            const req = buildReq();
            const res = buildRes();

            await controller.chat(
                buildUser(),
                { message: 'hello' },
                req as never,
                res as never
            );

            expect(mockAiService.refundChatRequest).toHaveBeenCalled();
            expect(
                res.chunks.some((c: string) => c.includes('"type":"error"'))
            ).toBe(true);
        });

        it('Client abort before first token: refund, no DONE/ERROR', async () => {
            mockAiService.reserveChatRequest.mockResolvedValue(mockTicket);

            const slowStream = new Readable({ read() {} });
            mockAiService.streamChat.mockResolvedValue(slowStream);
            mockAiService.refundChatRequest.mockResolvedValue(undefined);

            const req = buildReq();
            const res = buildRes();

            const chatPromise = controller.chat(
                buildUser(),
                { message: 'hello' },
                req as never,
                res as never
            );

            // Let chat() reach the for-await loop (reserve + buildChatMessages + streamChat resolve, SSE headers set)
            await new Promise((r) => setImmediate(r));

            // Abort before any chunks, then end stream to unblock for-await
            req.emit('close');
            slowStream.push(null);

            await chatPromise;

            expect(mockAiService.refundChatRequest).toHaveBeenCalledWith(
                mockTicket
            );
            expect(mockAiService.commitChatRequest).not.toHaveBeenCalled();
            expect(
                res.chunks.some((c: string) => c.includes('"type":"done"'))
            ).toBe(false);
        });

        it('Client abort after first token: commit (non-refundable), no DONE', async () => {
            mockAiService.reserveChatRequest.mockResolvedValue(mockTicket);
            mockAiService.commitChatRequest.mockResolvedValue({
                balanceAfter: 800,
                aiRequestsRemaining: 2,
            });

            const controlledStream = new Readable({ read() {} });
            mockAiService.streamChat.mockResolvedValue(controlledStream);

            const req = buildReq();
            const res = buildRes();

            const chatPromise = controller.chat(
                buildUser(),
                { message: 'hello' },
                req as never,
                res as never
            );

            // Deliver first chunk
            controlledStream.push('chunk1');
            await new Promise((r) => setImmediate(r));

            // Abort after first token received
            req.emit('close');
            controlledStream.push(null);

            await chatPromise;

            expect(mockAiService.commitChatRequest).toHaveBeenCalled();
            expect(mockAiService.refundChatRequest).not.toHaveBeenCalled();
            expect(
                res.chunks.some((c: string) => c.includes('"type":"done"'))
            ).toBe(false);
        });

        it('Commit fails: refund called, SSE ERROR sent', async () => {
            mockAiService.reserveChatRequest.mockResolvedValue(mockTicket);
            mockAiService.streamChat.mockResolvedValue(
                Readable.from(['chunk1'])
            );
            mockAiService.commitChatRequest.mockRejectedValue(
                new Error('Reservation not found')
            );
            mockAiService.refundChatRequest.mockResolvedValue(undefined);

            const req = buildReq();
            const res = buildRes();

            await controller.chat(
                buildUser(),
                { message: 'hello' },
                req as never,
                res as never
            );

            expect(mockAiService.refundChatRequest).toHaveBeenCalledWith(
                mockTicket
            );
            expect(
                res.chunks.some((c: string) => c.includes('"type":"error"'))
            ).toBe(true);
        });

        it('Refund failure is silently handled — res.end still called', async () => {
            mockAiService.reserveChatRequest.mockResolvedValue(mockTicket);
            mockAiService.streamChat.mockRejectedValue(
                new Error('Provider down')
            );
            // refundChatRequest catches internally, so this just tests the finally block
            mockAiService.refundChatRequest.mockResolvedValue(undefined);

            const req = buildReq();
            const res = buildRes();

            await controller.chat(
                buildUser(),
                { message: 'hello' },
                req as never,
                res as never
            );

            expect(res.end).toHaveBeenCalled();
        });

        it('Client abort after first token + provider throws: commit with partial content (regression)', async () => {
            mockAiService.reserveChatRequest.mockResolvedValue(mockTicket);
            mockAiService.commitChatRequest.mockResolvedValue({
                balanceAfter: 800,
                aiRequestsRemaining: 2,
            });

            // Stream that yields one chunk then throws when aborted
            const abortStream = new Readable({ read() {} });
            mockAiService.streamChat.mockResolvedValue(abortStream);

            const req = buildReq();
            const res = buildRes();

            const chatPromise = controller.chat(
                buildUser(),
                { message: 'hello' },
                req as never,
                res as never
            );

            // Deliver partial content
            abortStream.push('partial-response');
            await new Promise((r) => setImmediate(r));

            // Client aborts → abort signal causes provider to throw
            req.emit('close');
            abortStream.destroy(new Error('The operation was aborted'));

            await chatPromise;

            // Must commit with the partial content, not empty string
            expect(mockAiService.commitChatRequest).toHaveBeenCalledWith(
                mockTicket,
                'hello',
                'partial-response'
            );
            expect(mockAiService.refundChatRequest).not.toHaveBeenCalled();
        });
    });
});
