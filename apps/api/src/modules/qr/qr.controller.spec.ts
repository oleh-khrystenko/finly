import { Test, TestingModule } from '@nestjs/testing';
import { APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { NBU_HOST_PRIMARY } from '@finly/types';

import { QrController } from './qr.controller';
import { QrService } from './qr.service';
import { QrPreviewDto } from './dto/qr-preview.dto';

const VALID_INPUT = {
    receiverName: 'Іваненко Олена Петрівна',
    iban: 'UA213223130000026007233566001',
    taxId: '1234567899',
    purpose: 'Поповнення рахунку',
};

const FAKE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const FAKE_LINK = `https://${NBU_HOST_PRIMARY}/eyJ0ZXN0Ijoi`;

describe('QrController', () => {
    let controller: QrController;
    let qrService: jest.Mocked<QrService>;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [QrController],
            providers: [
                {
                    provide: QrService,
                    useValue: {
                        renderForNbuPayload: jest
                            .fn()
                            .mockResolvedValue(FAKE_PNG),
                        buildNbuPayloadLinkForInput: jest
                            .fn()
                            .mockReturnValue(FAKE_LINK),
                    },
                },
                { provide: APP_PIPE, useClass: ZodValidationPipe },
            ],
        }).compile();

        controller = module.get(QrController);
        qrService = module.get(QrService);
    });

    describe('POST /qr/preview', () => {
        it('повертає { data: { link, qrPngBase64 } } з NBU_HOST_PRIMARY', async () => {
            const result = await controller.preview(
                VALID_INPUT as QrPreviewDto
            );

            expect(result).toEqual({
                data: {
                    link: FAKE_LINK,
                    qrPngBase64: FAKE_PNG.toString('base64'),
                },
            });
        });

        it('передає payload-input з amountKopecks=null (виставочний QR без суми)', async () => {
            await controller.preview(VALID_INPUT as QrPreviewDto);

            const expectedPayload = {
                receiverName: VALID_INPUT.receiverName,
                iban: VALID_INPUT.iban,
                receiverTaxId: VALID_INPUT.taxId,
                amountKopecks: null,
                purpose: VALID_INPUT.purpose,
            };

            expect(qrService.renderForNbuPayload).toHaveBeenCalledWith(
                expectedPayload,
                '003',
                { host: NBU_HOST_PRIMARY }
            );
            expect(qrService.buildNbuPayloadLinkForInput).toHaveBeenCalledWith(
                expectedPayload,
                NBU_HOST_PRIMARY
            );
        });

        it('мапить input.taxId → payload.receiverTaxId (Sprint 8 — public-shape vs NBU-shape)', async () => {
            // Захист від drift-у: Sprint 8 contract називає поле `taxId`,
            // NBU PayloadInput — `receiverTaxId`. Перейменування полів
            // у одному з двох контрактів не повинно тихо ламати mapping.
            await controller.preview(VALID_INPUT as QrPreviewDto);

            const passedPayload = qrService.renderForNbuPayload.mock
                .calls[0][0] as { receiverTaxId: string };
            expect(passedPayload.receiverTaxId).toBe(VALID_INPUT.taxId);
        });
    });

    describe('QrPreviewDto — Zod-validation через ZodValidationPipe', () => {
        const pipe = new ZodValidationPipe(QrPreviewDto);
        const meta = { type: 'body', metatype: QrPreviewDto } as never;

        it('пропускає valid payload', () => {
            expect(() => pipe.transform(VALID_INPUT, meta)).not.toThrow();
        });

        it('rejects невалідний IBAN', () => {
            expect(() =>
                pipe.transform(
                    { ...VALID_INPUT, iban: 'UA000000000000000000000000000' },
                    meta
                )
            ).toThrow();
        });

        it('rejects taxId з failing checksum (РНОКПП)', () => {
            expect(() =>
                pipe.transform({ ...VALID_INPUT, taxId: '1234567890' }, meta)
            ).toThrow();
        });

        it('rejects empty purpose', () => {
            expect(() =>
                pipe.transform({ ...VALID_INPUT, purpose: '' }, meta)
            ).toThrow();
        });

        it('rejects empty receiverName (trim → empty)', () => {
            expect(() =>
                pipe.transform({ ...VALID_INPUT, receiverName: '   ' }, meta)
            ).toThrow();
        });

        it('rejects unknown field через .strict() (anon-form attack-surface narrowing)', () => {
            expect(() =>
                pipe.transform(
                    { ...VALID_INPUT, type: 'fop' } as Record<string, unknown>,
                    meta
                )
            ).toThrow();
        });

        // Sprint 8 fix — NBU-charset refine на entity-level конвертує
        // PayloadValidationError(500) у VALIDATION_ERROR(400). Без refine
        // anon endpoint віддавав 500 на user input з emoji.
        it('rejects emoji у receiverName (NBU charset reject → 400)', () => {
            expect(() =>
                pipe.transform(
                    { ...VALID_INPUT, receiverName: "☕ Кав'ярня" },
                    meta
                )
            ).toThrow();
        });

        it('rejects emoji у purpose (NBU charset reject → 400)', () => {
            expect(() =>
                pipe.transform({ ...VALID_INPUT, purpose: 'Оплата 🍵' }, meta)
            ).toThrow();
        });
    });
});
