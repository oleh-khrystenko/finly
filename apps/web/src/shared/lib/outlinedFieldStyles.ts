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
