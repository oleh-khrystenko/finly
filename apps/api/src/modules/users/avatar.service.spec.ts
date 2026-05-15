import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { AVATAR, RESPONSE_CODE } from '@finly/types';

import { StorageService } from '../storage/storage.service';
import { AvatarService } from './avatar.service';
import { User } from './schemas/user.schema';

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

interface MockStorageService {
    createPresignedUploadUrl: jest.Mock;
    getObjectMetadata: jest.Mock;
    uploadBuffer: jest.Mock;
    buildPublicUrl: jest.Mock;
    isR2Url: jest.Mock;
    safeDeleteByKey: jest.Mock;
    safeDeleteByUrl: jest.Mock;
}

function mockStorageService(): MockStorageService {
    return {
        createPresignedUploadUrl: jest.fn(),
        getObjectMetadata: jest.fn(),
        uploadBuffer: jest.fn(),
        buildPublicUrl: jest.fn((key: string) => `${PUBLIC_URL}/${key}`),
        isR2Url: jest.fn((url: string) => url.startsWith(`${PUBLIC_URL}/`)),
        safeDeleteByKey: jest.fn().mockResolvedValue(undefined),
        safeDeleteByUrl: jest.fn().mockResolvedValue(undefined),
    };
}

interface MockUserModel {
    findById: jest.Mock;
    findByIdAndUpdate: jest.Mock;
}

function mockUserModel(): MockUserModel {
    return {
        findById: jest.fn(),
        findByIdAndUpdate: jest.fn(),
    };
}

const execable = <T>(value: T) => ({ exec: () => Promise.resolve(value) });

describe('AvatarService', () => {
    let service: AvatarService;
    let storage: MockStorageService;
    let userModel: MockUserModel;

    beforeEach(async () => {
        storage = mockStorageService();
        userModel = mockUserModel();

        const { randomUUID } = jest.requireMock('crypto');
        randomUUID.mockReset();
        let i = 0;
        randomUUID.mockImplementation(
            () => UUID_QUEUE[Math.min(i++, UUID_QUEUE.length - 1)]
        );

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AvatarService,
                { provide: StorageService, useValue: storage },
                { provide: getModelToken(User.name), useValue: userModel },
            ],
        }).compile();

        service = module.get(AvatarService);
    });

    describe('createAvatarUploadUrl', () => {
        it('generates a fileKey of the form avatars/{userId}/{uuid}.webp', async () => {
            storage.createPresignedUploadUrl.mockResolvedValue({
                uploadUrl: 'https://signed.example/put',
                key: `avatars/${USER_ID}/${UUID_QUEUE[0]}.webp`,
            });

            const result = await service.createAvatarUploadUrl(USER_ID);

            expect(result.fileKey).toBe(
                `avatars/${USER_ID}/${UUID_QUEUE[0]}.webp`
            );
            expect(result.uploadUrl).toBe('https://signed.example/put');
        });

        it('passes contentType=image/webp to the storage layer (no size/length)', async () => {
            storage.createPresignedUploadUrl.mockResolvedValue({
                uploadUrl: 'x',
                key: 'x',
            });

            await service.createAvatarUploadUrl(USER_ID);

            expect(storage.createPresignedUploadUrl).toHaveBeenCalledWith({
                key: `avatars/${USER_ID}/${UUID_QUEUE[0]}.webp`,
                contentType: AVATAR.OUTPUT_FORMAT,
            });
            const call = storage.createPresignedUploadUrl.mock
                .calls[0][0] as unknown as Record<string, unknown>;
            expect(call).not.toHaveProperty('contentLength');
            expect(call).not.toHaveProperty('maxSizeBytes');
        });

        it('maps presign SDK error to AVATAR_UPLOAD_FAILED', async () => {
            storage.createPresignedUploadUrl.mockRejectedValue(
                new Error('R2 is unreachable')
            );

            await expect(
                service.createAvatarUploadUrl(USER_ID)
            ).rejects.toMatchObject({
                response: { code: RESPONSE_CODE.AVATAR_UPLOAD_FAILED },
            });
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
            expect(userModel.findById).not.toHaveBeenCalled();
            expect(storage.getObjectMetadata).not.toHaveBeenCalled();
        });

        it('rejects malformed fileKey even inside the caller namespace', async () => {
            const malformed = `avatars/${USER_ID}/not-a-uuid.webp`;

            await expect(
                service.commitAvatarUpload(USER_ID, malformed)
            ).rejects.toMatchObject({
                response: { code: RESPONSE_CODE.AVATAR_FILE_KEY_INVALID },
            });
            expect(userModel.findById).not.toHaveBeenCalled();
            expect(storage.getObjectMetadata).not.toHaveBeenCalled();
        });

        it('rejects fileKey with wrong extension', async () => {
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

            userModel.findById.mockReturnValue(
                execable({ profile: { avatar: oldUrl } })
            );
            storage.getObjectMetadata.mockResolvedValue({
                exists: true,
                contentType: AVATAR.OUTPUT_FORMAT,
                contentLength: 100_000,
            });
            userModel.findByIdAndUpdate.mockReturnValue(
                execable({ profile: { avatar: newPublicUrl } })
            );

            const result = await service.commitAvatarUpload(USER_ID, validKey);

            expect(result).toBe(newPublicUrl);
            expect(storage.getObjectMetadata).toHaveBeenCalledWith(validKey);
            expect(userModel.findByIdAndUpdate).toHaveBeenCalledWith(
                USER_ID,
                { 'profile.avatar': newPublicUrl },
                { new: true }
            );
            expect(storage.safeDeleteByUrl).toHaveBeenCalledWith(oldUrl);
        });

        it('is idempotent — repeated commit with the same fileKey does not delete the active file', async () => {
            userModel.findById.mockReturnValue(
                execable({ profile: { avatar: newPublicUrl } })
            );

            const result = await service.commitAvatarUpload(USER_ID, validKey);

            expect(result).toBe(newPublicUrl);
            expect(storage.getObjectMetadata).not.toHaveBeenCalled();
            expect(userModel.findByIdAndUpdate).not.toHaveBeenCalled();
            expect(storage.safeDeleteByUrl).not.toHaveBeenCalled();
        });

        it('does not delete the old avatar when it is an external URL', async () => {
            userModel.findById.mockReturnValue(
                execable({
                    profile: {
                        avatar: 'https://lh3.googleusercontent.com/photo.jpg',
                    },
                })
            );
            storage.getObjectMetadata.mockResolvedValue({
                exists: true,
                contentType: AVATAR.OUTPUT_FORMAT,
                contentLength: 50_000,
            });
            userModel.findByIdAndUpdate.mockReturnValue(
                execable({ profile: { avatar: newPublicUrl } })
            );

            await service.commitAvatarUpload(USER_ID, validKey);

            // External URL is passed through, but StorageService.safeDeleteByUrl
            // internally no-ops via isR2Url. We assert the call site routes
            // through that helper rather than touching deleteObject directly.
            expect(storage.safeDeleteByUrl).toHaveBeenCalledWith(
                'https://lh3.googleusercontent.com/photo.jpg'
            );
        });

        it('rejects with AVATAR_UPLOAD_NOT_FOUND when the file is missing in R2', async () => {
            userModel.findById.mockReturnValue(execable({ profile: {} }));
            storage.getObjectMetadata.mockResolvedValue({ exists: false });

            await expect(
                service.commitAvatarUpload(USER_ID, validKey)
            ).rejects.toMatchObject({
                response: { code: RESPONSE_CODE.AVATAR_UPLOAD_NOT_FOUND },
            });
            expect(userModel.findByIdAndUpdate).not.toHaveBeenCalled();
        });

        it('cleans up and rejects with AVATAR_UPLOAD_INVALID when contentType is wrong', async () => {
            userModel.findById.mockReturnValue(execable({ profile: {} }));
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
            expect(storage.safeDeleteByKey).toHaveBeenCalledWith(validKey);
            expect(userModel.findByIdAndUpdate).not.toHaveBeenCalled();
        });

        it('cleans up and rejects with AVATAR_UPLOAD_INVALID when contentLength exceeds the limit', async () => {
            userModel.findById.mockReturnValue(execable({ profile: {} }));
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
            expect(storage.safeDeleteByKey).toHaveBeenCalledWith(validKey);
        });

        it('throws NotFound when the user cannot be loaded', async () => {
            userModel.findById.mockReturnValue(execable(null));

            await expect(
                service.commitAvatarUpload(USER_ID, validKey)
            ).rejects.toBeInstanceOf(NotFoundException);
        });

        it('handles race: profile disappears between findById and findByIdAndUpdate — orphan file cleanup + NotFound', async () => {
            userModel.findById.mockReturnValue(execable({ profile: {} }));
            storage.getObjectMetadata.mockResolvedValue({
                exists: true,
                contentType: AVATAR.OUTPUT_FORMAT,
                contentLength: 50_000,
            });
            userModel.findByIdAndUpdate.mockReturnValue(execable(null));

            await expect(
                service.commitAvatarUpload(USER_ID, validKey)
            ).rejects.toBeInstanceOf(NotFoundException);
            expect(storage.safeDeleteByKey).toHaveBeenCalledWith(validKey);
            // safeDeleteByUrl(oldUrl) must not fire because there was no old
            // URL persisted — the orphan cleanup is only for the just-uploaded
            // file.
            expect(storage.safeDeleteByUrl).not.toHaveBeenCalled();
        });

        it('maps HeadObject SDK error to AVATAR_UPLOAD_FAILED', async () => {
            userModel.findById.mockReturnValue(execable({ profile: {} }));
            storage.getObjectMetadata.mockRejectedValue(
                new Error('R2 timeout')
            );

            await expect(
                service.commitAvatarUpload(USER_ID, validKey)
            ).rejects.toMatchObject({
                response: { code: RESPONSE_CODE.AVATAR_UPLOAD_FAILED },
            });
            expect(userModel.findByIdAndUpdate).not.toHaveBeenCalled();
        });

        it('lets structured HttpException pass through untouched', async () => {
            userModel.findById.mockReturnValue(execable({ profile: {} }));
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

    describe('deleteAvatar', () => {
        it('clears profile.avatar and deletes the R2 file when avatar is an R2 URL', async () => {
            const oldKey = `avatars/${USER_ID}/${UUID_QUEUE[0]}.webp`;
            const oldUrl = `${PUBLIC_URL}/${oldKey}`;

            userModel.findById.mockReturnValue(
                execable({ profile: { avatar: oldUrl } })
            );
            userModel.findByIdAndUpdate.mockReturnValue(
                execable({ profile: {} })
            );

            await service.deleteAvatar(USER_ID);

            expect(userModel.findByIdAndUpdate).toHaveBeenCalledWith(
                USER_ID,
                { $unset: { 'profile.avatar': 1 } },
                { new: true }
            );
            expect(storage.safeDeleteByUrl).toHaveBeenCalledWith(oldUrl);
        });

        it('clears profile.avatar but skips R2 delete when the avatar is an external URL', async () => {
            const externalUrl = 'https://lh3.googleusercontent.com/photo.jpg';
            userModel.findById.mockReturnValue(
                execable({ profile: { avatar: externalUrl } })
            );
            userModel.findByIdAndUpdate.mockReturnValue(
                execable({ profile: {} })
            );

            await service.deleteAvatar(USER_ID);

            expect(userModel.findByIdAndUpdate).toHaveBeenCalled();
            // safeDeleteByUrl forwards to StorageService, which internally
            // routes through isR2Url; we assert the call site passes the URL
            // unchanged.
            expect(storage.safeDeleteByUrl).toHaveBeenCalledWith(externalUrl);
        });

        it('is a no-op for the storage call when the user has no avatar', async () => {
            userModel.findById.mockReturnValue(execable({ profile: {} }));
            userModel.findByIdAndUpdate.mockReturnValue(
                execable({ profile: {} })
            );

            await service.deleteAvatar(USER_ID);

            expect(storage.safeDeleteByUrl).not.toHaveBeenCalled();
        });

        it('throws NotFound when the user cannot be loaded', async () => {
            userModel.findById.mockReturnValue(execable(null));

            await expect(service.deleteAvatar(USER_ID)).rejects.toBeInstanceOf(
                NotFoundException
            );
            expect(userModel.findByIdAndUpdate).not.toHaveBeenCalled();
            expect(storage.safeDeleteByUrl).not.toHaveBeenCalled();
        });
    });

    describe('syncExternalAvatar', () => {
        const externalUrl = 'https://lh3.googleusercontent.com/photo.jpg';
        const r2Url = `${PUBLIC_URL}/avatars/${USER_ID}/${UUID_QUEUE[0]}.webp`;
        const sharpMock = jest.requireMock('sharp');

        beforeEach(() => {
            sharpMock.default.mockClear();
            sharpMock.__pipeline.resize.mockClear();
            sharpMock.__pipeline.webp.mockClear();
            sharpMock.__pipeline.toBuffer.mockClear();
        });

        it('fetches the external URL, resizes via sharp, uploads to R2 and persists the new URL', async () => {
            const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
                ok: true,
                arrayBuffer: async () => new ArrayBuffer(8),
            } as Response);

            storage.uploadBuffer.mockResolvedValue(undefined);
            userModel.findByIdAndUpdate.mockReturnValue(
                execable({
                    profile: {
                        avatar: `${PUBLIC_URL}/avatars/${USER_ID}/${UUID_QUEUE[0]}.webp`,
                    },
                })
            );

            const result = await service.syncExternalAvatar(
                USER_ID,
                externalUrl
            );

            expect(storage.isR2Url).toHaveBeenCalledWith(externalUrl);
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
            const expectedKey = `avatars/${USER_ID}/${UUID_QUEUE[0]}.webp`;
            expect(storage.uploadBuffer).toHaveBeenCalledWith({
                key: expectedKey,
                buffer: sharpMock.__fakeBuffer,
                contentType: AVATAR.OUTPUT_FORMAT,
            });
            const expectedUrl = `${PUBLIC_URL}/${expectedKey}`;
            expect(userModel.findByIdAndUpdate).toHaveBeenCalledWith(
                USER_ID,
                { 'profile.avatar': expectedUrl },
                { new: true }
            );
            expect(result).toBe(expectedUrl);

            fetchSpy.mockRestore();
        });

        it('throws AVATAR_UPLOAD_FAILED when the external fetch returns a non-ok response', async () => {
            const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
                ok: false,
                status: 403,
                arrayBuffer: async () => new ArrayBuffer(0),
            } as Response);

            await expect(
                service.syncExternalAvatar(USER_ID, externalUrl)
            ).rejects.toMatchObject({
                response: { code: RESPONSE_CODE.AVATAR_UPLOAD_FAILED },
            });
            expect(storage.uploadBuffer).not.toHaveBeenCalled();
            expect(userModel.findByIdAndUpdate).not.toHaveBeenCalled();

            fetchSpy.mockRestore();
        });

        it('maps fetch() network failure to AVATAR_UPLOAD_FAILED', async () => {
            const fetchSpy = jest
                .spyOn(globalThis, 'fetch')
                .mockRejectedValue(new Error('ECONNRESET'));

            await expect(
                service.syncExternalAvatar(USER_ID, externalUrl)
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
                service.syncExternalAvatar(USER_ID, externalUrl)
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
                service.syncExternalAvatar(USER_ID, externalUrl)
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
                service.syncExternalAvatar(USER_ID, externalUrl)
            ).rejects.toMatchObject({
                response: { code: RESPONSE_CODE.AVATAR_UPLOAD_FAILED },
            });
            expect(userModel.findByIdAndUpdate).not.toHaveBeenCalled();

            fetchSpy.mockRestore();
        });

        it('handles race: profile disappears between upload and persist — orphan cleanup + NotFound', async () => {
            const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
                ok: true,
                arrayBuffer: async () => new ArrayBuffer(8),
            } as Response);

            storage.uploadBuffer.mockResolvedValue(undefined);
            userModel.findByIdAndUpdate.mockReturnValue(execable(null));

            await expect(
                service.syncExternalAvatar(USER_ID, externalUrl)
            ).rejects.toBeInstanceOf(NotFoundException);

            const expectedKey = `avatars/${USER_ID}/${UUID_QUEUE[0]}.webp`;
            expect(storage.safeDeleteByKey).toHaveBeenCalledWith(expectedKey);

            fetchSpy.mockRestore();
        });

        it('returns null without touching storage or DB when URL is already an R2 URL', async () => {
            const fetchSpy = jest.spyOn(globalThis, 'fetch');

            const result = await service.syncExternalAvatar(USER_ID, r2Url);

            expect(result).toBeNull();
            expect(storage.isR2Url).toHaveBeenCalledWith(r2Url);
            expect(fetchSpy).not.toHaveBeenCalled();
            expect(storage.uploadBuffer).not.toHaveBeenCalled();
            expect(userModel.findByIdAndUpdate).not.toHaveBeenCalled();

            fetchSpy.mockRestore();
        });
    });
});
