import type { ReactNode } from 'react';

/**
 * Окрема опція у `UiRadioCardGroup`. На відміну від `UiChipGroup` (плоский label
 * як ReactNode), радіо-картка має **обов'язковий title** і **опціональний
 * description / icon** — це 2-line / 3-line content, типовий для wizard step-1
 * type selector-ів та slug-preset / payment-method-pickers.
 *
 * Generic `<TValue extends string>` — щоб TypeScript narrow-ив `value` /
 * `onChange` до конкретного union у callsite-і (`BusinessType`, `SlugPreset`,
 * etc.) без `as`-cast-ів.
 */
export interface UiRadioCardGroupOption<TValue extends string> {
    value: TValue;
    title: ReactNode;
    description?: ReactNode;
    icon?: ReactNode;
    disabled?: boolean;
}

/**
 * Responsive columns — 2 базових breakpoints (mobile-first), що покривають
 * усі поточні use-case-и. Розширювати з `sm/lg/xl` лише коли з'явиться
 * реальна потреба (YAGNI).
 *
 *  - `mobile`: число карток в рядку до `md` breakpoint-у (default 2).
 *  - `desktop`: число карток в рядку від `md` (default `mobile`, тобто без
 *    зміни — caller прямо мапить на specific layout).
 */
export interface UiRadioCardGroupColumns {
    mobile?: 1 | 2;
    desktop?: 2 | 3 | 4;
}

export interface UiRadioCardGroupProps<TValue extends string> {
    options: ReadonlyArray<UiRadioCardGroupOption<TValue>>;
    /**
     * Поточне значення. `undefined` — нічого не вибрано (initial state).
     * Headless UI `RadioGroup` приймає `null | TValue`; ми мапимо
     * `undefined → null` всередині примітиву.
     */
    value: TValue | undefined;
    onChange: (value: TValue) => void;
    columns?: UiRadioCardGroupColumns;
    label?: string;
    description?: ReactNode;
    error?: ReactNode;
    required?: boolean;
    disabled?: boolean;
    className?: string;
}
