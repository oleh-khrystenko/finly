import { BrandMarkCacheService } from './brand-mark-cache.service';
import type { BusinessDocument } from './schemas/business.schema';

/**
 * BrandMarkCacheService: довіра активному слоту (ніколи pending), кеш байтів за
 * URL, fallback на Finly (null) при збої завантаження.
 */
describe('BrandMarkCacheService', () => {
    function makeService(download: jest.Mock) {
        const storage = { downloadByPublicUrl: download };
        return new BrandMarkCacheService(storage as never);
    }

    function businessWith(brand: BusinessDocument['brand']): BusinessDocument {
        return { brand } as unknown as BusinessDocument;
    }

    const ACTIVE = {
        active: {
            logoUrl: 'https://media/brand-logos/x/a.png',
            centerMarkUrl: 'https://media/brand-logos/x/c-center.png',
            bandMarkUrl: 'https://media/brand-logos/x/c-band.png',
            displayName: null,
        },
        pending: null,
    };

    it('повертає null коли немає активного бренду', async () => {
        const download = jest.fn();
        const service = makeService(download);

        expect(
            await service.getActiveCenterMark(businessWith(null))
        ).toBeNull();
        expect(download).not.toHaveBeenCalled();
    });

    it('ігнорує pending-слот (рендериться лише active)', async () => {
        const download = jest.fn();
        const service = makeService(download);
        const business = businessWith({
            active: null,
            pending: { ...ACTIVE.active, uploadedAt: new Date() },
        });

        expect(await service.getActiveCenterMark(business)).toBeNull();
        expect(download).not.toHaveBeenCalled();
    });

    it('завантажує й кешує байти центральної марки (другий виклик — без R2)', async () => {
        const bytes = Buffer.from('center-bytes');
        const download = jest.fn().mockResolvedValue(bytes);
        const service = makeService(download);
        const business = businessWith(ACTIVE);

        const first = await service.getActiveCenterMark(business);
        const second = await service.getActiveCenterMark(business);

        expect(first).toBe(bytes);
        expect(second).toBe(bytes);
        expect(download).toHaveBeenCalledTimes(1);
        expect(download).toHaveBeenCalledWith(ACTIVE.active.centerMarkUrl);
    });

    it('band-марка тягне bandMarkUrl', async () => {
        const download = jest.fn().mockResolvedValue(Buffer.from('band'));
        const service = makeService(download);

        await service.getActiveBandMark(businessWith(ACTIVE));
        expect(download).toHaveBeenCalledWith(ACTIVE.active.bandMarkUrl);
    });

    it('fallback на Finly (null) при збої завантаження', async () => {
        const download = jest.fn().mockRejectedValue(new Error('R2 down'));
        const service = makeService(download);

        expect(
            await service.getActiveCenterMark(businessWith(ACTIVE))
        ).toBeNull();
    });
});
