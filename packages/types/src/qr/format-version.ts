/**
 * Версії формату NBU QR-payload, які підтримує Finly.
 *
 * 002 — fallback (Додаток 3 постанови № 97 від 19.08.2025).
 * 003 — основний (Додаток 4 постанови № 97 від 19.08.2025).
 *
 * 001 свідомо не підтримуємо: він не має гіперпосилання, тому непридатний для
 * платіжного флоу через мобільні застосунки (Додаток 1 §V.23.2).
 *
 * Конвенція `as const` повторює Sprint 1 (`USER_ROLES`, `BUSINESS_TYPES`,
 * `MVP_BANKS`) — один source of truth для Zod (`z.enum(PAYLOAD_VERSIONS)`),
 * TS-type, runtime check.
 *
 * Джерело: docs/product/qr-spec/README.md.
 */
export const PAYLOAD_VERSIONS = ['002', '003'] as const;

export type PayloadVersion = (typeof PAYLOAD_VERSIONS)[number];

export const isPayloadVersion = (value: string): value is PayloadVersion =>
    (PAYLOAD_VERSIONS as readonly string[]).includes(value);
