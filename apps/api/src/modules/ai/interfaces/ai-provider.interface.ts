import { Readable } from 'stream';

export interface AiChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

export interface IAiProvider {
    readonly contextWindow: number;

    countTokens(
        messages: AiChatMessage[],
        systemPrompt: string
    ): Promise<number>;

    streamChat(
        messages: AiChatMessage[],
        systemPrompt: string,
        maxTokens: number,
        signal?: AbortSignal
    ): Promise<Readable>;
}

export const AI_PROVIDER = Symbol('AI_PROVIDER');
