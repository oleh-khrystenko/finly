import { Module } from '@nestjs/common';

import { QrController } from './qr.controller';
import { QrService } from './qr.service';
import { QrImageRenderer } from './renderers/qr-image.renderer';
import { QrLogoCompositor } from './renderers/qr-logo.compositor';

/**
 * QR-модуль: pure NBU-payload будівник (з `@finly/types/qr`) + Node-only
 * рендер (qrcode → PNG buffer + sharp logo overlay).
 *
 * **Controllers:** `QrController` (Sprint 8 §8.1) — публічний preview-ендпоінт
 * `POST /qr/preview` для anon-лендингу. Сервіс також реюзається cabinet-
 * та public-controller-ами Business/Invoice-модулів для QR PNG ендпоінтів —
 * це за рахунок `exports: [QrService]`, не controller-а.
 */
@Module({
    controllers: [QrController],
    providers: [QrService, QrImageRenderer, QrLogoCompositor],
    exports: [QrService],
})
export class QrModule {}
