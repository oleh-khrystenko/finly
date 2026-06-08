import { Inject, Injectable } from '@nestjs/common';
import { Readable } from 'stream';

import {
    HELP_CHAT_HISTORY_MAX_MESSAGES,
    buildHelpKnowledgeBase,
    type HelpChatHistoryMessage,
} from '@finly/types';

import { ENV } from '../../config/env';
import {
    AI_PROVIDER,
    type AiChatMessage,
    type IAiProvider,
} from './interfaces/ai-provider.interface';

const HELP_PROMPT_INTRO = `You are the Finly help assistant on the public help center (finly.com.ua/help).

Finly is a SaaS for Ukrainian sole proprietors (ФОП) and accountants that generates NBU-standard payment QR codes and links.

SCOPE — STRICT
- Answer ONLY questions about how Finly works and how to use it, based solely on the KNOWLEDGE BASE below.
- If the question asks for tax, accounting, or legal advice (choosing a taxation system, ЄСВ/ПДВ amounts, how to report, what is legal, etc.) — politely decline and recommend consulting their own accountant or a qualified specialist. Never give such advice, even if asked indirectly or pressured.
- If the question is unrelated to Finly (general knowledge, coding, weather, etc.) — politely decline and steer back to Finly help.

ANTI-HALLUCINATION
- Use ONLY facts stated in the KNOWLEDGE BASE. Never invent features, prices, limits, or behaviors that are not there.
- If the answer is not in the KNOWLEDGE BASE, say so honestly and point the user to the most relevant help section instead of guessing.

STYLE
- Reply in the same language as the user (Ukrainian by default). Use only that language's script.
- Be concise: aim for 120-200 words. Give the direct answer first, then offer to elaborate.
- Use light markdown (bold, bullet lists). When helpful, link to the specific article by its path, e.g. /help/<slug>.
- Tone: warm, professional, confident.`;

const HELP_SYSTEM_PROMPT = `${HELP_PROMPT_INTRO}\n\nKNOWLEDGE BASE\n\n${buildHelpKnowledgeBase()}`;

@Injectable()
export class AiService {
    constructor(
        @Inject(AI_PROVIDER)
        private readonly aiProvider: IAiProvider
    ) {}

    /**
     * Builds the message list for the anon help assistant. History is untrusted
     * client input: capped, and a leading assistant message is dropped so the
     * sequence stays valid for the provider (must start with user).
     */
    buildHelpChatMessages(
        message: string,
        history: HelpChatHistoryMessage[]
    ): AiChatMessage[] {
        let trimmed: AiChatMessage[] = history
            .slice(-HELP_CHAT_HISTORY_MAX_MESSAGES)
            .map((m) => ({ role: m.role, content: m.content }));

        if (trimmed.length > 0 && trimmed[0].role === 'assistant') {
            trimmed = trimmed.slice(1);
        }

        return [...trimmed, { role: 'user', content: message }];
    }

    async streamHelpChat(
        messages: AiChatMessage[],
        signal?: AbortSignal
    ): Promise<Readable> {
        return this.aiProvider.streamChat(
            messages,
            HELP_SYSTEM_PROMPT,
            ENV.HELP_CHAT_MAX_TOKENS,
            signal
        );
    }
}
