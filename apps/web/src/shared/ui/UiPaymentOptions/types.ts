export interface UiPaymentOptionsProps {
    /** НБУ payload-link URLs (primary + legacy host). */
    nbuLinks: { primary: string; legacy: string };
    /** QR-image src на НБУ payload, host=primary. */
    qrPrimary: string;
    /** QR-image src на НБУ payload, host=legacy. */
    qrLegacy: string;
}
