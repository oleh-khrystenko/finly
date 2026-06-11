'use client';

import { Lock } from 'lucide-react';
import UiButton from '../UiButton';
import type { UiUpsellNoteProps } from './types';

/**
 * Sprint 19 — компактний upsell-блок для замкнених фіч (редагування slug понад
 * Free, ліміти бізнесів). Пояснює обмеження і веде на білінг. Generic-примітив
 * у shared/ui, щоб feature-шари не імпортували один одного (FSD).
 */
export default function UiUpsellNote({
    message,
    ctaLabel = 'Покращити тариф',
    href = '/billing',
}: UiUpsellNoteProps) {
    return (
        <div className="border-primary/30 bg-primary/5 flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
                <Lock className="text-primary h-4 w-4 shrink-0" />
                {message}
            </p>
            <UiButton
                as="link"
                href={href}
                variant="filled"
                size="sm"
                className="shrink-0"
            >
                {ctaLabel}
            </UiButton>
        </div>
    );
}
