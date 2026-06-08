import { Readable } from 'stream';

export interface AiChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

export interface IAiProvider {
    streamChat(
        messages: AiChatMessage[],
        systemPrompt: string,
        maxTokens: number,
        signal?: AbortSignal
    ): Promise<Readable>;
}

export const AI_PROVIDER = Symbol('AI_PROVIDER');
