/**
 * Машинно-читабельні коди помилок QR-рендеру (image/composition layer).
 *
 * Окремо від `PayloadValidationError` (`packages/types/src/qr/errors.ts`):
 * payload-помилки виникають у shared pure-логіці, render-помилки — у
 * NestJS-injectable рендерерах із Node-only залежностями (qrcode, sharp).
 *
 * Коди — для маппінгу у HTTP-помилки `QrService` → BadRequest/InternalServer
 * → mapApiCode.ts на web-стороні (Sprint 3 wiring).
 */
export const QR_RENDER_ERROR_CODES = [
    'QR_LOGO_TOO_LARGE',
    'QR_LOGO_INVALID',
    'QR_RENDER_FAILED',
] as const;

export type QrRenderErrorCode = (typeof QR_RENDER_ERROR_CODES)[number];

export class QrRenderError extends Error {
    public readonly code: QrRenderErrorCode;

    constructor(code: QrRenderErrorCode, message?: string) {
        super(message ?? code);
        this.name = 'QrRenderError';
        this.code = code;
    }
}
