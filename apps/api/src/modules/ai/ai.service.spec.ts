import { Test, TestingModule } from '@nestjs/testing';

import { AI_PROVIDER } from './interfaces/ai-provider.interface';
import { AiService } from './ai.service';

jest.mock('../../config/env', () => ({
    ENV: {
        HELP_CHAT_MAX_TOKENS: 400,
    },
}));

const mockAiProvider = {
    streamChat: jest.fn(),
};

describe('AiService', () => {
    let service: AiService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AiService,
                { provide: AI_PROVIDER, useValue: mockAiProvider },
            ],
        }).compile();

        service = module.get<AiService>(AiService);
        jest.clearAllMocks();
    });

    describe('buildHelpChatMessages', () => {
        it('returns just the current user message when history is empty', () => {
            expect(service.buildHelpChatMessages('hello', [])).toEqual([
                { role: 'user', content: 'hello' },
            ]);
        });

        it('appends the current message as the final user turn', () => {
            const result = service.buildHelpChatMessages('now', [
                { role: 'user', content: 'a' },
                { role: 'assistant', content: 'b' },
            ]);

            expect(result).toEqual([
                { role: 'user', content: 'a' },
                { role: 'assistant', content: 'b' },
                { role: 'user', content: 'now' },
            ]);
        });

        it('drops a leading assistant so the sequence starts with user', () => {
            const result = service.buildHelpChatMessages('now', [
                { role: 'assistant', content: 'leading' },
                { role: 'user', content: 'b' },
            ]);

            expect(result[0]).toEqual({ role: 'user', content: 'b' });
            expect(result[result.length - 1]).toEqual({
                role: 'user',
                content: 'now',
            });
        });

        it('caps history to the most recent allowed window', () => {
            const history = Array.from({ length: 25 }, (_, i) => ({
                role: 'user' as const,
                content: `msg-${i}`,
            }));

            const result = service.buildHelpChatMessages('current', history);

            expect(result).toHaveLength(21);
            expect(result[0]).toEqual({ role: 'user', content: 'msg-5' });
            expect(result[20]).toEqual({ role: 'user', content: 'current' });
        });
    });

    describe('streamHelpChat', () => {
        it('forwards to provider with help prompt and help max tokens', async () => {
            mockAiProvider.streamChat.mockResolvedValue('help-stream');
            const signal = new AbortController().signal;
            const messages = [{ role: 'user' as const, content: 'hi' }];

            const result = await service.streamHelpChat(messages, signal);

            expect(result).toBe('help-stream');
            expect(mockAiProvider.streamChat).toHaveBeenCalledWith(
                messages,
                expect.any(String),
                400,
                signal
            );
        });
    });
});
