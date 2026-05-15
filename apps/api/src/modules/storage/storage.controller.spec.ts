import { Test, TestingModule } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';
import { APP_PIPE } from '@nestjs/core';
import { RESPONSE_CODE } from '@finly/types';

import { AvatarService } from '../users/avatar.service';
import { StorageController } from './storage.controller';
import { JwtActiveGuard } from '../../common/guards/jwt-active.guard';
import { CommitAvatarUploadDto } from './dto/commit-avatar-upload.dto';

const USER_ID = '507f1f77bcf86cd799439011';
const VALID_FILE_KEY = `avatars/${USER_ID}/11111111-1111-1111-1111-111111111111.webp`;
const PUBLIC_URL = `https://media.test.local/${VALID_FILE_KEY}`;

const mockUser = {
    _id: { toString: () => USER_ID },
} as never;

const mockAvatarService = {
    createAvatarUploadUrl: jest.fn(),
    commitAvatarUpload: jest.fn(),
    deleteAvatar: jest.fn(),
};

describe('StorageController', () => {
    let controller: StorageController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [StorageController],
            providers: [
                { provide: AvatarService, useValue: mockAvatarService },
                { provide: APP_PIPE, useClass: ZodValidationPipe },
            ],
        })
            .overrideGuard(JwtActiveGuard)
            .useValue({ canActivate: () => true })
            .compile();

        controller = module.get(StorageController);
        jest.clearAllMocks();
    });

    describe('POST /storage/avatar/upload-url', () => {
        it('returns { data: { uploadUrl, fileKey } } from the service', async () => {
            mockAvatarService.createAvatarUploadUrl.mockResolvedValue({
                uploadUrl: 'https://signed.example/put',
                fileKey: VALID_FILE_KEY,
            });

            const result = await controller.createAvatarUploadUrl(mockUser);

            expect(
                mockAvatarService.createAvatarUploadUrl
            ).toHaveBeenCalledWith(USER_ID);
            expect(result).toEqual({
                data: {
                    uploadUrl: 'https://signed.example/put',
                    fileKey: VALID_FILE_KEY,
                },
            });
        });
    });

    describe('POST /storage/avatar/commit', () => {
        it('returns { data: { avatar, code: AVATAR_UPDATED } } on success', async () => {
            mockAvatarService.commitAvatarUpload.mockResolvedValue(PUBLIC_URL);

            const dto = { fileKey: VALID_FILE_KEY } as CommitAvatarUploadDto;
            const result = await controller.commitAvatarUpload(mockUser, dto);

            expect(mockAvatarService.commitAvatarUpload).toHaveBeenCalledWith(
                USER_ID,
                VALID_FILE_KEY
            );
            expect(result).toEqual({
                data: {
                    avatar: PUBLIC_URL,
                    code: RESPONSE_CODE.AVATAR_UPDATED,
                },
            });
        });

        it('rejects a fileKey that does not match the Zod schema', () => {
            const pipe = new ZodValidationPipe(CommitAvatarUploadDto);

            expect(() =>
                pipe.transform({ fileKey: 'not-a-valid-key' }, {
                    type: 'body',
                    metatype: CommitAvatarUploadDto,
                } as never)
            ).toThrow();
        });
    });

    describe('DELETE /storage/avatar', () => {
        it('returns { data: { code: AVATAR_DELETED } } and invokes the service', async () => {
            mockAvatarService.deleteAvatar.mockResolvedValue(undefined);

            const result = await controller.deleteAvatar(mockUser);

            expect(mockAvatarService.deleteAvatar).toHaveBeenCalledWith(
                USER_ID
            );
            expect(result).toEqual({
                data: { code: RESPONSE_CODE.AVATAR_DELETED },
            });
        });
    });
});
