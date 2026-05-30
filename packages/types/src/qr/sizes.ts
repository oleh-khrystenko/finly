/**
 * Sprint 14 — whitelist розмірів брендованого QR.
 *
 * QR не зберігається: рендериться на льоту з HTTP-кешем. Один endpoint віддає
 * різний розмір за параметром, кеш працює окремо per-розмір. Поділ — це
 * **призначення**, не вага файлу: `screen` надлишковий для друку немає сенсу
 * тягнути на екран, `print` недостатній на екрані немає сенсу, але потрібен
 * чітким на папері. Whitelist (а не довільне число) — захист рендеру від
 * перебору важких розмірів.
 */
export const QR_SIZE_PX = {
    screen: 512,
    print: 1024,
} as const;

export type QrSizeName = keyof typeof QR_SIZE_PX;

export const QR_SIZE_NAMES = Object.keys(QR_SIZE_PX) as QrSizeName[];

/** Дефолт без параметра — помірний екранний розмір. */
export const DEFAULT_QR_SIZE_NAME: QrSizeName = 'screen';

export function isQrSizeName(value: string): value is QrSizeName {
    return value in QR_SIZE_PX;
}

export function resolveQrSizePx(name: QrSizeName): number {
    return QR_SIZE_PX[name];
}
