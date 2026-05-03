import type { PayloadVersion } from './format-version';

/**
 * Машинно-читабельні коди помилок payload-валідації.
 *
 * Чому окремий type замість `string`: API-споживач (`QrService` у Sprint 2 §2.3)
 * перетранслює ці коди у `BadRequestException({ code })`, далі веб-сторона
 * мапить їх на українські рядки через `mapApiCode.ts`. Якщо код буде типу
 * `string`, помилки typo не зловляться compile-time.
 *
 * Конвенція `PAYLOAD_*_*` — префікс, щоб коди не зіткнулися з кодами інших
 * модулів (`AUTH_*`, `BILLING_*`, etc.) у тому самому `mapApiCode.ts`.
 */
export const PAYLOAD_ERROR_CODES = [
    'PAYLOAD_FIELD_TOO_LONG_CHARS',
    'PAYLOAD_FIELD_TOO_LONG_BYTES',
    'PAYLOAD_INVALID_FIELD_FORMAT',
    'PAYLOAD_INVALID_AMOUNT',
    'PAYLOAD_INVALID_CHARSET',
    'PAYLOAD_OVERALL_SIZE_EXCEEDED',
    'PAYLOAD_BASE64URL_SIZE_EXCEEDED',
    'PAYLOAD_HOST_REQUIRED',
    'PAYLOAD_NON_COMPLIANT_HOST',
] as const;

export type PayloadErrorCode = (typeof PAYLOAD_ERROR_CODES)[number];

export class PayloadValidationError extends Error {
    public readonly code: PayloadErrorCode;
    public readonly field: string;
    public readonly version: PayloadVersion | null;

    constructor(
        code: PayloadErrorCode,
        field: string,
        version: PayloadVersion | null,
        message?: string
    ) {
        super(
            message ??
                `${code} (field=${field}, version=${version ?? 'n/a'})`
        );
        this.name = 'PayloadValidationError';
        this.code = code;
        this.field = field;
        this.version = version;
    }
}
