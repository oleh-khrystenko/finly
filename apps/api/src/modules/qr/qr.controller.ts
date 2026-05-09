import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { NBU_HOST_PRIMARY, type QrPreviewResponse } from '@finly/types';

import { SkipOnboarding } from '../../common/decorators/skip-onboarding.decorator';
import { QrPreviewDto } from './dto/qr-preview.dto';
import { QrService } from './qr.service';

/**
 * Sprint 8 §8.1 — публічний QR-preview-ендпоінт для анонімних користувачів.
 *
 * **Без auth, без cookie, без БД.** Reuse `QrService.renderForNbuPayload`
 * 1:1 — payload-pipeline той самий, що cabinet/public business-зони.
 * Жодних змін у service-layer-і; controller — тонкий wrapper, що мапить
 * Sprint-8 input-shape (`{ taxId, ... }`) на `PayloadInput`-shape
 * (`{ receiverTaxId, ... }`).
 *
 * **Throttle bucket `'qr-preview'` (10/min/IP).** Окремий від `'public-payment'`
 * (600/min) і `'default'` (60/min) бо це інша поверхня атаки: payload-перебір
 * тут потенційно дешевший за full payment-page-hit (нема БД-lookup-у бізнесу,
 * лише payload-build + PNG-encode). Тримаємо restrictive — навіть з NAT-
 * агрегацією 10/min вистачає легітимним користувачам (одна форма, одна
 * генерація на спробу). `@SkipThrottle({ default: true })` явно вимикає
 * default-bucket — інакше обидва throttler-и спрацюють, і реальний поріг
 * стане min(10, 60) = 10, але budget випалюватиметься з обох count-ерів.
 *
 * **`@SkipOnboarding()`** — глобальний `OnboardingInterceptor` пропустимо
 * явно: запит anon-only, немає `request.user` для перевірки onboarding-стану;
 * без декоратора interceptor падає при спробі прочитати profile.
 *
 * **Чому два виклики `QrService` (render + link), а не один.**
 * `renderForNbuPayload` всередині конструює лінк (build → encode → wrap), але
 * повертає лише PNG. Експонувати link-out з нього як return-shape — invasive
 * у service-API, що зараз shared із BusinessesController/InvoicesController
 * (всі повертають `Buffer`). Простіше — два виклики, payload будується двічі
 * (~50µs на build + Base64URL). Якщо профілювання покаже bottleneck — додати
 * service-overload `{ png, link }` для одного pipeline-проходу. Поки —
 * premature optimization.
 */
@SkipThrottle({ default: true })
@Throttle({ 'qr-preview': { limit: 10, ttl: 60_000 } })
@Controller('qr')
export class QrController {
    constructor(private readonly qrService: QrService) {}

    @SkipOnboarding()
    @Post('preview')
    @HttpCode(HttpStatus.OK)
    async preview(
        @Body() dto: QrPreviewDto
    ): Promise<{ data: QrPreviewResponse }> {
        // Single payload-input shape для обох викликів — гарантує, що PNG і
        // link кодують identичний payload (drift unmöglich).
        const payloadInput = {
            receiverName: dto.receiverName,
            iban: dto.iban,
            receiverTaxId: dto.taxId,
            amountKopecks: null,
            purpose: dto.purpose,
        } as const;

        const png = await this.qrService.renderForNbuPayload(
            payloadInput,
            '003',
            { host: NBU_HOST_PRIMARY }
        );
        const link = this.qrService.buildNbuPayloadLinkForInput(
            payloadInput,
            NBU_HOST_PRIMARY
        );

        return {
            data: {
                link,
                qrPngBase64: png.toString('base64'),
            },
        };
    }
}
