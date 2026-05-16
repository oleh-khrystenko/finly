'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { toast } from 'sonner';
import { MessageSquare, Send, Trash2 } from 'lucide-react';
import {
    AI_CHAT_COST,
    AI_CHAT_EVENT,
    AI_CHAT_MESSAGE_MAX_LENGTH,
} from '@finly/types';

import UiButton from '@/shared/ui/UiButton';
import UiLink from '@/shared/ui/UiLink';
import { UiConfirmDialog } from '@/shared/ui/UiConfirmDialog';
import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiPageHeading from '@/shared/ui/UiPageHeading';
import UiSpinner from '@/shared/ui/UiSpinner';
import UiTextarea from '@/shared/ui/UiTextarea';
import {
    streamAiChat,
    getChatHistory,
    clearChatHistory,
    AiChatError,
    getApiMessage,
} from '@/shared/api';
import { useAuthStore } from '@/entities/user';
import { INTL_LOCALE } from '@/shared/lib';

interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
}

const SUGGESTIONS = [
    'З чим ти можеш допомогти?',
    'Порадь книгу для читання.',
    'Допоможи згенерувати ідеї.',
    'Напиши короткий вірш.',
];

const UNKNOWN_ERROR = 'Сталася помилка. Спробуйте пізніше';

export default function AiChatPage() {
    const user = useAuthStore((s) => s.user);

    const balance = user?.executions.balance ?? 0;
    const canAfford = balance >= AI_CHAT_COST;
    const formattedBalance = balance.toLocaleString(INTL_LOCALE);
    const formattedCost = AI_CHAT_COST.toLocaleString(INTL_LOCALE);

    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [isLoadingHistory, setIsLoadingHistory] = useState(true);
    const [isClearing, setIsClearing] = useState(false);
    const [isClearDialogOpen, setIsClearDialogOpen] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // Load history on mount
    useEffect(() => {
        let cancelled = false;

        (async () => {
            try {
                const history = await getChatHistory();
                if (cancelled) return;
                setMessages(
                    history.map((m) => ({
                        id: m.id,
                        role: m.role,
                        content: m.content,
                    }))
                );
            } catch {
                // silently fail — empty chat is fine
            } finally {
                if (!cancelled) setIsLoadingHistory(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    // Cleanup abort on unmount
    useEffect(() => {
        return () => {
            abortRef.current?.abort();
        };
    }, []);

    // Auto-scroll to bottom
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSubmit = useCallback(async () => {
        const trimmed = input.trim();
        if (
            !trimmed ||
            isStreaming ||
            trimmed.length > AI_CHAT_MESSAGE_MAX_LENGTH
        )
            return;

        if (!canAfford) {
            toast.error(getApiMessage('INSUFFICIENT_EXECUTIONS', 'users'));
            return;
        }

        setInput('');
        const userMsgId = `user-${Date.now()}`;
        const assistantMsgId = `assistant-${Date.now()}`;

        setMessages((prev) => [
            ...prev,
            { id: userMsgId, role: 'user', content: trimmed },
            { id: assistantMsgId, role: 'assistant', content: '' },
        ]);
        setIsStreaming(true);

        const controller = new AbortController();
        abortRef.current = controller;

        const rollback = () => {
            setMessages((prev) =>
                prev.filter(
                    (m) => m.id !== userMsgId && m.id !== assistantMsgId
                )
            );
            setInput(trimmed);
        };

        try {
            await streamAiChat(
                trimmed,
                (event) => {
                    switch (event.type) {
                        case AI_CHAT_EVENT.TOKEN:
                            setMessages((prev) =>
                                prev.map((m) =>
                                    m.id === assistantMsgId
                                        ? {
                                              ...m,
                                              content:
                                                  m.content + event.content,
                                          }
                                        : m
                                )
                            );
                            break;

                        case AI_CHAT_EVENT.DONE: {
                            // Use current store state to avoid stale closure
                            const currentUser = useAuthStore.getState().user;
                            if (currentUser) {
                                useAuthStore.getState().setUser({
                                    ...currentUser,
                                    executions: {
                                        ...currentUser.executions,
                                        balance: event.balanceAfter,
                                    },
                                });
                            }
                            break;
                        }

                        case AI_CHAT_EVENT.ERROR:
                            toast.error(getApiMessage(event.code, 'ai'));
                            rollback();
                            break;
                    }
                },
                controller.signal
            );
        } catch (err) {
            if (err instanceof AiChatError) {
                if (
                    err.code === 'AI_RATE_LIMIT_EXCEEDED' ||
                    err.code === 'AI_MESSAGE_TOO_LONG'
                ) {
                    toast.error(getApiMessage(err.code, 'ai'));
                } else if (
                    err.code === 'INSUFFICIENT_EXECUTIONS' ||
                    err.code === 'EXECUTIONS_RESERVATION_ACTIVE'
                ) {
                    toast.error(getApiMessage(err.code, 'users'));
                } else {
                    toast.error(getApiMessage(err.code));
                }
                rollback();
            } else if (
                !(err instanceof DOMException && err.name === 'AbortError')
            ) {
                toast.error(UNKNOWN_ERROR);
                rollback();
            }
        } finally {
            setIsStreaming(false);
            abortRef.current = null;
            inputRef.current?.focus();
        }
    }, [input, isStreaming, canAfford]);

    const handleClear = useCallback(async () => {
        setIsClearing(true);
        try {
            await clearChatHistory();
            setMessages([]);
            setIsClearDialogOpen(false);
        } catch {
            toast.error(UNKNOWN_ERROR);
        } finally {
            setIsClearing(false);
        }
    }, []);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
            }
        },
        [handleSubmit]
    );

    return (
        <UiPageContainer fixed>
            {/* ── Header ── */}
            <div className="flex items-center justify-between py-6">
                <UiPageHeading>AI Чат</UiPageHeading>
                {messages.length > 0 && !isStreaming && (
                    <UiButton
                        variant="destructive-text"
                        size="sm"
                        onClick={() => setIsClearDialogOpen(true)}
                        disabled={isClearing}
                        IconLeft={<Trash2 />}
                    >
                        Очистити історію
                    </UiButton>
                )}
            </div>

            {/* ── Info Bar ── */}
            <div className="border-border text-muted-foreground flex items-center justify-between border-b pb-3 text-xs">
                <div>
                    <span className="text-foreground font-medium">
                        {formattedBalance}
                    </span>{' '}
                    виконань
                </div>
                {canAfford ? (
                    <span>{formattedCost} виконань за повідомлення</span>
                ) : (
                    <UiLink as="link" href="/billing" className="font-medium">
                        Поповнити баланс
                    </UiLink>
                )}
            </div>

            {/* ── Messages ── */}
            <div className="flex-1 overflow-y-auto pt-4 pr-2">
                {isLoadingHistory ? (
                    <div className="flex h-full items-center justify-center">
                        <UiSpinner size="lg" />
                    </div>
                ) : messages.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-6">
                        <div className="text-center">
                            <div className="bg-muted mx-auto flex h-14 w-14 items-center justify-center rounded-2xl">
                                <MessageSquare className="text-muted-foreground h-7 w-7" />
                            </div>
                            <h2 className="mt-4 text-lg font-semibold tracking-tight">
                                Чим можу допомогти?
                            </h2>
                            <p className="text-muted-foreground mt-1.5 text-sm">
                                Надішліть повідомлення, щоб почати розмову з AI.
                            </p>
                        </div>
                        <div className="grid w-full gap-2 sm:grid-cols-2">
                            {SUGGESTIONS.map((suggestion) => (
                                <UiButton
                                    key={suggestion}
                                    variant="soft"
                                    size="sm"
                                    className="w-full"
                                    onClick={() => {
                                        setInput(suggestion);
                                        inputRef.current?.focus();
                                    }}
                                >
                                    {suggestion}
                                </UiButton>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {messages.map((msg) => (
                            <div
                                key={msg.id}
                                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                            >
                                <div
                                    className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                                        msg.role === 'user'
                                            ? 'bg-primary text-primary-foreground'
                                            : 'bg-muted text-foreground'
                                    }`}
                                >
                                    {msg.content ? (
                                        msg.role === 'assistant' ? (
                                            <div className="prose-chat">
                                                <Markdown>
                                                    {msg.content}
                                                </Markdown>
                                            </div>
                                        ) : (
                                            msg.content
                                        )
                                    ) : (
                                        msg.role === 'assistant' &&
                                        isStreaming && (
                                            <span className="inline-flex items-center gap-1">
                                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:150ms]" />
                                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
                                            </span>
                                        )
                                    )}
                                </div>
                            </div>
                        ))}
                        <div ref={messagesEndRef} />
                    </div>
                )}
            </div>

            {/* ── Footer ── */}
            <div className="border-border border-t py-3">
                <UiTextarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Напишіть повідомлення..."
                    rows={1}
                    disabled={isStreaming}
                    size="sm"
                    autoGrow
                    suffix={
                        <div className="flex items-center justify-between">
                            {input.length >= 400 ? (
                                <span
                                    className={`text-xs ${
                                        input.length >
                                        AI_CHAT_MESSAGE_MAX_LENGTH
                                            ? 'text-destructive'
                                            : input.length > 490
                                              ? 'text-warning'
                                              : 'text-muted-foreground'
                                    }`}
                                >
                                    {input.length}/{AI_CHAT_MESSAGE_MAX_LENGTH}
                                    {input.length >
                                        AI_CHAT_MESSAGE_MAX_LENGTH &&
                                        ` (-${input.length - AI_CHAT_MESSAGE_MAX_LENGTH})`}
                                </span>
                            ) : (
                                <span />
                            )}
                            <UiButton
                                variant="filled"
                                size="sm"
                                className="shrink-0"
                                disabled={
                                    isStreaming ||
                                    !input.trim() ||
                                    input.length > AI_CHAT_MESSAGE_MAX_LENGTH
                                }
                                onClick={handleSubmit}
                                aria-label="Надіслати"
                            >
                                {isStreaming ? (
                                    <UiSpinner size="sm" />
                                ) : (
                                    <Send className="h-4 w-4" />
                                )}
                            </UiButton>
                        </div>
                    }
                />
                <div className="text-muted-foreground mt-1.5 space-y-0.5 text-center text-xs">
                    <p>AI може помилятися. Перевіряйте відповіді.</p>
                    <p className="text-muted-foreground/60">
                        Якщо AI почав відповідати, кошти не повертаються при
                        перериванні.
                    </p>
                </div>
            </div>
            <UiConfirmDialog
                open={isClearDialogOpen}
                onOpenChange={setIsClearDialogOpen}
                title="Очистити історію чату?"
                description="Усі повідомлення будуть видалені назавжди. Цю дію неможливо скасувати."
                confirmLabel="Очистити історію"
                cancelLabel="Скасувати"
                variant="destructive"
                loading={isClearing}
                onConfirm={handleClear}
            />
        </UiPageContainer>
    );
}
