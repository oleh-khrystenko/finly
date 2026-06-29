export interface UiBrandLogoProps {
    src: string;
    alt: string;
    /** Косметичний підпис бренду поряд з лого. `null`/відсутній → лише лого. */
    displayName?: string | null;
    className?: string;
}
