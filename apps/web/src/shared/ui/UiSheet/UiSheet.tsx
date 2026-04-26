'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { composeClasses } from '@/shared/lib';
import type {
    UiSheetProps,
    UiSheetTriggerProps,
    UiSheetCloseProps,
    UiSheetContentProps,
    UiSheetHeaderProps,
    UiSheetTitleProps,
    UiSheetSide,
} from './types';

const slideStyles: Record<UiSheetSide, string> = {
    right: 'inset-y-0 right-0 h-full w-3/4 border-l shadow-lg data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm',
    left: 'inset-y-0 left-0 h-full w-3/4 border-r shadow-lg data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm',
    top: 'inset-x-0 top-0 h-auto border-b shadow-lg data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top',
    bottom: 'inset-x-0 bottom-0 h-auto rounded-t-2xl border-t shadow-[0_-10px_40px_-10px_rgba(0,0,0,0.15)] data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
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
                    'bg-background fixed z-50 flex flex-col gap-4',
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
                        'absolute top-3 right-4 flex size-8 items-center justify-center rounded-md opacity-70 transition-opacity',
                        'hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-none',
                        'disabled:pointer-events-none'
                    )}
                >
                    <X className="size-5" />
                    <span className="sr-only">Close</span>
                </DialogPrimitive.Close>
            </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
    );
}

function UiSheetHeader({ className, ...props }: UiSheetHeaderProps) {
    return (
        <div
            className={composeClasses(
                'flex flex-col gap-1.5 p-4',
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
    UiSheetHeader,
    UiSheetTitle,
};
