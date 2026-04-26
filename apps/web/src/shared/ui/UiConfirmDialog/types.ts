import { ReactNode } from 'react';

export type UiConfirmDialogVariant = 'default' | 'destructive';

export interface UiConfirmDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
    title: string;
    description?: string;
    confirmLabel: string;
    cancelLabel: string;
    variant?: UiConfirmDialogVariant;
    loading?: boolean;
    trigger?: ReactNode;
}
