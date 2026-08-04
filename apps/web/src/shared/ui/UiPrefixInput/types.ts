import { InputHTMLAttributes, ReactNode } from 'react';

/**
 * Composite-input з немутабельним text-префіксом у спільній рамці з input-ом.
 * Сценарії: slug-edit для URL (`pay.finly.com.ua/`), бренд-handle, country-code
 * для phone. UiInput не підтримує text-prefix (тільки `IconLeft`/`IconRight`
 * як svg-adornment всередині padded-wrapper); тут wrapper без padding, prefix
 * має власний bg-secondary для візуального розмежування.
 */
export interface UiPrefixInputProps extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'size' | 'prefix'
> {
    /** Текст префікса (наприклад `pay.finly.com.ua/`). */
    prefix: ReactNode;
    /** Inline error message під полем. Перемикає border на destructive. */
    error?: string;
}
