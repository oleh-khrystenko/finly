import { Module } from '@nestjs/common';

import { QrService } from './qr.service';
import { QrImageRenderer } from './renderers/qr-image.renderer';
import { QrLogoCompositor } from './renderers/qr-logo.compositor';

/**
 * QR-модуль: pure NBU-payload будівник (з `@finly/types/qr`) + Node-only
 * рендер (qrcode → PNG buffer + sharp logo overlay).
 *
 * **Без controllers** — модуль експортує лише сервіс, що інжектиться у
 * Sprint 3 controllers (`BusinessesController`, `InvoicesController`) для
 * ендпоінтів типу `GET /businesses/:slug/qr.png`.
 */
@Module({
    providers: [QrService, QrImageRenderer, QrLogoCompositor],
    exports: [QrService],
})
export class QrModule {}
