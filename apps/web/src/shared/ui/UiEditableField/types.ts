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

/**
 * Read-mode-render args. `startEdit` дозволяє consumer-у поставити власний
 * pencil-button у довільному місці контенту (за замовчуванням UiEditableField
 * рендерить pencil як trailing-action; consumer може hide через
 * `hideDefaultPencil` і рендерити вручну).
 */
export interface UiEditableFieldReadArgs<TValue> {
    value: TValue;
    startEdit: () => void;
}

export interface UiEditableFieldProps<TValue> {
    label: string;
    value: TValue;
    /**
     * Renderer для read-only вигляду. Другий аргумент — `{startEdit}`-callback
     * для випадків, коли pencil-button рендериться як частина контенту (у парі
     * з `hideDefaultPencil`). Existing consumers ігнорують другий аргумент —
     * сигнатура backward-compatible.
     */
    renderRead: (
        value: TValue,
        ctx: UiEditableFieldReadArgs<TValue>
    ) => ReactNode;
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
    /**
     * Якщо `true` — UiEditableField не рендерить default trailing-pencil.
     * Consumer відповідає за виклик `ctx.startEdit` зі свого власного UI
     * у `renderRead`. Сценарій: треба placement-у pencil у конкретному місці
     * рядка (поруч з контентом), а не на трейлінг-позиції.
     */
    hideDefaultPencil?: boolean;
}
