import { type ReactNode, type TextareaHTMLAttributes } from 'react';

export type UiTextareaVariant = 'outlined' | 'filled';
export type UiTextareaSize = 'sm' | 'md' | 'lg';

export interface UiTextareaProps extends Omit<
    TextareaHTMLAttributes<HTMLTextAreaElement>,
    'size'
> {
    variant?: UiTextareaVariant;
    size?: UiTextareaSize;
    /** Розмір лейбла: `sm` (14px, default) або `md` (16px — ритм еталона). */
    labelSize?: 'sm' | 'md';
    label?: string;
    description?: string;
    error?: string;
    /** Element rendered inside the wrapper, after the textarea (e.g. submit button). */
    suffix?: ReactNode;
    /** Auto-grow textarea height with content. When enabled, grows from `rows` up to `maxRows`, then scrolls. */
    autoGrow?: boolean;
    /** Maximum number of visible rows when `autoGrow` is enabled. Default: 6. */
    maxRows?: number;
}
