import { z } from 'zod';

// --- Constants ---

/** Execution cost per AI chat message */
export const AI_CHAT_COST = 200;

/** Maximum length of user message */
export const AI_CHAT_MESSAGE_MAX_LENGTH = 500;

/** Free AI requests per account (lifetime) */
export const AI_CHAT_FREE_LIMIT = 5;

/** One-time bonus AI requests granted via brief form */
export const AI_CHAT_BONUS_AMOUNT = 5;

/** Reservation TTL in milliseconds (5 minutes) */
export const AI_CHAT_RESERVATION_TTL_MS = 5 * 60 * 1000;

// --- Request Schema ---

export const AiChatRequestSchema = z.object({
    message: z.string().trim().min(1).max(AI_CHAT_MESSAGE_MAX_LENGTH),
});

export type AiChatRequest = z.infer<typeof AiChatRequestSchema>;

// --- SSE Event Types ---

export const AI_CHAT_EVENT = {
    TOKEN: 'token',
    ERROR: 'error',
    DONE: 'done',
} as const;

export interface AiChatTokenEvent {
    type: typeof AI_CHAT_EVENT.TOKEN;
    content: string;
}

export interface AiChatErrorEvent {
    type: typeof AI_CHAT_EVENT.ERROR;
    code: string;
}

export interface AiChatDoneEvent {
    type: typeof AI_CHAT_EVENT.DONE;
    balanceAfter: number;
    aiRequestsRemaining: number;
}

export type AiChatSSEEvent =
    | AiChatTokenEvent
    | AiChatErrorEvent
    | AiChatDoneEvent;

// --- Persisted Message Types ---

export const ChatMessageSchema = z.object({
    id: z.string(),
    role: z.enum(['user', 'assistant']),
    content: z.string(),
    createdAt: z.coerce.date(),
});

export type ChatMessageItem = z.infer<typeof ChatMessageSchema>;

export const ChatHistorySchema = z.object({
    messages: z.array(ChatMessageSchema),
});

export type ChatHistory = z.infer<typeof ChatHistorySchema>;
