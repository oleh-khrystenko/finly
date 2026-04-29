import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AVATAR, RESPONSE_CODE } from '@neatslip/types';

import { UsersService } from '../users/users.service';
import { StorageService } from './storage.service';
import {
    STORAGE_PROVIDER,
    type IStorageProvider,
} from './interfaces/storage-provider.interface';

jest.mock('../../config/env', () => ({
    ENV: { R2_PUBLIC_URL: 'https://media.test.local' },
}));

jest.mock('sharp', () => {
    const fakeBuffer = Buffer.from('webp-bytes');
    const pipeline = {
        resize: jest.fn().mockReturnThis(),
        webp: jest.fn().mockReturnThis(),
        toBuffer: jest.fn().mockResolvedValue(fakeBuffer),
    };
    return {
        __esModule: true,
        default: jest.fn(() => pipeline),
        __pipeline: pipeline,
        __fakeBuffer: fakeBuffer,
    };
});

// Stable, controllable UUIDs for file keys.
const UUID_QUEUE = [
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333',
];
jest.mock('crypto', () => {
    const actual = jest.requireActual('crypto');
    return {
        ...actual,
        randomUUID: jest.fn(),
    };
});

const USER_ID = '507f1f77bcf86cd799439011';
const PUBLIC_URL = 'https://media.test.local';

function mockStorageProvider(): jest.Mocked<IStorageProvider> {
    return {
        generatePresignedUploadUrl: jest.fn(),
        getObjectMetadata: jest.fn(),
        deleteObject: jest.fn(),
        uploadBuffer: jest.fn(),
    };
}

function mockUsersService() {
    return {
        findById: jest.fn(),
        updateProfile: jest.fn(),
        clearAvatar: jest.fn(),
    };
}

describe('StorageService', () => {
    let service: StorageService;
    let storage: jest.Mocked<IStorageProvider>;
    let users: ReturnType<typeof mockUsersService>;

    beforeEach(async () => {
        storage = mockStorageProvider();
        users = mockUsersService();

        const { randomUUID } = jest.requireMock('crypto');
        randomUUID.mockReset();
        let i = 0;
        randomUUID.mockImplementation(
            () => UUID_QUEUE[Math.min(i++, UUID_QUEUE.length - 1)]
        );

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                StorageService,
                { provide: STORAGE_PROVIDER, useValue: storage },
                { provide: UsersService, useValue: users },
            ],
        }).compile();

        service = module.get(StorageService);
    });

    describe('createAvatarUploadUrl', () => {
        it('generates a fileKey of the form avatars/{userId}/{uuid}.webp', async () => {
            storage.generatePresignedUploadUrl.mockResolvedValue({
                uploadUrl: 'https://signed.example/put',
                key: `avatars/${USER_ID}/${UUID_QUEUE[0]}.webp`,
            });

            const result = await service.createAvatarUploadUrl(USER_ID);

            expect(result.fileKey).toBe(
                `avatars/${USER_ID}/${UUID_QUEUE[0]}.webp`
            );
            expect(result.uploadUrl).toBe('https://signed.example/put');
        });

        it('passes contentType=image/webp to the provider (no size/length)', async () => {
            storage.generatePresignedUploadUrl.mockResolvedValue({
                uploadUrl: 'x',
                key: 'x',
            });

            await service.createAvatarUploadUrl(USER_ID);

            expect(storage.generatePresignedUploadUrl).toHaveBeenCalledWith({
                key: `avatars/${USER_ID}/${UUID_QUEUE[0]}.webp`,
                contentType: AVATAR.OUTPUT_FORMAT,
            });
            const call = storage.generatePresignedUploadUrl.mock
                .calls[0][0] as unknown as Record<string, unknown>;
            expect(call).not.toHaveProperty('contentLength');
            expect(call).not.toHaveProperty('maxSizeBytes');
        });
    });

    describe('commitAvatarUpload', () => {
        const validKey = `avatars/${USER_ID}/${UUID_QUEUE[0]}.webp`;
        const newPublicUrl = `${PUBLIC_URL}/${validKey}`;

        it('rejects when fileKey does not belong to the caller', async () => {
            const otherKey = `avatars/aaaaaaaaaaaaaaaaaaaaaaaa/${UUID_QUEUE[0]}.webp`;

            await expect(
                service.commitAvatarUpload(USER_ID, otherKey)
            ).rejects.toMatchObject({
                response: { code: RESPONSE_CODE.AVATAR_FILE_KEY_INVALID },
            });
            expect(users.findById).not.toHaveBeenCalled();
            expect(storage.getObjectMetadata).not.toHaveBeenCalled();
        });

        it('rejects malformed fileKey even inside the caller namespace (AVATAR_FILE_KEY_INVALID, not AVATAR_UPLOAD_NOT_FOUND)', async () => {
            const malformed = `avatars/${USER_ID}/not-a-uuid.webp`;

            await expect(
                service.commitAvatarUpload(USER_ID, malformed)
            ).rejects.toMatchObject({
                response: { code: RESPONSE_CODE.AVATAR_FILE_KEY_INVALID },
            });
            // Must fail before any IO — DB read, metadata fetch, profile write.
            expect(users.findById).not.toHaveBeenCalled();
            expect(storage.getObjectMetadata).not.toHaveBeenCalled();
        });

        it('rejects fileKey with wrong extension (AVATAR_FILE_KEY_INVALID)', async () => {
            const wrongExt = `avatars/${USER_ID}/${UUID_QUEUE[0]}.png`;

            await expect(
                service.commitAvatarUpload(USER_ID, wrongExt)
            ).rejects.toMatchObject({
                response: { code: RESPONSE_CODE.AVATAR_FILE_KEY_INVALID },
            });
        });

        it('validates metadata, updates profile and deletes the old R2 file', async () => {
            const oldKey = `avatars/${USER_ID}/${UUID_QUEUE[1]}.webp`;
            const oldUrl = `${PUBLIC_URL}/${oldKey}`;

            users.findById.mockResolvedValue({
                profile: { avatar: oldUrl },
            });
            storage.getObjectMetadata.mockResolvedValue({
                exists: true,
                contentType: AVATAR.OUTPUT_FORMAT,
                contentLength: 100_000,
            });
            users.updateProfile.mockResolvedValue({
                profile: { avatar: newPublicUrl },
            });
            storage.deleteObject.mockResolvedValue();

            const result = await service.commitAvatarUpload(USER_ID, validKey);

            expect(result).toBe(newPublicUrl);
            expect(storage.getObjectMetadata).toHaveBeenCalledWith(validKey);
            expect(users.updateProfile).toHaveBeenCalledWith(USER_ID, {
                avatar: newPublicUrl,
            });
            expect(storage.deleteObject).toHaveBeenCalledWith(oldKey);
        });

        it('is idempotent — repeated commit with the same fileKey does not delete the active file', async () => {
            users.findById.mockResolvedValue({
                profile: { avatar: newPublicUrl },
            });

            const result = await service.commitAvatarUpload(USER_ID, validKey);

            expect(result).toBe(newPublicUrl);
            expect(storage.getObjectMetadata).not.toHaveBeenCalled();
            expect(users.updateProfile).not.toHaveBeenCalled();
            expect(storage.deleteObject).not.toHaveBeenCalled();
        });

        it('does not delete the old avatar when it is an external URL', async () => {
            users.findById.mockResolvedValue({
                profile: {
                    avatar: 'https://lh3.googleusercontent.com/photo.jpg',
                },
            });
            storage.getObjectMetadata.mockResolvedValue({
                exists: true,
                contentType: AVATAR.OUTPUT_FORMAT,
                contentLength: 50_000,
            });
            users.updateProfile.mockResolvedValue({
                profile: { avatar: newPublicUrl },
            });

            await service.commitAvatarUpload(USER_ID, validKey);

            expect(storage.deleteObject).not.toHaveBeenCalled();
        });

        it('rejects with AVATAR_UPLOAD_NOT_FOUND when the file is missing in R2', async () => {
            users.findById.mockResolvedValue({ profile: {} });
            storage.getObjectMetadata.mockResolvedValue({ exists: false });

            await expect(
                service.commitAvatarUpload(USER_ID, validKey)
            ).rejects.toMatchObject({
                response: { code: RESPONSE_CODE.AVATAR_UPLOAD_NOT_FOUND },
            });
            expect(users.updateProfile).not.toHaveBeenCalled();
        });

        it('cleans up and rejects with AVATAR_UPLOAD_INVALID when contentType is wrong', async () => {
            users.findById.mockResolvedValue({ profile: {} });
            storage.getObjectMetadata.mockResolvedValue({
                exists: true,
                contentType: 'image/png',
                contentLength: 10_000,
            });

            await expect(
                service.commitAvatarUpload(USER_ID, validKey)
            ).rejects.toMatchObject({
                response: { code: RESPONSE_CODE.AVATAR_UPLOAD_INVALID },
            });
            expect(storage.deleteObject).toHaveBeenCalledWith(validKey);
            expect(users.updateProfile).not.toHaveBeenCalled();
        });

        it('cleans up and rejects with AVATAR_UPLOAD_INVALID when contentLength exceeds the limit', async () => {
            users.findById.mockResolvedValue({ profile: {} });
            storage.getObjectMetadata.mockResolvedValue({
                exists: true,
                contentType: AVATAR.OUTPUT_FORMAT,
                contentLength: AVATAR.MAX_FILE_SIZE + 1,
            });

            await expect(
                service.commitAvatarUpload(USER_ID, validKey)
            ).rejects.toMatchObject({
                response: { code: RESPONSE_CODE.AVATAR_UPLOAD_INVALID },
            });
            expect(storage.deleteObject).toHaveBeenCalledWith(validKey);
        });

        it('throws NotFound when the user cannot be loaded', async () => {
            users.findById.mockResolvedValue(null);

            await expect(
                service.commitAvatarUpload(USER_ID, validKey)
            ).rejects.toBeInstanceOf(NotFoundException);
        });
    });

    describe('deleteAvatar', () => {
        it('calls clearAvatar and deletes the R2 file when avatar is an R2 URL', async () => {
            const oldKey = `avatars/${USER_ID}/${UUID_QUEUE[0]}.webp`;
            const oldUrl = `${PUBLIC_URL}/${oldKey}`;

            users.findById.mockResolvedValue({ profile: { avatar: oldUrl } });
            users.clearAvatar.mockResolvedValue({ profile: {} });
            storage.deleteObject.mockResolvedValue();

            await service.deleteAvatar(USER_ID);

            expect(users.clearAvatar).toHaveBeenCalledWith(USER_ID);
            expect(storage.deleteObject).toHaveBeenCalledWith(oldKey);
        });

        it('skips R2 delete when the avatar is an external URL', async () => {
            users.findById.mockResolvedValue({
                profile: {
                    avatar: 'https://lh3.googleusercontent.com/photo.jpg',
                },
            });
            users.clearAvatar.mockResolvedValue({ profile: {} });

            await service.deleteAvatar(USER_ID);

            expect(users.clearAvatar).toHaveBeenCalledWith(USER_ID);
            expect(storage.deleteObject).not.toHaveBeenCalled();
        });

        it('is a no-op for the storage call when the user has no avatar', async () => {
            users.findById.mockResolvedValue({ profile: {} });
            users.clearAvatar.mockResolvedValue({ profile: {} });

            await service.deleteAvatar(USER_ID);

            expect(storage.deleteObject).not.toHaveBeenCalled();
        });
    });

    describe('reUploadExternalAvatar', () => {
        const externalUrl = 'https://lh3.googleusercontent.com/photo.jpg';
        const sharpMock = jest.requireMock('sharp');

        beforeEach(() => {
            sharpMock.default.mockClear();
            sharpMock.__pipeline.resize.mockClear();
            sharpMock.__pipeline.webp.mockClear();
            sharpMock.__pipeline.toBuffer.mockClear();
        });

        it('fetches the external URL, resizes via sharp and uploads to R2', async () => {
            const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
                ok: true,
                arrayBuffer: async () => new ArrayBuffer(8),
            } as Response);

            storage.uploadBuffer.mockResolvedValue();

            const result = await service.reUploadExternalAvatar(
                USER_ID,
                externalUrl
            );

            expect(fetchSpy).toHaveBeenCalledWith(externalUrl);
            expect(sharpMock.default).toHaveBeenCalledTimes(1);
            expect(sharpMock.__pipeline.resize).toHaveBeenCalledWith(
                AVATAR.OUTPUT_SIZE,
                AVATAR.OUTPUT_SIZE,
                { fit: 'cover', position: 'centre' }
            );
            expect(sharpMock.__pipeline.webp).toHaveBeenCalledWith({
                quality: Math.round(AVATAR.OUTPUT_QUALITY * 100),
            });
            expect(storage.uploadBuffer).toHaveBeenCalledWith({
                key: `avatars/${USER_ID}/${UUID_QUEUE[0]}.webp`,
                buffer: sharpMock.__fakeBuffer,
                contentType: AVATAR.OUTPUT_FORMAT,
            });
            expect(result).toBe(
                `${PUBLIC_URL}/avatars/${USER_ID}/${UUID_QUEUE[0]}.webp`
            );

            fetchSpy.mockRestore();
        });

        it('throws AVATAR_UPLOAD_FAILED when the external fetch returns a non-ok response', async () => {
            const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
                ok: false,
                status: 403,
                arrayBuffer: async () => new ArrayBuffer(0),
            } as Response);

            await expect(
                service.reUploadExternalAvatar(USER_ID, externalUrl)
            ).rejects.toMatchObject({
                response: { code: RESPONSE_CODE.AVATAR_UPLOAD_FAILED },
            });
            expect(storage.uploadBuffer).not.toHaveBeenCalled();

            fetchSpy.mockRestore();
        });

        it('maps fetch() network failure to AVATAR_UPLOAD_FAILED', async () => {
            const fetchSpy = jest
                .spyOn(globalThis, 'fetch')
                .mockRejectedValue(new Error('ECONNRESET'));

            await expect(
                service.reUploadExternalAvatar(USER_ID, externalUrl)
            ).rejects.toMatchObject({
                response: { code: RESPONSE_CODE.AVATAR_UPLOAD_FAILED },
            });
            expect(storage.uploadBuffer).not.toHaveBeenCalled();

            fetchSpy.mockRestore();
        });

        it('maps arrayBuffer() streaming failure to AVATAR_UPLOAD_FAILED', async () => {
            const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
                ok: true,
                arrayBuffer: jest
                    .fn<Promise<ArrayBuffer>, []>()
                    .mockRejectedValue(new Error('stream aborted mid-body')),
            } as unknown as Response);

            await expect(
                service.reUploadExternalAvatar(USER_ID, externalUrl)
            ).rejects.toMatchObject({
                response: { code: RESPONSE_CODE.AVATAR_UPLOAD_FAILED },
            });
            expect(storage.uploadBuffer).not.toHaveBeenCalled();

            fetchSpy.mockRestore();
        });

        it('maps sharp re-encode failure to AVATAR_UPLOAD_FAILED', async () => {
            const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
                ok: true,
                arrayBuffer: async () => new ArrayBuffer(8),
            } as Response);

            sharpMock.__pipeline.toBuffer.mockRejectedValueOnce(
                new Error('Input buffer contains unsupported image format')
            );

            await expect(
                service.reUploadExternalAvatar(USER_ID, externalUrl)
            ).rejects.toMatchObject({
                response: { code: RESPONSE_CODE.AVATAR_UPLOAD_FAILED },
            });
            expect(storage.uploadBuffer).not.toHaveBeenCalled();

            fetchSpy.mockRestore();
        });

        it('maps uploadBuffer SDK failure to AVATAR_UPLOAD_FAILED', async () => {
            const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
                ok: true,
                arrayBuffer: async () => new ArrayBuffer(8),
            } as Response);

            storage.uploadBuffer.mockRejectedValueOnce(
                new Error('R2 network error')
            );

            await expect(
                service.reUploadExternalAvatar(USER_ID, externalUrl)
            ).rejects.toMatchObject({
                response: { code: RESPONSE_CODE.AVATAR_UPLOAD_FAILED },
            });

            fetchSpy.mockRestore();
        });
    });

    describe('provider-error mapping', () => {
        const validKey = `avatars/${USER_ID}/${UUID_QUEUE[0]}.webp`;

        it('maps presign SDK error to AVATAR_UPLOAD_FAILED', async () => {
            storage.generatePresignedUploadUrl.mockRejectedValue(
                new Error('R2 is unreachable')
            );

            await expect(
                service.createAvatarUploadUrl(USER_ID)
            ).rejects.toMatchObject({
                response: { code: RESPONSE_CODE.AVATAR_UPLOAD_FAILED },
            });
        });

        it('maps HeadObject SDK error to AVATAR_UPLOAD_FAILED', async () => {
            users.findById.mockResolvedValue({ profile: {} });
            storage.getObjectMetadata.mockRejectedValue(
                new Error('R2 timeout')
            );

            await expect(
                service.commitAvatarUpload(USER_ID, validKey)
            ).rejects.toMatchObject({
                response: { code: RESPONSE_CODE.AVATAR_UPLOAD_FAILED },
            });
            expect(users.updateProfile).not.toHaveBeenCalled();
        });

        it('lets structured HttpException (e.g. BadRequest with its own code) pass through untouched', async () => {
            // getObjectMetadata is not expected to throw HttpException in the
            // real world, but the mapper must never rewrite our own codes.
            users.findById.mockResolvedValue({ profile: {} });
            const passthrough = new BadRequestException({
                code: RESPONSE_CODE.AVATAR_UPLOAD_INVALID,
                message: 'custom',
            });
            storage.getObjectMetadata.mockRejectedValue(passthrough);

            await expect(
                service.commitAvatarUpload(USER_ID, validKey)
            ).rejects.toBe(passthrough);
        });
    });

    describe('safeDeleteR2File (via commit old-file cleanup)', () => {
        const validKey = `avatars/${USER_ID}/${UUID_QUEUE[0]}.webp`;
        const newPublicUrl = `${PUBLIC_URL}/${validKey}`;

        it('does not propagate provider errors when cleaning up the old R2 file', async () => {
            const oldUrl = `${PUBLIC_URL}/avatars/${USER_ID}/${UUID_QUEUE[1]}.webp`;
            users.findById.mockResolvedValue({
                profile: { avatar: oldUrl },
            });
            storage.getObjectMetadata.mockResolvedValue({
                exists: true,
                contentType: AVATAR.OUTPUT_FORMAT,
                contentLength: 10_000,
            });
            users.updateProfile.mockResolvedValue({
                profile: { avatar: newPublicUrl },
            });
            storage.deleteObject.mockRejectedValue(new Error('R2 is down'));

            // Must resolve successfully despite the cleanup failure.
            await expect(
                service.commitAvatarUpload(USER_ID, validKey)
            ).resolves.toBe(newPublicUrl);
        });
    });

    it('exposes isR2Url that matches the configured prefix', () => {
        expect(service.isR2Url(`${PUBLIC_URL}/avatars/u/x.webp`)).toBe(true);
        expect(service.isR2Url('https://lh3.googleusercontent.com/p.jpg')).toBe(
            false
        );
    });

    it('rejects with BadRequestException carrying the right code on ownership failure', async () => {
        await expect(
            service.commitAvatarUpload(
                USER_ID,
                `avatars/bbbbbbbbbbbbbbbbbbbbbbbb/${UUID_QUEUE[0]}.webp`
            )
        ).rejects.toBeInstanceOf(BadRequestException);
    });
});
