import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import sharp = require('sharp');
import { BRAND_COMMIT_OUTCOME, RESPONSE_CODE } from '@finly/types';

import { BrandService } from './brand.service';
import type { BusinessDocument } from './schemas/business.schema';

/**
 * BrandService: гейтинг outcome (active vs pending) і серверна валідація образу
 * (аспект, «майже білий», namespace). Реальний sharp на згенерованих образах;
 * storage / baker / qr / моделі — моки.
 */
describe('BrandService', () => {
    const businessId = new Types.ObjectId();
    const FILE_KEY = `brand-logos/${businessId.toString()}/12345678-1234-1234-1234-123456789abc.png`;

    function makeImage(
        width: number,
        height: number,
        gray: number
    ): Promise<Buffer> {
        return sharp({
            create: {
                width,
                height,
                channels: 3,
                background: { r: gray, g: gray, b: gray },
            },
        })
            .png()
            .toBuffer();
    }

    function makeBusiness(branded = false): BusinessDocument {
        return {
            _id: businessId,
            slug: 'kvity',
            name: 'Квіти',
            taxId: '1234567899',
            paymentPurposeTemplate: 'Оплата',
            brand: null,
            // Sprint 27 — гейт логотипа per-business: `isPaid = brandedAt != null`.
            brandedAt: branded ? new Date() : null,
        } as unknown as BusinessDocument;
    }

    function makeDeps(logo: Buffer) {
        const storage = {
            createPresignedUploadUrl: jest.fn(),
            getObjectMetadata: jest.fn().mockResolvedValue({
                exists: true,
                contentType: 'image/png',
                contentLength: 1000,
            }),
            downloadObject: jest.fn().mockResolvedValue(logo),
            uploadBuffer: jest.fn().mockResolvedValue(undefined),
            buildPublicUrl: jest.fn((key: string) => `https://media/${key}`),
            safeDeleteByKey: jest.fn().mockResolvedValue(undefined),
            safeDeleteByUrl: jest.fn().mockResolvedValue(undefined),
        };
        const baker = {
            bake: jest.fn().mockResolvedValue({
                centerMark: Buffer.from('center'),
                bandMark: Buffer.from('band'),
            }),
        };
        const qrService = {
            renderForUrl: jest.fn(),
            renderForNbuPayload: jest.fn(),
        };
        const businessModel = {
            findByIdAndUpdate: jest
                .fn()
                .mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
        };
        const accountModel = {
            findOne: jest.fn(),
        };
        const service = new BrandService(
            businessModel as never,
            accountModel as never,
            storage as never,
            baker as never,
            qrService as never
        );
        return { service, storage, baker, businessModel };
    }

    it('доступ ≥ brand → outcome active, pending очищено', async () => {
        const logo = await makeImage(300, 150, 20);
        const { service, baker, businessModel } = makeDeps(logo);

        const result = await service.commit(
            makeBusiness(true),
            FILE_KEY,
            'Квіти'
        );

        expect(result.outcome).toBe(BRAND_COMMIT_OUTCOME.ACTIVE);
        expect(result.brand.active).not.toBeNull();
        expect(result.brand.pending).toBeNull();
        expect(baker.bake).toHaveBeenCalledWith(logo, 'Квіти');
        expect(businessModel.findByIdAndUpdate).toHaveBeenCalled();
    });

    it('доступ нижче brand → outcome pending з uploadedAt, active не чіпається', async () => {
        const logo = await makeImage(300, 150, 20);
        const { service } = makeDeps(logo);

        const result = await service.commit(makeBusiness(), FILE_KEY, null);

        expect(result.outcome).toBe(BRAND_COMMIT_OUTCOME.PENDING);
        expect(result.brand.active).toBeNull();
        expect(result.brand.pending).not.toBeNull();
        expect(result.brand.pending?.uploadedAt).toBeInstanceOf(Date);
        // Free-завантаження — короткий поріг чистки.
        expect(result.brand.pending?.demoted).toBe(false);
    });

    it('вертикальне зображення → BRAND_LOGO_ASPECT_INVALID', async () => {
        const logo = await makeImage(100, 200, 20);
        const { service, storage } = makeDeps(logo);

        await expect(
            service.commit(makeBusiness(), FILE_KEY, null)
        ).rejects.toMatchObject({
            response: { code: RESPONSE_CODE.BRAND_LOGO_ASPECT_INVALID },
        });
        expect(storage.safeDeleteByKey).toHaveBeenCalledWith(FILE_KEY);
    });

    it('надто витягнутий горизонтальний логотип → BRAND_LOGO_TOO_WIDE', async () => {
        // 1400×100 = 14:1, далеко за межею MAX_ASPECT_RATIO.
        const logo = await makeImage(1400, 100, 20);
        const { service, storage } = makeDeps(logo);

        await expect(
            service.commit(makeBusiness(), FILE_KEY, null)
        ).rejects.toMatchObject({
            response: { code: RESPONSE_CODE.BRAND_LOGO_TOO_WIDE },
        });
        expect(storage.safeDeleteByKey).toHaveBeenCalledWith(FILE_KEY);
    });

    it('майже білий логотип → BRAND_LOGO_TOO_LIGHT', async () => {
        const logo = await makeImage(300, 150, 250);
        const { service } = makeDeps(logo);

        await expect(
            service.commit(makeBusiness(), FILE_KEY, null)
        ).rejects.toMatchObject({
            response: { code: RESPONSE_CODE.BRAND_LOGO_TOO_LIGHT },
        });
    });

    it('file key поза namespace бізнесу → BRAND_LOGO_FILE_KEY_INVALID', async () => {
        const logo = await makeImage(300, 150, 20);
        const { service } = makeDeps(logo);
        const alien = `brand-logos/${new Types.ObjectId().toString()}/12345678-1234-1234-1234-123456789abc.png`;

        await expect(
            service.commit(makeBusiness(), alien, null)
        ).rejects.toBeInstanceOf(BadRequestException);
    });
});
