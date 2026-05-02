import { Injectable } from '@nestjs/common';
import * as QRCode from 'qrcode';

import { QrRenderError } from '../errors';

/**
 * Допустимі рівні корекції помилок QR-коду.
 *
 * Норматив (Додаток 1 §III.13 ст. 5): для 002/003 з логотипом — `M` або `Q`
 * (`L` заборонено через лого). Sprint 2 §2.0 фіксує `Q` як дефолт для
 * максимальної надлишковості при overlay-стійкості (~25% площі дозволено
 * перекривати).
 *
 * Чому `Q`, а не `H`: Додаток 4 §IV.10.4 ст. 28 явно перелічує дозволені
 * рівні для 003 — `M` або `Q` (без `H`). `H` хоча й дає 30% надлишковості
 * (sprint plan §2.3 початкова пропозиція), не відповідає нормативу 003.
 * Деталі — docs/product/qr-spec/diff-002-003.md "Рівень корекції помилок".
 */
export type QrErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

export interface QrRenderOptions {
    /** Ширина/висота згенерованої PNG у пікселях. */
    sizePx: number;
    /** Рівень корекції помилок. Дефолт у `QrService` — `Q`. */
    errorCorrection: QrErrorCorrectionLevel;
}

/**
 * `QrImageRenderer` — pure адаптер над бібліотекою `qrcode`.
 * Не знає про NBU payload, бренд Finly, лого — усе це вище за стеком
 * (`QrLogoCompositor`, `QrService`).
 *
 * Margin = 2 модулі — нормативний "quiet zone" для надійного зчитування.
 */
@Injectable()
export class QrImageRenderer {
    async render(text: string, opts: QrRenderOptions): Promise<Buffer> {
        try {
            return await QRCode.toBuffer(text, {
                width: opts.sizePx,
                margin: 2,
                errorCorrectionLevel: opts.errorCorrection,
                color: { dark: '#000000', light: '#FFFFFF' },
            });
        } catch (cause) {
            throw new QrRenderError(
                'QR_RENDER_FAILED',
                cause instanceof Error
                    ? cause.message
                    : 'qrcode.toBuffer failed'
            );
        }
    }
}
