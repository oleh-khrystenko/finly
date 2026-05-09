'use client';

import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import { composeClasses } from '@/shared/lib';
import UiSpinner from '@/shared/ui/UiSpinner';
import type { UiConfirmDialogProps } from './types';

function UiConfirmDialog({
    open,
    onOpenChange,
    onConfirm,
    title,
    description,
    confirmLabel,
    cancelLabel,
    variant = 'default',
    loading = false,
    trigger,
}: UiConfirmDialogProps) {
    return (
        <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
            {trigger && (
                <AlertDialogPrimitive.Trigger asChild>
                    {trigger}
                </AlertDialogPrimitive.Trigger>
            )}

            <AlertDialogPrimitive.Portal>
                <AlertDialogPrimitive.Overlay
                    className={composeClasses(
                        'fixed inset-0 z-50 bg-black/50',
                        'data-[state=open]:animate-in data-[state=closed]:animate-out',
                        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0'
                    )}
                />

                <AlertDialogPrimitive.Content
                    className={composeClasses(
                        'bg-background fixed top-1/2 left-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2',
                        'border-border rounded-lg border p-6 shadow-lg',
                        'data-[state=open]:animate-in data-[state=closed]:animate-out',
                        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
                        'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95'
                    )}
                >
                    <AlertDialogPrimitive.Title className="text-foreground text-lg font-semibold">
                        {title}
                    </AlertDialogPrimitive.Title>

                    {description && (
                        <AlertDialogPrimitive.Description className="text-muted-foreground mt-2 text-sm">
                            {description}
                        </AlertDialogPrimitive.Description>
                    )}

                    <div className="mt-6 flex justify-end gap-3">
                        <AlertDialogPrimitive.Cancel
                            className={composeClasses(
                                'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium',
                                'border-border bg-background text-foreground border',
                                'cursor-pointer disabled:cursor-not-allowed',
                                'hover:bg-accent focus:ring-ring focus:ring-2 focus:ring-offset-2 focus:outline-none',
                                'disabled:pointer-events-none disabled:opacity-50'
                            )}
                            disabled={loading}
                        >
                            {cancelLabel}
                        </AlertDialogPrimitive.Cancel>

                        <AlertDialogPrimitive.Action
                            className={composeClasses(
                                'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium',
                                'cursor-pointer disabled:cursor-not-allowed',
                                'focus:ring-ring focus:ring-2 focus:ring-offset-2 focus:outline-none',
                                'disabled:pointer-events-none disabled:opacity-50',
                                variant === 'destructive'
                                    ? 'border-destructive text-destructive hover:bg-destructive/10 border'
                                    : 'bg-primary text-primary-foreground hover:bg-primary/90'
                            )}
                            onClick={(e) => {
                                e.preventDefault();
                                onConfirm?.();
                            }}
                            disabled={loading}
                        >
                            {loading ? <UiSpinner size="sm" /> : confirmLabel}
                        </AlertDialogPrimitive.Action>
                    </div>
                </AlertDialogPrimitive.Content>
            </AlertDialogPrimitive.Portal>
        </AlertDialogPrimitive.Root>
    );
}

UiConfirmDialog.displayName = 'UiConfirmDialog';

export default UiConfirmDialog;
