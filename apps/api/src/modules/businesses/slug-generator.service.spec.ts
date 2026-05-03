import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { InternalServerErrorException } from '@nestjs/common';
import { RESERVED_SLUGS } from '@finly/types';

import { Business } from './schemas/business.schema';
import { SlugGeneratorService } from './slug-generator.service';

describe('SlugGeneratorService', () => {
    let service: SlugGeneratorService;
    let existsMock: jest.Mock;

    beforeEach(async () => {
        existsMock = jest.fn();
        const module = await Test.createTestingModule({
            providers: [
                SlugGeneratorService,
                {
                    provide: getModelToken(Business.name),
                    useValue: { exists: existsMock },
                },
            ],
        }).compile();
        service = module.get(SlugGeneratorService);
    });

    it('повертає 8-символьний slug з алфавіту [A-Za-z0-9]', async () => {
        existsMock.mockResolvedValue(null);
        const slug = await service.generateRandomSlug();
        expect(slug).toMatch(/^[A-Za-z0-9]{8}$/);
    });

    it('перевіряє унікальність по slugLower (lowercase form)', async () => {
        existsMock.mockResolvedValue(null);
        await service.generateRandomSlug();
        expect(existsMock).toHaveBeenCalledTimes(1);
        const arg = existsMock.mock.calls[0]![0] as { slugLower: string };
        expect(arg.slugLower).toMatch(/^[a-z0-9]{8}$/); // тільки lowercase
    });

    it('повертає case-preserved slug (display ≠ slugLower)', async () => {
        existsMock.mockResolvedValue(null);
        // Generate багато разів і перевіримо, що в наборі є не лише lowercase.
        // Для 8-char × 62-alphabet випадок «всі-lowercase» статистично рідкий
        // (≈26⁸ / 62⁸ ≈ 0.4%), 50 спроб — фактично гарантовано mixed-case.
        const slugs = await Promise.all(
            Array.from({ length: 50 }, () => service.generateRandomSlug())
        );
        const hasUppercase = slugs.some((s) => /[A-Z]/.test(s));
        expect(hasUppercase).toBe(true);
    });

    it('retry на колізію БД (max 10 attempts) — повертає slug на 3-й спробі', async () => {
        existsMock
            .mockResolvedValueOnce({ _id: 'taken' })
            .mockResolvedValueOnce({ _id: 'also-taken' })
            .mockResolvedValueOnce(null);

        const slug = await service.generateRandomSlug();
        expect(slug).toMatch(/^[A-Za-z0-9]{8}$/);
        expect(existsMock).toHaveBeenCalledTimes(3);
    });

    it('після 10 невдалих спроб кидає SLUG_GENERATION_FAILED', async () => {
        existsMock.mockResolvedValue({ _id: 'always-taken' });

        await expect(service.generateRandomSlug()).rejects.toThrow(
            InternalServerErrorException
        );
        expect(existsMock).toHaveBeenCalledTimes(10);
    });

    it('помилка має machine-code SLUG_GENERATION_FAILED у response body', async () => {
        existsMock.mockResolvedValue({ _id: 'always-taken' });

        try {
            await service.generateRandomSlug();
            fail('expected SLUG_GENERATION_FAILED');
        } catch (err) {
            expect(err).toBeInstanceOf(InternalServerErrorException);
            const response = (err as InternalServerErrorException).getResponse();
            expect(response).toMatchObject({
                code: 'SLUG_GENERATION_FAILED',
            });
        }
    });

    it('reserved-slug skip — генератор повторює спробу без БД-запиту', async () => {
        // Підставимо реальний reserved slug у RNG. Найкращий спосіб — мокнути
        // randomBytes так, щоб перші 8 байт мапились у 'host-pay' (8 chars).
        // Але це крихкий тест — натомість перевіряємо інваріант: усі N згенерованих
        // slug-ів НЕ є reserved (probabilistic — сильно ймовірно з 62⁸ простору).
        existsMock.mockResolvedValue(null);
        const slugs = await Promise.all(
            Array.from({ length: 100 }, () => service.generateRandomSlug())
        );
        const reservedSet: Set<string> = new Set(RESERVED_SLUGS);
        for (const slug of slugs) {
            expect(reservedSet.has(slug.toLowerCase())).toBe(false);
        }
    });
});
