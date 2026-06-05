import type { AiChatSSEEvent } from '@finly/types';

import { ENV } from '@/shared/config';

/**
 * Публічний endpoint AI-помічника довідки (Sprint 16). Без auth, без
 * списання executions, без запису історії. Шлях має збігатися з backend-ом,
 * коли той приземлиться.
 */
export const HELP_CHAT_ENDPOINT = '/ai/help/chat';

/**
 * Коди, які фронт обробляє окремими станами. `AI_HELP_BUDGET_EXHAUSTED` це
 * глобальний денний circuit-breaker (degradation на статику), решта існує у
 * контракті AI-модуля.
 */
export const HELP_CHAT_CODE = {
    RATE_LIMIT: 'AI_RATE_LIMIT_EXCEEDED',
    BUDGET_EXHAUSTED: 'AI_HELP_BUDGET_EXHAUSTED',
    MESSAGE_TOO_LONG: 'AI_MESSAGE_TOO_LONG',
} as const;

export class HelpChatError extends Error {
    constructor(
        public readonly code: string,
        public readonly status: number
    ) {
        super(`Help chat error: ${code} (${status})`);
        this.name = 'HelpChatError';
    }
}

export interface HelpChatHistoryItem {
    role: 'user' | 'assistant';
    content: string;
}

async function parseErrorCode(response: Response): Promise<string> {
    try {
        const body = await response.json();
        return body?.error?.code ?? body?.code ?? 'INTERNAL_ERROR';
    } catch {
        return 'INTERNAL_ERROR';
    }
}

async function readSSEStream(
    response: Response,
    onEvent: (event: AiChatSSEEvent) => void
): Promise<void> {
    const reader = response.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data:')) continue;

                const json = trimmed.slice(5).trim();
                if (!json) continue;

                try {
                    onEvent(JSON.parse(json) as AiChatSSEEvent);
                } catch {
                    // ignore malformed events
                }
            }
        }
    } finally {
        reader.releaseLock();
    }
}

/**
 * Стрімить відповідь публічного помічника. Anon-контракт: native `fetch` з
 * `credentials: 'omit'` і без `Authorization` (симетрично `publicPostJson`),
 * щоб cabinet-credentials не просочилися. Історія тримається на клієнті і
 * дослається у запиті, бо сервер stateless.
 */
export async function streamHelpChat(
    message: string,
    history: HelpChatHistoryItem[],
    onEvent: (event: AiChatSSEEvent) => void,
    signal?: AbortSignal
): Promise<void> {
    const response = await fetch(
        `${ENV.NEXT_PUBLIC_API_URL}${HELP_CHAT_ENDPOINT}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, history }),
            credentials: 'omit',
            signal,
        }
    );

    if (!response.ok) {
        throw new HelpChatError(
            await parseErrorCode(response),
            response.status
        );
    }

    await readSSEStream(response, onEvent);
}
