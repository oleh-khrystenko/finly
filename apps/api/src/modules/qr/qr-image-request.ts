import { BadRequestException } from '@nestjs/common';
import { Response } from 'express';
import {
    DEFAULT_QR_SIZE_NAME,
    isQrSizeName,
    QR_SIZE_NAMES,
    resolveQrSizePx,
    RESPONSE_CODE,
} from '@finly/types';

/**
 * Sprint 14 — спільний парсинг query-параметрів брендованих QR-image-
 * endpoint-ів (бізнес / рахунок / інвойс, обидва типи). Той самий контракт на
 * всіх рівнях:
 *   - `?size=screen|print` — whitelist (`QR_SIZE_PX`); без параметра — дефолт
 *     екранний. Довільне число відхиляється (захист рендеру від перебору).
 *   - `?download=1` — змушує браузер зберегти файл (`Content-Disposition:
 *     attachment`) замість inline-показу. Друкарське завантаження — це той
 *     самий endpoint з `size=print&download=1`, не окремий файл.
 */
export function resolveQrSizePxFromQuery(
    sizeParam: string | undefined
): number {
    if (sizeParam === undefined) {
        return resolveQrSizePx(DEFAULT_QR_SIZE_NAME);
    }
    if (!isQrSizeName(sizeParam)) {
        throw new BadRequestException({
            code: RESPONSE_CODE.VALIDATION_ERROR,
            message: `Query param "size" must be one of: ${QR_SIZE_NAMES.join(', ')}`,
        });
    }
    return resolveQrSizePx(sizeParam);
}

export function isQrDownloadRequested(
    downloadParam: string | undefined
): boolean {
    return downloadParam === '1' || downloadParam === 'true';
}

/**
 * Ставить `Content-Disposition: attachment` лише коли запит — на завантаження.
 * Content-Type / Cache-Control лишаються на endpoint-і (різні per-рівень).
 */
export function applyQrDownloadDisposition(
    res: Response,
    download: boolean,
    filename: string
): void {
    if (download) {
        res.setHeader(
            'Content-Disposition',
            `attachment; filename="${filename}"`
        );
    }
}
