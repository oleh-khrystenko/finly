import { ComponentPropsWithoutRef } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';

export type UiSheetSide = 'top' | 'right' | 'bottom' | 'left';

export type UiSheetProps = ComponentPropsWithoutRef<
    typeof DialogPrimitive.Root
>;

export type UiSheetTriggerProps = ComponentPropsWithoutRef<
    typeof DialogPrimitive.Trigger
>;

export type UiSheetCloseProps = ComponentPropsWithoutRef<
    typeof DialogPrimitive.Close
>;

export interface UiSheetContentProps
    extends ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
    side?: UiSheetSide;
    hideOverlay?: boolean;
}

export type UiSheetHeaderProps = ComponentPropsWithoutRef<'div'>;

export type UiSheetTitleProps = ComponentPropsWithoutRef<
    typeof DialogPrimitive.Title
>;
