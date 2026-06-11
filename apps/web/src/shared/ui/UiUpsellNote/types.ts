export interface UiUpsellNoteProps {
    /** Чому фіча недоступна на поточному рівні. */
    message: string;
    /** Текст CTA (default «Покращити тариф»). */
    ctaLabel?: string;
    /** Куди веде CTA (default сторінка білінгу). */
    href?: string;
}
