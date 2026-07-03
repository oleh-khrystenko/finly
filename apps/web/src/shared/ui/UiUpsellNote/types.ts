import type { ReactNode } from 'react';

export interface UiUpsellNoteProps {
    /** Чому фіча недоступна на поточному рівні. */
    message: string;
    /** Текст CTA (default «Покращити тариф»). */
    ctaLabel?: string;
    /** Куди веде CTA (default сторінка білінгу). */
    href?: string;
    /**
     * Кастомний блок дій замість дефолтної CTA-кнопки (стек-лейаут).
     * `ctaLabel`/`href` при цьому ігноруються.
     */
    actions?: ReactNode;
}
