import { z } from 'zod';

// --- Constants ---

/** Maximum length of a user message to the public help assistant. */
export const HELP_CHAT_MESSAGE_MAX_LENGTH = 500;

/** Max messages of client-sent history accepted (anti-injection / payload cap). */
export const HELP_CHAT_HISTORY_MAX_MESSAGES = 20;

/** Max length of a single history message (assistant answers can be long). */
export const HELP_CHAT_HISTORY_CONTENT_MAX_LENGTH = 4000;

// --- Request Schema ---

export const HelpChatHistoryMessageSchema = z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(HELP_CHAT_HISTORY_CONTENT_MAX_LENGTH),
});

export type HelpChatHistoryMessage = z.infer<
    typeof HelpChatHistoryMessageSchema
>;

/**
 * Public help assistant request. `history` is untrusted client-held context
 * (anon endpoint is stateless server-side); capped in count and per-message
 * length. Defaults to empty for the first turn.
 */
export const HelpChatRequestSchema = z.object({
    message: z.string().trim().min(1).max(HELP_CHAT_MESSAGE_MAX_LENGTH),
    history: z
        .array(HelpChatHistoryMessageSchema)
        .max(HELP_CHAT_HISTORY_MAX_MESSAGES)
        .default([]),
});

export type HelpChatRequest = z.infer<typeof HelpChatRequestSchema>;

// --- SSE Event Types ---

export const HELP_CHAT_EVENT = {
    TOKEN: 'token',
    ERROR: 'error',
    DONE: 'done',
} as const;

export interface HelpChatTokenEvent {
    type: typeof HELP_CHAT_EVENT.TOKEN;
    content: string;
}

export interface HelpChatErrorEvent {
    type: typeof HELP_CHAT_EVENT.ERROR;
    code: string;
}

/**
 * Help-chat DONE carries no balance: anon endpoint does not spend executions.
 */
export interface HelpChatDoneEvent {
    type: typeof HELP_CHAT_EVENT.DONE;
}

export type HelpChatSSEEvent =
    | HelpChatTokenEvent
    | HelpChatErrorEvent
    | HelpChatDoneEvent;
