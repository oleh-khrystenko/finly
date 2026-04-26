import type { ComponentPropsWithoutRef } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';

export type UiModalProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Root>;
export type UiModalTriggerProps = ComponentPropsWithoutRef<
    typeof DialogPrimitive.Trigger
>;
export type UiModalCloseProps = ComponentPropsWithoutRef<
    typeof DialogPrimitive.Close
>;

export interface UiModalContentProps
    extends ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
    hideOverlay?: boolean;
    hideCloseButton?: boolean;
}

export type UiModalHeaderProps = React.HTMLAttributes<HTMLDivElement>;
export type UiModalTitleProps = ComponentPropsWithoutRef<
    typeof DialogPrimitive.Title
>;
