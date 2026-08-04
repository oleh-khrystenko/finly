'use client';

import { forwardRef, Fragment } from 'react';
import Link from 'next/link';
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { composeClasses } from '@/shared/lib';
import type {
    UiDropdownMenuProps,
    UiDropdownMenuSize,
    UiDropdownMenuAlign,
    UiDropdownMenuSide,
} from './types';

const itemSizeStyles: Record<UiDropdownMenuSize, string> = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg',
};

const iconSizeStyles: Record<UiDropdownMenuSize, string> = {
    sm: '[&_svg]:size-4',
    md: '[&_svg]:size-5',
    lg: '[&_svg]:size-6',
};

const alignStyles: Record<UiDropdownMenuAlign, string> = {
    start: 'left-0',
    end: 'right-0',
};

/**
 * Кнопка «Скопіювати» праворуч пункту з `copyValue`. Це окремий `MenuItem`, а
 * не звичайна кнопка всередині панелі: Headless UI водить фокус стрілками лише
 * по `MenuItem`, а `Tab` закриває меню — будь-який інший інтерактивний елемент
 * у панелі недосяжний з клавіатури. Активація `MenuItem` закриває меню, тож
 * фідбек — toast, а не inline-галочка (вона зникла б разом з панеллю).
 * `min-h-11 min-w-11` — touch-target 44×44 за responsive.md §2.
 *
 * Текст успіху приходить від consumer-а: примітив не знає, що у `copyValue`
 * (пошта, IBAN, номер), тож власний дефолт тримає нейтральним.
 */
function CopyValueButton({
    value,
    successMessage,
}: {
    value: string;
    successMessage: string;
}) {
    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(value);
            toast.success(successMessage);
        } catch {
            toast.error('Не вдалося скопіювати');
        }
    };

    return (
        <MenuItem>
            <button
                type="button"
                aria-label="Скопіювати"
                onClick={() => void handleCopy()}
                className="text-muted-foreground hover:text-foreground data-[focus]:bg-accent flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors focus:outline-none"
            >
                <Copy className="size-4" aria-hidden />
            </button>
        </MenuItem>
    );
}

const sideStyles: Record<UiDropdownMenuSide, string> = {
    bottom: 'top-full mt-1',
    top: 'bottom-full mb-1',
};

// Transform-origin у куті, звідки панель «виростає» (протилежний бік + бік
// вирівнювання) — scale-анімація тоді читається як розкриття від тригера.
const originStyles: Record<
    UiDropdownMenuSide,
    Record<UiDropdownMenuAlign, string>
> = {
    bottom: { start: 'origin-top-left', end: 'origin-top-right' },
    top: { start: 'origin-bottom-left', end: 'origin-bottom-right' },
};

const UiDropdownMenu = forwardRef<HTMLDivElement, UiDropdownMenuProps>(
    (props, ref) => {
        const {
            items,
            onSelect,
            activeValue,
            trigger,
            header,
            align = 'end',
            side = 'bottom',
            size = 'md',
            className,
            rootClassName,
            itemClassName,
            badgeClassName,
        } = props;

        return (
            <Menu
                as="div"
                className={composeClasses(
                    'relative inline-flex items-center',
                    rootClassName
                )}
                ref={ref}
            >
                <MenuButton as={Fragment}>{trigger}</MenuButton>

                <MenuItems
                    transition
                    className={composeClasses(
                        'absolute z-50 min-w-32',
                        sideStyles[side],
                        'border-border bg-card rounded-lg border shadow-md',
                        'focus:outline-none',
                        alignStyles[align],
                        // Поява 150ms ease-out, зникнення 100ms ease-in
                        // (конвенція мікроанімацій); scale+fade від кута тригера.
                        'transition duration-150 ease-out data-closed:scale-95 data-closed:opacity-0 data-leave:duration-100 data-leave:ease-in',
                        originStyles[side][align],
                        className
                    )}
                >
                    {header && (
                        <div className="border-border border-b px-3 py-2">
                            {header}
                        </div>
                    )}
                    <div className="space-y-0.5 p-1">
                        {items.map((item) => {
                            const isActive = activeValue === item.value;
                            const isDestructive = item.tone === 'destructive';
                            const itemClasses = composeClasses(
                                'flex w-full items-center gap-2',
                                // Поруч з копі-кнопкою пункт мусить стискатись,
                                // інакше `w-full` виштовхує кнопку за панель.
                                item.copyValue != null && 'min-w-0 flex-1',
                                'cursor-pointer rounded-md transition-colors',
                                isDestructive
                                    ? 'text-destructive data-[focus]:bg-destructive/10'
                                    : 'data-[focus]:bg-accent',
                                isActive && 'bg-accent',
                                itemSizeStyles[size],
                                iconSizeStyles[size],
                                itemClassName
                            );
                            const content = (
                                <>
                                    {item.icon && (
                                        <span aria-hidden>{item.icon}</span>
                                    )}
                                    {/* Поруч з копі-кнопкою лейбл мусить вміти
                                        обрізатись: `min-w-0 flex-1` на пункті
                                        схлопує min-content ряду, тож панель не
                                        росте під вміст сама — голий nowrap
                                        заліз би під копі-кнопку. */}
                                    <span
                                        className={
                                            item.copyValue != null
                                                ? 'min-w-0 truncate'
                                                : 'whitespace-nowrap'
                                        }
                                    >
                                        {item.label}
                                    </span>
                                    {item.badge != null && (
                                        <span
                                            className={composeClasses(
                                                'bg-muted text-muted-foreground ml-auto rounded-full px-2.5 py-1 text-xs leading-none whitespace-nowrap',
                                                badgeClassName
                                            )}
                                        >
                                            {item.badge}
                                        </span>
                                    )}
                                </>
                            );
                            const interactive = (
                                <MenuItem>
                                    {item.href == null ? (
                                        <button
                                            type="button"
                                            onClick={() => onSelect(item.value)}
                                            className={itemClasses}
                                        >
                                            {content}
                                        </button>
                                    ) : item.external ? (
                                        <a
                                            href={item.href}
                                            onClick={() => onSelect(item.value)}
                                            className={itemClasses}
                                        >
                                            {content}
                                        </a>
                                    ) : (
                                        <Link
                                            href={item.href}
                                            onClick={() => onSelect(item.value)}
                                            className={itemClasses}
                                        >
                                            {content}
                                        </Link>
                                    )}
                                </MenuItem>
                            );
                            return (
                                <Fragment key={item.value}>
                                    {item.separatorBefore && (
                                        <div
                                            aria-hidden
                                            className="bg-border mx-2 my-1 h-px"
                                        />
                                    )}
                                    {item.copyValue != null ? (
                                        <div className="flex min-w-0 items-center gap-1 pr-1">
                                            {interactive}
                                            <CopyValueButton
                                                value={item.copyValue}
                                                successMessage={
                                                    item.copySuccessMessage ??
                                                    'Скопійовано'
                                                }
                                            />
                                        </div>
                                    ) : (
                                        interactive
                                    )}
                                </Fragment>
                            );
                        })}
                    </div>
                </MenuItems>
            </Menu>
        );
    }
);

UiDropdownMenu.displayName = 'UiDropdownMenu';

export default UiDropdownMenu;
