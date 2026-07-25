'use client';

import {
    forwardRef,
    type ComponentPropsWithoutRef,
    type ReactNode,
} from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Tab, TabGroup, TabList } from '@headlessui/react';
import { composeClasses } from '@/shared/lib';
import type {
    UiTabCountTone,
    UiTabItemBase,
    UiTabPanelProps,
    UiTabsNavProps,
    UiTabsPanelProps,
    UiTabsProps,
    UiTabsSize,
} from './types';

/** Горизонтальний відступ + розмір тексту табу. Висота — від `min-h-11`. */
const sizeStyles: Record<UiTabsSize, string> = {
    sm: 'px-3 text-sm',
    md: 'px-4 text-base',
};

const countToneStyles: Record<UiTabCountTone, string> = {
    neutral: 'bg-muted text-muted-foreground',
    primary: 'bg-primary/10 text-primary',
};

/**
 * Спільна візуальна база табу (пункт смуги з підкресленням).
 *
 * Focus-індикатор — `inset-ring` (усередину боксу), а не звичний для проєкту
 * зовнішній `ring`: смуга скролиться по горизонталі, а скрол-контейнер зрізає
 * все, намальоване за його padding-box, тож зовнішнє кільце лишалося б без
 * верхньої/нижньої грані (і без бічної на краю прокрутки).
 */
const TAB_BASE =
    'relative -mb-px inline-flex min-h-11 shrink-0 items-center gap-2 border-b-2 whitespace-nowrap font-medium transition-colors select-none focus:outline-none focus-visible:inset-ring-2 focus-visible:inset-ring-ring focus-visible:rounded-t-sm';

/**
 * Смуга-контейнер: нижня рамка, яку перекриває підкреслення активного табу.
 * `w-max min-w-full` — щоб рамка тяглася на всю ширину прокрутки, а не лише на
 * видиму частину.
 */
const STRIP = 'border-border flex w-max min-w-full gap-1 border-b';

/**
 * Горизонтальний скрол живе на обгортці смуги, а не на самій смузі: скрол-
 * контейнер клипає все за межами свого padding-box, тож `-mb-px` табу (той
 * піксель, яким підкреслення накриває рамку смуги) зрізався б разом з ним.
 */
const STRIP_SCROLL = 'overflow-x-auto';

/** Стан пункту у nav-режимі (panel-режим бере стан з `data-selected`). */
function navTabStateStyles(active: boolean): string {
    return active
        ? 'border-primary text-foreground'
        : 'border-transparent text-muted-foreground hover:text-foreground cursor-pointer';
}

/**
 * Атрибути контейнера контенту в panel-режимі. Замикає ARIA-зв'язок
 * `aria-controls` → `role="tabpanel"`: панель живе в consumer-а, тож примітив
 * віддає готовий набір атрибутів, щоб цей зв'язок не забувся на callsite.
 *
 * `tabIndex` навмисно не задаємо: панелі проєкту містять власні фокусовані
 * елементи (посилання, кнопки), і за APG така панель не додається в tab-порядок.
 *
 * @param panelId той самий id, що переданий у `panelId` пропс `UiTabs`
 * @param label   лейбл активного табу — accessible name панелі
 */
export function uiTabPanelProps(
    panelId: string,
    label: string
): UiTabPanelProps {
    return { id: panelId, role: 'tabpanel', 'aria-label': label };
}

/**
 * Кнопка табу для panel-режиму.
 *
 * Headless UI обчислює `aria-controls` зі своїх зареєстрованих `TabPanel`-ів, а
 * їх у нас немає (панель живе в consumer-а), тож він приходить як `undefined` і
 * затирає зовнішній проп: `mergeProps(theirProps, ourProps)` віддає перевагу
 * внутрішнім атрибутам Headless UI. Тому ставимо атрибут тут, після spread-у,
 * вже поза тим мержем.
 */
const TabButton = forwardRef<
    HTMLButtonElement,
    ComponentPropsWithoutRef<'button'> & { panelId: string }
>(function TabButton({ panelId, ...props }, ref) {
    return <button {...props} ref={ref} aria-controls={panelId} />;
});

/** Внутрішній вміст табу: іконка + лейбл + badge-лічильник. */
function TabContent({ item }: { item: UiTabItemBase }): ReactNode {
    return (
        <>
            {item.icon && (
                <span aria-hidden className="inline-flex [&>svg]:size-4">
                    {item.icon}
                </span>
            )}
            <span>{item.label}</span>
            {typeof item.count === 'number' && (
                <span
                    className={composeClasses(
                        'inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-xs leading-none font-semibold',
                        countToneStyles[item.countTone ?? 'neutral']
                    )}
                >
                    {item.count}
                </span>
            )}
        </>
    );
}

function NavTabs<TValue extends string>(props: UiTabsNavProps<TValue>) {
    const { items, size = 'md', className } = props;
    const pathname = usePathname();

    const isActive = (href: string): boolean =>
        pathname === href || pathname.startsWith(`${href}/`);

    return (
        <nav
            aria-label={props['aria-label']}
            className={composeClasses(STRIP_SCROLL, className)}
        >
            <ul className={STRIP}>
                {items.map((item) => {
                    const active = isActive(item.href);
                    return (
                        <li key={item.value}>
                            <Link
                                href={item.href}
                                aria-current={active ? 'page' : undefined}
                                aria-label={item.ariaLabel}
                                className={composeClasses(
                                    TAB_BASE,
                                    sizeStyles[size],
                                    navTabStateStyles(active)
                                )}
                            >
                                <TabContent item={item} />
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </nav>
    );
}

function PanelTabs<TValue extends string>(props: UiTabsPanelProps<TValue>) {
    const { items, value, onChange, size = 'md', className, panelId } = props;

    // Headless UI оперує індексом, наш API — стабільним `value`. Мапимо туди й
    // назад; невідоме value падає на перший таб (fallback, не throw).
    const selectedIndex = Math.max(
        0,
        items.findIndex((i) => i.value === value)
    );

    return (
        <TabGroup
            selectedIndex={selectedIndex}
            onChange={(index) => {
                const item = items[index];
                // Єдиний фільтр активації disabled-табу: Headless UI його не
                // блокує (див. коментар до `aria-disabled` нижче), тож клік і
                // auto-activation стрілками доходять сюди й гасяться тут.
                if (item && !item.disabled) onChange(item.value);
            }}
            className={composeClasses(STRIP_SCROLL, className)}
        >
            <TabList aria-label={props['aria-label']} className={STRIP}>
                {items.map((item) => (
                    <Tab
                        key={item.value}
                        as={TabButton}
                        panelId={panelId}
                        /* Свідомо НЕ передаємо Headless UI `disabled`: він
                           виключає такий таб зі своєї мапи індексів, і коли
                           `value` вказує саме на нього, підсвітка тихо
                           переїжджає на наступний увімкнений — без onChange.
                           `value` consumer-а і підсвічений таб розійшлися б, а
                           панель показувала б контент іншого табу.
                           `aria-disabled` тримає індекси 1:1 з `items` (і за
                           APG disabled-таб лишається фокусованим). */
                        aria-disabled={item.disabled || undefined}
                        aria-label={item.ariaLabel}
                        className={composeClasses(
                            TAB_BASE,
                            sizeStyles[size],
                            'text-muted-foreground border-transparent',
                            'data-selected:border-primary data-selected:text-foreground',
                            item.disabled
                                ? 'cursor-not-allowed opacity-50'
                                : 'hover:text-foreground cursor-pointer'
                        )}
                    >
                        <TabContent item={item} />
                    </Tab>
                ))}
            </TabList>
        </TabGroup>
    );
}

/**
 * Уніфікований примітив табів платформи. Один вигляд (підкреслення активного),
 * два режими: `panel` (перемикання контенту в межах сторінки) і `nav`
 * (route-based таби). Дет.: `types.ts`.
 */
function UiTabs<TValue extends string = string>(props: UiTabsProps<TValue>) {
    if (props.as === 'nav') return <NavTabs {...props} />;
    return <PanelTabs {...props} />;
}

UiTabs.displayName = 'UiTabs';

export default UiTabs;
