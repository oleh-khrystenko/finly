import type { ChatMessageItem, AiChatSSEEvent } from '@finly/types';

import { apiClient, getAccessToken, setAccessToken } from './client';
import { ENV } from '@/shared/config';
import { getTimezone } from '@/shared/lib';

export class AiChatError extends Error {
    constructor(
        public readonly code: string,
        public readonly status: number
    ) {
        super(`AI Chat error: ${code} (${status})`);
        this.name = 'AiChatError';
    }
}

async function doStreamRequest(
    message: string,
    signal?: AbortSignal
): Promise<Response> {
    const token = getAccessToken();

    return fetch(`${ENV.NEXT_PUBLIC_API_URL}/ai/chat`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({ message }),
        signal,
        credentials: 'include',
    });
}

async function tryRefreshToken(): Promise<boolean> {
    try {
        const response = await fetch(
            `${ENV.NEXT_PUBLIC_API_URL}/auth/refresh`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ timezone: getTimezone() }),
                credentials: 'include',
            }
        );

        if (!response.ok) return false;

        const body = await response.json();
        const newToken = body?.data?.accessToken;
        if (!newToken) return false;

        setAccessToken(newToken);
        return true;
    } catch {
        return false;
    }
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
                    const event = JSON.parse(json) as AiChatSSEEvent;
                    onEvent(event);
                } catch {
                    // ignore malformed events
                }
            }
        }
    } finally {
        reader.releaseLock();
    }
}

export async function streamAiChat(
    message: string,
    onEvent: (event: AiChatSSEEvent) => void,
    signal?: AbortSignal
): Promise<void> {
    let response = await doStreamRequest(message, signal);

    // Handle expired access token: refresh once and retry
    if (response.status === 401) {
        const refreshed = await tryRefreshToken();
        if (!refreshed) {
            throw new AiChatError('UNAUTHORIZED', 401);
        }
        response = await doStreamRequest(message, signal);
    }

    if (!response.ok) {
        const code = await parseErrorCode(response);
        throw new AiChatError(code, response.status);
    }

    await readSSEStream(response, onEvent);
}

export async function getChatHistory(): Promise<ChatMessageItem[]> {
    const { data } = await apiClient.get<{
        data: { messages: ChatMessageItem[] };
    }>('/ai/chat/history');
    return data.data.messages;
}

export async function clearChatHistory(): Promise<void> {
    await apiClient.delete('/ai/chat/history');
}
