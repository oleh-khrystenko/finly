/**
 * Sprint 14 — shared border/focus стилі для outlined-field-обгорток
 * (`UiInput` outlined variant + `UiPrefixInput` composite). Без цього модулю
 * обидва компоненти руками реплікували одну й ту саму трійку класів
 * `border-border / hover:border-muted-foreground / focus-within:border-primary`
 * + дзеркальну error-трійку, що ризикувало drift-ом при оновленні токенів.
 *
 * **Що НЕ покрите:** `bg-*` (UiInput-outlined прозорий, UiPrefixInput також),
 * placeholder/disabled — лежать на input-child-елементі, не на wrapper-і, тож
 * дублювання там точкове і не варте окремого helper-а.
 */
export const OUTLINED_FIELD_STYLES = {
    /** Wrapper-shell: радіус, 1px border, плавна зміна кольору border-у. */
    shellBase: 'rounded-md border transition-colors',
    /** Border-color для default-state (hover/focus реактивні). */
    borderIdle:
        'border-border hover:border-muted-foreground focus-within:border-primary',
    /** Border-color для error-state. Заміщає `borderIdle` через later-class wins. */
    borderError:
        'border-destructive hover:border-destructive focus-within:border-destructive',
} as const;

export type FieldLabelSize = 'sm' | 'md';

/**
 * Спільні label-стилі для field-примітивів (`UiInput` / `UiSelect` /
 * `UiTextarea` / `UiRadioCardGroup`). До цього кожен примітив хардкодив
 * `mb-1 text-sm` — дрібніше за еталонну сторінку `/business/{slug}`, де поля
 * рендеряться через `UiEditableField` з `text-base` + `space-y-2`.
 *
 *  - `sm` (default): floor-розмір 14px, mb-1 — лишається на всіх існуючих
 *    формах застосунку без візуальної зміни.
 *  - `md`: 16px + mb-2 — матчить ритм еталона; opt-in на create-формах
 *    (отримувач / реквізити / рахунок).
 */
export const FIELD_LABEL_STYLES: Record<FieldLabelSize, string> = {
    sm: 'mb-1 block text-sm font-medium',
    md: 'mb-2 block text-base font-medium',
} as const;
