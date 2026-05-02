import { Test } from '@nestjs/testing';

import {
    PayloadValidationError,
    type PayloadInput,
} from '@finly/types';

import { QrService } from './qr.service';
import { QrImageRenderer } from './renderers/qr-image.renderer';
import { QrLogoCompositor } from './renderers/qr-logo.compositor';

const VALID_INPUT: PayloadInput = {
    receiverName: 'ФОП Іваненко',
    iban: 'UA213223130000026007233566001',
    receiverTaxId: '1234567899',
    amountKopecks: 35000,
    purpose: 'Оплата консультації',
};

describe('QrService — orchestration (mocked renderers)', () => {
    let service: QrService;
    let imageRenderer: jest.Mocked<QrImageRenderer>;
    let logoCompositor: jest.Mocked<QrLogoCompositor>;

    beforeEach(async () => {
        const moduleRef = await Test.createTestingModule({
            providers: [
                QrService,
                {
                    provide: QrImageRenderer,
                    useValue: { render: jest.fn() },
                },
                {
                    provide: QrLogoCompositor,
                    useValue: { compose: jest.fn() },
                },
            ],
        }).compile();
        service = moduleRef.get(QrService);
        imageRenderer = moduleRef.get(QrImageRenderer);
        logoCompositor = moduleRef.get(QrLogoCompositor);

        imageRenderer.render.mockResolvedValue(Buffer.from('fake-qr'));
        logoCompositor.compose.mockResolvedValue(Buffer.from('fake-qr+logo'));
    });

    describe('renderForUrl', () => {
        it('передає URL без змін у imageRenderer.render', async () => {
            await service.renderForUrl('https://pay.finly.com.ua/ivanenko');
            expect(imageRenderer.render).toHaveBeenCalledWith(
                'https://pay.finly.com.ua/ivanenko',
                expect.objectContaining({ errorCorrection: 'Q', sizePx: 512 })
            );
        });

        it('за дефолтом накладає лого через logoCompositor', async () => {
            const result = await service.renderForUrl('https://pay.finly.com.ua/x');
            expect(logoCompositor.compose).toHaveBeenCalled();
            expect(result.toString()).toBe('fake-qr+logo');
        });

        it('пропускає logoCompositor, якщо includeLogo=false', async () => {
            const result = await service.renderForUrl(
                'https://pay.finly.com.ua/x',
                { includeLogo: false }
            );
            expect(logoCompositor.compose).not.toHaveBeenCalled();
            expect(result.toString()).toBe('fake-qr');
        });

        it('передає custom sizePx у обидва шари', async () => {
            await service.renderForUrl('https://x.test', { sizePx: 1024 });
            expect(imageRenderer.render).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ sizePx: 1024 })
            );
            expect(logoCompositor.compose).toHaveBeenCalledWith(
                expect.any(Buffer),
                expect.any(String),
                expect.objectContaining({ qrSizePx: 1024 })
            );
        });
    });

    describe('renderForNbuPayload', () => {
        it('будує 002-payload і обгортає в bank.gov.ua/qr/...', async () => {
            await service.renderForNbuPayload(VALID_INPUT, '002');
            const renderedText = imageRenderer.render.mock.calls[0]?.[0];
            expect(renderedText).toMatch(/^https:\/\/bank\.gov\.ua\/qr\//);
        });

        it('будує 003-payload і обгортає в qr.bank.gov.ua/...', async () => {
            await service.renderForNbuPayload(VALID_INPUT, '003');
            const renderedText = imageRenderer.render.mock.calls[0]?.[0];
            // env у test-setup.ts = qr.bank.gov.ua за дефолтом.
            expect(renderedText).toMatch(/^https:\/\/qr\.bank\.gov\.ua\//);
        });

        it('пропагує PayloadValidationError для невалідного input (наприклад, IBAN)', async () => {
            await expect(
                service.renderForNbuPayload(
                    { ...VALID_INPUT, iban: 'UA000000000000000000000000000' },
                    '003'
                )
            ).rejects.toBeInstanceOf(PayloadValidationError);
            // Renderer не викликається при payload-помилці — early reject.
            expect(imageRenderer.render).not.toHaveBeenCalled();
        });

        it('payload-помилка не fall-back-ить на URL-метод', async () => {
            // Гарантія, що NBU-помилки не маскуються у renderForUrl-фолбек.
            await expect(
                service.renderForNbuPayload(
                    { ...VALID_INPUT, receiverTaxId: '0000000001' },
                    '003'
                )
            ).rejects.toBeInstanceOf(PayloadValidationError);
        });
    });
});
