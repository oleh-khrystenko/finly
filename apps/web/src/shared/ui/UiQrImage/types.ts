export interface UiQrImageProps {
    src: string;
    alt: string;
    /**
     * Стилі контейнера (рамка, фон, padding, max-width). `aspect-square` і
     * `relative` додаються автоматично — caller передає лише візуальні класи.
     */
    className?: string;
}
