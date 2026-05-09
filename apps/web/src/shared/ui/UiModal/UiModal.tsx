'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { composeClasses } from '@/shared/lib';
import type {
    UiModalProps,
    UiModalTriggerProps,
    UiModalCloseProps,
    UiModalContentProps,
    UiModalHeaderProps,
    UiModalTitleProps,
} from './types';

function UiModal({ ...props }: UiModalProps) {
    return <DialogPrimitive.Root {...props} />;
}

function UiModalTrigger({ ...props }: UiModalTriggerProps) {
    return <DialogPrimitive.Trigger {...props} />;
}

function UiModalClose({ ...props }: UiModalCloseProps) {
    return <DialogPrimitive.Close {...props} />;
}

function UiModalOverlay({ className }: { className?: string }) {
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

function UiModalContent({
    className,
    children,
    hideOverlay = false,
    hideCloseButton = false,
    ...props
}: UiModalContentProps) {
    return (
        <DialogPrimitive.Portal>
            {!hideOverlay && <UiModalOverlay />}
            <DialogPrimitive.Content
                className={composeClasses(
                    'bg-background fixed z-50 flex flex-col',
                    'transition ease-in-out',
                    'data-[state=open]:animate-in data-[state=closed]:animate-out',
                    'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
                    'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
                    'data-[state=closed]:duration-200 data-[state=open]:duration-300',
                    // Mobile: bottom sheet layout
                    'inset-x-0 bottom-0 max-h-[90vh] overflow-y-auto rounded-t-2xl border-t shadow-[0_-10px_40px_-10px_rgba(0,0,0,0.15)]',
                    // Desktop: centered modal layout
                    'md:inset-auto md:top-1/2 md:left-1/2 md:max-h-[85vh] md:w-full md:max-w-lg md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:border md:shadow-lg',
                    className
                )}
                {...props}
            >
                {children}
                {!hideCloseButton && (
                    <DialogPrimitive.Close
                        className={composeClasses(
                            'absolute top-3 right-4 flex size-8 cursor-pointer items-center justify-center rounded-md opacity-70 transition-opacity',
                            'focus:ring-ring hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-none',
                            'disabled:pointer-events-none'
                        )}
                    >
                        <X className="size-5" />
                        <span className="sr-only">Close</span>
                    </DialogPrimitive.Close>
                )}
            </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
    );
}

function UiModalHeader({ className, ...props }: UiModalHeaderProps) {
    return (
        <div
            className={composeClasses('flex flex-col gap-1.5 p-4', className)}
            {...props}
        />
    );
}

function UiModalTitle({ className, ...props }: UiModalTitleProps) {
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
    UiModal,
    UiModalTrigger,
    UiModalClose,
    UiModalContent,
    UiModalHeader,
    UiModalTitle,
};
