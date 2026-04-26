import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { Readable } from 'stream';

import { ENV } from '../../../config/env';
import type {
    AiChatMessage,
    IAiProvider,
} from '../interfaces/ai-provider.interface';

const MODEL = 'claude-haiku-4-5-20251001';
const CONTEXT_WINDOW = 200_000;

function buildRequestShape(
    messages: AiChatMessage[],
    systemPrompt: string
): {
    system: Anthropic.TextBlockParam[];
    messages: Anthropic.MessageParam[];
} {
    const system: Anthropic.TextBlockParam[] = [
        {
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' },
        },
    ];

    const anthropicMessages: Anthropic.MessageParam[] = messages.map((m, i) => {
        const isLastHistoryMessage =
            messages.length > 1 && i === messages.length - 2;
        if (isLastHistoryMessage) {
            return {
                role: m.role,
                content: [
                    {
                        type: 'text' as const,
                        text: m.content,
                        cache_control: {
                            type: 'ephemeral' as const,
                        },
                    },
                ],
            };
        }
        return { role: m.role, content: m.content };
    });

    return { system, messages: anthropicMessages };
}

@Injectable()
export class AnthropicService implements IAiProvider {
    private readonly client: Anthropic;

    readonly contextWindow = CONTEXT_WINDOW;

    constructor() {
        this.client = new Anthropic({ apiKey: ENV.ANTHROPIC_API_KEY });
    }

    async countTokens(
        messages: AiChatMessage[],
        systemPrompt: string
    ): Promise<number> {
        const shape = buildRequestShape(messages, systemPrompt);
        const result = await this.client.messages.countTokens({
            model: MODEL,
            system: shape.system,
            messages: shape.messages,
        });
        return result.input_tokens;
    }

    streamChat(
        messages: AiChatMessage[],
        systemPrompt: string,
        maxTokens: number,
        signal?: AbortSignal
    ): Promise<Readable> {
        const shape = buildRequestShape(messages, systemPrompt);

        const messageStream = this.client.messages.stream(
            {
                model: MODEL,
                max_tokens: maxTokens,
                system: shape.system,
                messages: shape.messages,
            },
            { signal }
        );

        const readable = new Readable({
            objectMode: true,
            read() {},
        });

        messageStream.on('text', (text) => {
            readable.push(text);
        });

        messageStream.on('end', () => {
            readable.push(null);
        });

        messageStream.on('error', (err) => {
            readable.destroy(err);
        });

        return Promise.resolve(readable);
    }
}
