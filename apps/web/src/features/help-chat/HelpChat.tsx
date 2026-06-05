'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { Bot, Send, BookOpen, AlertCircle, Sparkles } from 'lucide-react';
import { AI_CHAT_EVENT, AI_CHAT_MESSAGE_MAX_LENGTH } from '@finly/types';

import UiButton from '@/shared/ui/UiButton';
import UiLink from '@/shared/ui/UiLink';
import UiTextarea from '@/shared/ui/UiTextarea';
import {
    streamHelpChat,
    HelpChatError,
    HELP_CHAT_CODE,
    type HelpChatHistoryItem,
} from './api';

interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
}

type Notice = { kind: 'rate-limit' | 'error' } | null;

const SUGGESTIONS = [
    'Як створити перший платіжний QR-код?',
    'Чим Finly відрізняється від банківського застосунку?',
    'Як виставити рахунок клієнту?',
    'Чи безпечно ділитися сторінкою оплати?',
];

const NOTICE_TEXT: Record<'rate-limit' | 'error', string> = {
    'rate-limit':
        'Забагато запитань поспіль. Зачекайте хвилину і спробуйте знову.',
    error: 'Не вдалося отримати відповідь. Спробуйте ще раз.',
};

let messageCounter = 0;
const nextId = (prefix: string) => `${prefix}-${messageCounter++}`;

export function HelpChat() {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [notice, setNotice] = useState<Notice>(null);
    const [degraded, setDegraded] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        return () => abortRef.current?.abort();
    }, []);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSubmit = useCallback(async () => {
        const trimmed = input.trim();
        if (
            !trimmed ||
            isStreaming ||
            degraded ||
            trimmed.length > AI_CHAT_MESSAGE_MAX_LENGTH
        ) {
            return;
        }

        setNotice(null);
        setInput('');

        const history: HelpChatHistoryItem[] = messages
            .filter((m) => m.content.trim().length > 0)
            .map((m) => ({ role: m.role, content: m.content }));

        const userMsgId = nextId('user');
        const assistantMsgId = nextId('assistant');

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
            await streamHelpChat(
                trimmed,
                history,
                (event) => {
                    if (event.type === AI_CHAT_EVENT.TOKEN) {
                        setMessages((prev) =>
                            prev.map((m) =>
                                m.id === assistantMsgId
                                    ? { ...m, content: m.content + event.content }
                                    : m
                            )
                        );
                    } else if (event.type === AI_CHAT_EVENT.ERROR) {
                        setNotice({ kind: 'error' });
                        rollback();
                    }
                },
                controller.signal
            );
        } catch (err) {
            if (err instanceof HelpChatError) {
                if (err.code === HELP_CHAT_CODE.BUDGET_EXHAUSTED) {
                    setDegraded(true);
                } else if (err.code === HELP_CHAT_CODE.RATE_LIMIT) {
                    setNotice({ kind: 'rate-limit' });
                } else {
                    setNotice({ kind: 'error' });
                }
                rollback();
            } else if (
                !(err instanceof DOMException && err.name === 'AbortError')
            ) {
                setNotice({ kind: 'error' });
                rollback();
            }
        } finally {
            setIsStreaming(false);
            abortRef.current = null;
            inputRef.current?.focus();
        }
    }, [input, isStreaming, degraded, messages]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
            }
        },
        [handleSubmit]
    );

    const overLimit = input.length > AI_CHAT_MESSAGE_MAX_LENGTH;
    const isEmpty = messages.length === 0;

    return (
        <div className="bg-card border-border flex flex-col overflow-hidden rounded-xl border">
            {/* Header */}
            <div className="border-border flex items-center gap-3 border-b px-5 py-4">
                <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
                    <Bot className="size-5" />
                </span>
                <div className="min-w-0">
                    <h2 className="text-foreground text-base font-semibold tracking-tight">
                        Помічник Finly
                    </h2>
                    <p className="text-muted-foreground truncate text-sm">
                        Запитайте, як користуватись сервісом
                    </p>
                </div>
            </div>

            {/* Messages */}
            <div
                className="h-[24rem] overflow-y-auto px-5 py-4 md:h-[28rem]"
                role="log"
                aria-label="Розмова з помічником"
            >
                {isEmpty ? (
                    <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
                        <div>
                            <span className="bg-muted text-muted-foreground mx-auto flex size-12 items-center justify-center rounded-2xl">
                                <Sparkles className="size-6" />
                            </span>
                            <h3 className="text-foreground mt-4 text-base font-semibold">
                                Чим можу допомогти?
                            </h3>
                            <p className="text-muted-foreground mt-1.5 text-sm">
                                Оберіть запитання або напишіть своє.
                            </p>
                        </div>
                        <div className="grid w-full gap-2 sm:grid-cols-2">
                            {SUGGESTIONS.map((s) => (
                                <UiButton
                                    key={s}
                                    variant="soft"
                                    size="sm"
                                    className="w-full"
                                    onClick={() => {
                                        setInput(s);
                                        inputRef.current?.focus();
                                    }}
                                >
                                    {s}
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
                                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                                        msg.role === 'user'
                                            ? 'bg-primary text-primary-foreground'
                                            : 'bg-muted text-foreground'
                                    }`}
                                >
                                    {msg.content ? (
                                        msg.role === 'assistant' ? (
                                            <div className="prose-chat">
                                                <Markdown>{msg.content}</Markdown>
                                            </div>
                                        ) : (
                                            msg.content
                                        )
                                    ) : (
                                        isStreaming && (
                                            <span className="inline-flex items-center gap-1 py-1">
                                                <span className="size-1.5 animate-pulse rounded-full bg-current" />
                                                <span className="size-1.5 animate-pulse rounded-full bg-current [animation-delay:150ms]" />
                                                <span className="size-1.5 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
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

            {/* Footer */}
            <div className="border-border border-t px-5 py-3">
                {degraded ? (
                    <div className="bg-muted/50 flex items-start gap-3 rounded-lg px-4 py-3">
                        <BookOpen className="text-muted-foreground mt-0.5 size-5 shrink-0" />
                        <div className="text-sm">
                            <p className="text-foreground font-medium">
                                Помічник зараз відпочиває
                            </p>
                            <p className="text-muted-foreground mt-0.5">
                                Скористайтесь{' '}
                                <UiLink href="#categories" variant="primary">
                                    статтями довідки
                                </UiLink>
                                , вони покривають основні питання.
                            </p>
                        </div>
                    </div>
                ) : (
                    <>
                        {notice && (
                            <p
                                className="text-muted-foreground mb-2 flex items-center gap-1.5 text-sm"
                                aria-live="polite"
                            >
                                <AlertCircle className="size-4 shrink-0" />
                                {NOTICE_TEXT[notice.kind]}
                            </p>
                        )}
                        <UiTextarea
                            ref={inputRef}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Напишіть запитання про Finly..."
                            rows={1}
                            disabled={isStreaming}
                            size="sm"
                            autoGrow
                            aria-label="Запитання до помічника"
                            suffix={
                                <div className="flex items-center justify-between gap-2">
                                    {input.length >= 400 ? (
                                        <span
                                            className={`text-xs ${
                                                overLimit
                                                    ? 'text-destructive'
                                                    : 'text-muted-foreground'
                                            }`}
                                        >
                                            {input.length}/
                                            {AI_CHAT_MESSAGE_MAX_LENGTH}
                                        </span>
                                    ) : (
                                        <span />
                                    )}
                                    <UiButton
                                        variant="filled"
                                        size="sm"
                                        className="shrink-0"
                                        disabled={!input.trim() || overLimit}
                                        loading={isStreaming}
                                        onClick={handleSubmit}
                                        aria-label="Надіслати запитання"
                                    >
                                        <Send className="size-4" />
                                    </UiButton>
                                </div>
                            }
                        />
                        <p className="text-muted-foreground mt-2 text-center text-xs">
                            Помічник відповідає лише про роботу з Finly. З
                            податковими питаннями зверніться до бухгалтера.
                        </p>
                    </>
                )}
            </div>
        </div>
    );
}
