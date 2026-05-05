import type { ReactNode } from 'react';

/**
 * Args, що `UiEditableField` передає у `renderEdit`-renderer.
 *
 * Generic над `TValue` — caller визначає тип значення (`string`, `BankCode[]`,
 * `SlugPreset | null` тощо), і renderer отримує type-safe `value`/`setValue`.
 */
export interface UiEditableFieldRenderArgs<TValue> {
    value: TValue;
    setValue: (next: TValue) => void;
    error?: string;
}

export interface UiEditableFieldProps<TValue> {
    label: string;
    value: TValue;
    /** Renderer для read-only вигляду (повертає string або ReactNode). */
    renderRead: (value: TValue) => ReactNode;
    /** Renderer редаговного контролу (input/select/textarea). */
    renderEdit: (args: UiEditableFieldRenderArgs<TValue>) => ReactNode;
    /**
     * Async-save handler. Throws на помилку → UiEditableField лишається в
     * editing-режимі, показує error. На success → читання-режим.
     */
    onSave: (next: TValue) => Promise<void>;
    /** Optional client-side validation. Повертає error-message або null. */
    validate?: (next: TValue) => string | null;
    disabled?: boolean;
}
