'use client';

import { useId } from 'react';
import { Radio, RadioGroup } from '@headlessui/react';
import { composeClasses } from '@/shared/lib';
import type {
    UiRadioCardGroupColumns,
    UiRadioCardGroupProps,
} from './types';

/**
 * Grid-стиль radio-cards з title + description + optional icon.
 *
 * **Чому окремий primitive від `UiChipGroup`** — chip — горизонтальний
 * inline-pill (`flex flex-wrap`, малі px/py); card — багаторядковий
 * (title + 1-2 line description), responsive grid layout, opt-in icon
 * у corner. Перевантаження `UiChipGroup` опцією `layout` зробило б його
 * полісемантичним, що ламає single-responsibility primitive-у.
 *
 * **Accessibility (єдина точка):** Headless UI `RadioGroup` дає з коробки:
 *  - `role="radiogroup"` / `role="radio"` + `aria-checked`
 *  - **Arrow-key navigation** (← → ↑ ↓) між опціями
 *  - **Roving tabindex** — лише обрана картка `tabIndex=0`, решта `-1`
 *  - Focus-management: keyboard select переключає state без додаткового
 *    onChange-handler-а
 *
 * **Стилізація.** Поточні Radio-state-стилі з `data-checked`, `data-focus`,
 * `data-disabled` — Tailwind v4 attribute selectors, що працюють з
 * Headless UI 2.x out-of-the-box. Color-tokens (`primary`, `border`,
 * `muted-foreground`) — з єдиної дизайн-системи.
 *
 * **Чому `value: TValue | undefined → null`-нормалізація**: Headless UI
 * `RadioGroup` semantically приймає `null` як "нічого не обрано", а більшість
 * callsite-ів використовує `undefined` (formData drafts). Інкапсулюємо
 * нормалізацію тут.
 */

const COLUMN_CLASS_MAP: Record<
    NonNullable<UiRadioCardGroupColumns['mobile']>,
    string
> = {
    1: 'grid-cols-1',
    2: 'grid-cols-2',
};

const DESKTOP_COLUMN_CLASS_MAP: Record<
    NonNullable<UiRadioCardGroupColumns['desktop']>,
    string
> = {
    2: 'md:grid-cols-2',
    3: 'md:grid-cols-3',
    4: 'md:grid-cols-4',
};

function UiRadioCardGroup<TValue extends string>(
    props: UiRadioCardGroupProps<TValue>,
) {
    const {
        options,
        value,
        onChange,
        columns,
        label,
        description,
        error,
        required,
        disabled = false,
        className,
    } = props;

    const labelId = useId();
    const descriptionId = useId();

    const mobileCols = columns?.mobile ?? 2;
    // Desktop fallback мусить бути валідним ключем у `DESKTOP_COLUMN_CLASS_MAP`
    // (2|3|4). Якщо `mobile=1`, desktop без явного override → `2` (типовий
    // wider-screen layout); 1×N grid на desktop виглядає як список, що не
    // відповідає card-design-у.
    const desktopCols: NonNullable<UiRadioCardGroupColumns['desktop']> =
        columns?.desktop ?? (mobileCols === 1 ? 2 : mobileCols);

    return (
        <div className={className}>
            {label && (
                <label
                    id={labelId}
                    className="text-foreground mb-1 block text-sm font-medium"
                >
                    {label}
                    {required && (
                        <span className="text-destructive ml-1">*</span>
                    )}
                </label>
            )}
            {description && (
                <p
                    id={descriptionId}
                    className="text-muted-foreground mb-2 text-xs"
                >
                    {description}
                </p>
            )}
            <RadioGroup
                value={value ?? null}
                onChange={(next) => {
                    if (next !== null) onChange(next);
                }}
                disabled={disabled}
                aria-labelledby={label ? labelId : undefined}
                aria-describedby={description ? descriptionId : undefined}
                className={composeClasses(
                    'grid gap-2',
                    COLUMN_CLASS_MAP[mobileCols],
                    DESKTOP_COLUMN_CLASS_MAP[desktopCols],
                )}
            >
                {options.map((option) => (
                    <Radio
                        key={option.value}
                        value={option.value}
                        disabled={option.disabled || disabled}
                        className={composeClasses(
                            'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors',
                            'cursor-pointer select-none',
                            'border-border hover:bg-accent',
                            'focus:outline-none data-focus:outline-ring data-focus:outline-2 data-focus:outline-offset-2 data-focus:outline',
                            'data-checked:border-primary data-checked:bg-primary/5 data-checked:ring-2 data-checked:ring-primary/20 data-checked:hover:bg-primary/5',
                            'data-disabled:cursor-not-allowed data-disabled:opacity-50',
                        )}
                    >
                        {option.icon && (
                            <span
                                className="text-muted-foreground"
                                aria-hidden
                            >
                                {option.icon}
                            </span>
                        )}
                        <span className="text-foreground text-sm font-semibold">
                            {option.title}
                        </span>
                        {option.description && (
                            <span className="text-muted-foreground text-xs leading-snug">
                                {option.description}
                            </span>
                        )}
                    </Radio>
                ))}
            </RadioGroup>
            {error && (
                <p className="text-destructive mt-1 text-sm">{error}</p>
            )}
        </div>
    );
}

export default UiRadioCardGroup;
