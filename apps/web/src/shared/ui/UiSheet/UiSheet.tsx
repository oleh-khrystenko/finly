'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { composeClasses } from '@/shared/lib';
import type {
    UiSheetProps,
    UiSheetTriggerProps,
    UiSheetCloseProps,
    UiSheetContentProps,
    UiSheetBodyProps,
    UiSheetHeaderProps,
    UiSheetTitleProps,
    UiSheetSide,
} from './types';

const slideStyles: Record<UiSheetSide, string> = {
    right: 'inset-y-0 right-0 h-full max-h-dvh w-3/4 border-l shadow-lg data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm',
    left: 'inset-y-0 left-0 h-full max-h-dvh w-3/4 border-r shadow-lg data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm',
    top: 'inset-x-0 top-0 h-auto max-h-[90dvh] border-b shadow-lg data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top',
    bottom: 'inset-x-0 bottom-0 h-auto max-h-[90dvh] rounded-t-2xl border-t shadow-[0_-10px_40px_-10px_rgba(0,0,0,0.15)] data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
};

function UiSheet({ ...props }: UiSheetProps) {
    return <DialogPrimitive.Root {...props} />;
}

function UiSheetTrigger({ ...props }: UiSheetTriggerProps) {
    return <DialogPrimitive.Trigger {...props} />;
}

function UiSheetClose({ ...props }: UiSheetCloseProps) {
    return <DialogPrimitive.Close {...props} />;
}

function UiSheetOverlay({ className }: { className?: string }) {
    return (
        <DialogPrimitive.Overlay
            className={composeClasses(
                'fixed inset-0 z-50 bg-black/50',
                'data-[state=open]:animate-in data-[state=closed]:animate-out',
                'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
                className
            )}
        />
    );
}

/**
 * Сама панель НЕ прокручується (`overflow-hidden`): скрол живе виключно в
 * `UiSheetBody`. Інакше шапка, закріплений низ і absolute-позиціонована
 * close-кнопка їхали б разом із вмістом — на низьких viewport-ах (mobile
 * landscape) хрестик зникав би, а рядки списку проїжджали б крізь нього.
 */
function UiSheetContent({
    className,
    children,
    side = 'right',
    hideOverlay = false,
    ...props
}: UiSheetContentProps) {
    return (
        <DialogPrimitive.Portal>
            {!hideOverlay && <UiSheetOverlay />}
            <DialogPrimitive.Content
                className={composeClasses(
                    'bg-background fixed z-50 flex flex-col gap-4 overflow-hidden',
                    'transition ease-in-out',
                    'data-[state=open]:animate-in data-[state=closed]:animate-out',
                    'data-[state=closed]:duration-300 data-[state=open]:duration-500',
                    slideStyles[side],
                    className
                )}
                {...props}
            >
                {children}
                <DialogPrimitive.Close
                    className={composeClasses(
                        // size-11 — touch-target 44×44 за responsive.md §2;
                        // top-2/right-3 тримають іконку там само, де вона
                        // стояла при size-8. `bg-background` обов'язковий:
                        // кнопка висить поверх вмісту, і без підкладки текст,
                        // що проїжджає під нею, змішувався б з хрестиком.
                        // Приглушення живе на самій іконці, а не на кнопці:
                        // `opacity` на кнопці зробила б напівпрозорою і
                        // підкладку, і текст під нею все одно просвічував би.
                        'group bg-background absolute top-2 right-3 flex size-11 cursor-pointer items-center justify-center rounded-md',
                        'focus:ring-ring focus:ring-2 focus:ring-offset-2 focus:outline-none',
                        'disabled:pointer-events-none'
                    )}
                >
                    <X className="size-5 opacity-70 transition-opacity group-hover:opacity-100" />
                    <span className="sr-only">Закрити</span>
                </DialogPrimitive.Close>
            </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
    );
}

/**
 * Єдина прокручувана зона панелі. `min-h-0` обов'язковий — без нього flex-item
 * не стискається нижче власного вмісту і скрол не вмикається взагалі.
 * `overscroll-contain` не пускає прокрутку на сторінку під панеллю.
 */
function UiSheetBody({ className, ...props }: UiSheetBodyProps) {
    return (
        <div
            className={composeClasses(
                'flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain',
                className
            )}
            {...props}
        />
    );
}

function UiSheetHeader({ className, ...props }: UiSheetHeaderProps) {
    return (
        <div
            className={composeClasses(
                'flex shrink-0 flex-col gap-1.5 p-4',
                className
            )}
            {...props}
        />
    );
}

function UiSheetTitle({ className, ...props }: UiSheetTitleProps) {
    return (
        <DialogPrimitive.Title
            className={composeClasses(
                'text-foreground font-semibold',
                className
            )}
            {...props}
        />
    );
}

export {
    UiSheet,
    UiSheetTrigger,
    UiSheetClose,
    UiSheetContent,
    UiSheetBody,
    UiSheetHeader,
    UiSheetTitle,
};
