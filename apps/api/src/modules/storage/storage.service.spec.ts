import { Test, TestingModule } from '@nestjs/testing';

import { StorageService } from './storage.service';
import {
    STORAGE_PROVIDER,
    type IStorageProvider,
} from './interfaces/storage-provider.interface';

jest.mock('../../config/env', () => ({
    ENV: { R2_PUBLIC_URL: 'https://media.test.local' },
}));

const PUBLIC_URL = 'https://media.test.local';

function mockStorageProvider(): jest.Mocked<IStorageProvider> {
    return {
        generatePresignedUploadUrl: jest.fn(),
        getObjectMetadata: jest.fn(),
        deleteObject: jest.fn(),
        uploadBuffer: jest.fn(),
    };
}

describe('StorageService (Sprint 13: pure file-ops)', () => {
    let service: StorageService;
    let provider: jest.Mocked<IStorageProvider>;

    beforeEach(async () => {
        provider = mockStorageProvider();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                StorageService,
                { provide: STORAGE_PROVIDER, useValue: provider },
            ],
        }).compile();

        service = module.get(StorageService);
    });

    describe('createPresignedUploadUrl', () => {
        it('delegates to the provider and returns its result', async () => {
            provider.generatePresignedUploadUrl.mockResolvedValue({
                uploadUrl: 'https://signed.example/put',
                key: 'some/key.webp',
            });

            const result = await service.createPresignedUploadUrl({
                key: 'some/key.webp',
                contentType: 'image/webp',
            });

            expect(provider.generatePresignedUploadUrl).toHaveBeenCalledWith({
                key: 'some/key.webp',
                contentType: 'image/webp',
            });
            expect(result).toEqual({
                uploadUrl: 'https://signed.example/put',
                key: 'some/key.webp',
            });
        });

        it('propagates provider errors without wrapping', async () => {
            const err = new Error('R2 down');
            provider.generatePresignedUploadUrl.mockRejectedValue(err);

            await expect(
                service.createPresignedUploadUrl({
                    key: 'k',
                    contentType: 'image/webp',
                })
            ).rejects.toBe(err);
        });
    });

    describe('getObjectMetadata', () => {
        it('delegates to the provider', async () => {
            provider.getObjectMetadata.mockResolvedValue({
                exists: true,
                contentType: 'image/webp',
                contentLength: 1234,
            });

            const meta = await service.getObjectMetadata('avatars/u/x.webp');

            expect(provider.getObjectMetadata).toHaveBeenCalledWith(
                'avatars/u/x.webp'
            );
            expect(meta).toEqual({
                exists: true,
                contentType: 'image/webp',
                contentLength: 1234,
            });
        });
    });

    describe('uploadBuffer', () => {
        it('delegates to the provider', async () => {
            provider.uploadBuffer.mockResolvedValue(undefined);

            const buffer = Buffer.from('x');
            await service.uploadBuffer({
                key: 'k',
                buffer,
                contentType: 'image/webp',
            });

            expect(provider.uploadBuffer).toHaveBeenCalledWith({
                key: 'k',
                buffer,
                contentType: 'image/webp',
            });
        });
    });

    describe('buildPublicUrl / isR2Url', () => {
        it('builds public URL from key', () => {
            expect(service.buildPublicUrl('avatars/u/x.webp')).toBe(
                `${PUBLIC_URL}/avatars/u/x.webp`
            );
        });

        it('recognizes R2 URLs', () => {
            expect(service.isR2Url(`${PUBLIC_URL}/avatars/u/x.webp`)).toBe(
                true
            );
            expect(
                service.isR2Url('https://lh3.googleusercontent.com/p.jpg')
            ).toBe(false);
        });
    });

    describe('safeDeleteByKey', () => {
        it('calls deleteObject and resolves on success', async () => {
            provider.deleteObject.mockResolvedValue();

            await service.safeDeleteByKey('avatars/u/x.webp');

            expect(provider.deleteObject).toHaveBeenCalledWith(
                'avatars/u/x.webp'
            );
        });

        it('swallows provider errors (best-effort delete)', async () => {
            provider.deleteObject.mockRejectedValue(new Error('R2 is down'));

            await expect(
                service.safeDeleteByKey('avatars/u/x.webp')
            ).resolves.toBeUndefined();
        });
    });

    describe('safeDeleteByUrl', () => {
        it('deletes via key when URL is an R2 URL', async () => {
            provider.deleteObject.mockResolvedValue();

            await service.safeDeleteByUrl(`${PUBLIC_URL}/avatars/u/x.webp`);

            expect(provider.deleteObject).toHaveBeenCalledWith(
                'avatars/u/x.webp'
            );
        });

        it('is a no-op for external URLs', async () => {
            await service.safeDeleteByUrl(
                'https://lh3.googleusercontent.com/p.jpg'
            );

            expect(provider.deleteObject).not.toHaveBeenCalled();
        });

        it('swallows provider errors (best-effort delete)', async () => {
            provider.deleteObject.mockRejectedValue(new Error('R2 is down'));

            await expect(
                service.safeDeleteByUrl(`${PUBLIC_URL}/avatars/u/x.webp`)
            ).resolves.toBeUndefined();
        });
    });
});
