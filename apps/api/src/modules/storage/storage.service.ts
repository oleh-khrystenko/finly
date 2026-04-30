import { randomUUID } from 'crypto';

import {
    BadRequestException,
    HttpException,
    Inject,
    Injectable,
    InternalServerErrorException,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import sharp from 'sharp';
import { AVATAR, AVATAR_FILE_KEY_REGEX, RESPONSE_CODE } from '@finly/types';

import { ENV } from '../../config/env';
import { UsersService } from '../users/users.service';
import {
    STORAGE_PROVIDER,
    type IStorageProvider,
} from './interfaces/storage-provider.interface';

interface AvatarUploadUrlResult {
    uploadUrl: string;
    fileKey: string;
}

@Injectable()
export class StorageService {
    private readonly logger = new Logger(StorageService.name);

    constructor(
        @Inject(STORAGE_PROVIDER)
        private readonly storage: IStorageProvider,

        private readonly usersService: UsersService
    ) {}

    async createAvatarUploadUrl(
        userId: string
    ): Promise<AvatarUploadUrlResult> {
        const fileKey = `avatars/${userId}/${randomUUID()}.webp`;

        const { uploadUrl } = await this.mapStorageError(
            () =>
                this.storage.generatePresignedUploadUrl({
                    key: fileKey,
                    contentType: AVATAR.OUTPUT_FORMAT,
                }),
            'presign avatar upload'
        );

        return { uploadUrl, fileKey };
    }

    async commitAvatarUpload(userId: string, fileKey: string): Promise<string> {
        // Shape check — rejects malformed keys (e.g. missing UUID, wrong
        // extension) even if they live under the caller's namespace. Must run
        // before ownership check so a bogus key never reaches the storage layer.
        if (!AVATAR_FILE_KEY_REGEX.test(fileKey)) {
            throw new BadRequestException({
                code: RESPONSE_CODE.AVATAR_FILE_KEY_INVALID,
                message: 'File key does not match expected format',
            });
        }

        // Namespace check — prevents one user committing another user's key.
        if (!fileKey.startsWith(`avatars/${userId}/`)) {
            throw new BadRequestException({
                code: RESPONSE_CODE.AVATAR_FILE_KEY_INVALID,
                message: 'File key does not belong to caller',
            });
        }

        const newPublicUrl = this.buildPublicUrl(fileKey);

        // Idempotency guard — a duplicate commit for the file already bound to
        // the profile would otherwise pass `oldUrl` into `safeDeleteR2File`,
        // deleting the file we just stored. Return the existing URL instead.
        const user = await this.usersService.findById(userId);
        if (!user) {
            throw new NotFoundException('User not found');
        }

        const oldUrl = user.profile.avatar;
        if (oldUrl === newPublicUrl) {
            return newPublicUrl;
        }

        const metadata = await this.mapStorageError(
            () => this.storage.getObjectMetadata(fileKey),
            'read avatar metadata'
        );
        if (!metadata.exists) {
            throw new BadRequestException({
                code: RESPONSE_CODE.AVATAR_UPLOAD_NOT_FOUND,
                message: 'Uploaded file not found',
            });
        }

        if (
            metadata.contentType !== AVATAR.OUTPUT_FORMAT ||
            metadata.contentLength > AVATAR.MAX_FILE_SIZE
        ) {
            // Cleanup the invalid upload BEFORE rejecting — leaving it in the
            // bucket defeats the point of HeadObject enforcement.
            await this.safeDeleteKey(fileKey);
            throw new BadRequestException({
                code: RESPONSE_CODE.AVATAR_UPLOAD_INVALID,
                message: 'Uploaded file has invalid type or size',
            });
        }

        const updated = await this.usersService.updateProfile(userId, {
            avatar: newPublicUrl,
        });
        if (!updated) {
            // Race: profile disappeared between findById and updateProfile.
            // Best-effort cleanup of the orphan file and abort.
            await this.safeDeleteKey(fileKey);
            throw new NotFoundException('User not found');
        }

        if (oldUrl) {
            await this.safeDeleteR2File(oldUrl);
        }

        return newPublicUrl;
    }

    async deleteAvatar(userId: string): Promise<void> {
        const user = await this.usersService.findById(userId);
        if (!user) {
            throw new NotFoundException('User not found');
        }

        const currentUrl = user.profile.avatar;
        await this.usersService.clearAvatar(userId);

        if (currentUrl) {
            await this.safeDeleteR2File(currentUrl);
        }
    }

    /**
     * Fetch an external avatar (e.g. Google OAuth `photos[0].value`), re-encode
     * to WebP 512×512, and upload into the user's avatars namespace.
     * HTTP download lives here (not in the provider) because it is storage-agnostic.
     * All failure modes in the pipeline map to `AVATAR_UPLOAD_FAILED` so the
     * caller can surface a consistent, actionable code to the client.
     */
    async reUploadExternalAvatar(
        userId: string,
        externalUrl: string
    ): Promise<string> {
        const response = await this.mapStorageError(
            () => fetch(externalUrl),
            'fetch external avatar'
        );
        if (!response.ok) {
            throw this.buildUploadFailedError(
                `External avatar fetch returned ${response.status}`
            );
        }

        // `response.arrayBuffer()` streams the body — a mid-stream abort or a
        // server-side connection drop rejects the promise with a raw error.
        // Wrap it so the pipeline contract (all failures → AVATAR_UPLOAD_FAILED)
        // holds end-to-end.
        const arrayBuffer = await this.mapStorageError(
            () => response.arrayBuffer(),
            'read external avatar body'
        );
        const input = Buffer.from(arrayBuffer);

        const buffer = await this.mapStorageError(
            () =>
                sharp(input)
                    .resize(AVATAR.OUTPUT_SIZE, AVATAR.OUTPUT_SIZE, {
                        fit: 'cover',
                        position: 'centre',
                    })
                    .webp({
                        quality: Math.round(AVATAR.OUTPUT_QUALITY * 100),
                    })
                    .toBuffer(),
            're-encode external avatar'
        );

        const fileKey = `avatars/${userId}/${randomUUID()}.webp`;
        await this.mapStorageError(
            () =>
                this.storage.uploadBuffer({
                    key: fileKey,
                    buffer,
                    contentType: AVATAR.OUTPUT_FORMAT,
                }),
            'upload re-encoded avatar'
        );

        return this.buildPublicUrl(fileKey);
    }

    isR2Url(url: string): boolean {
        return url.startsWith(`${ENV.R2_PUBLIC_URL}/`);
    }

    private buildPublicUrl(key: string): string {
        return `${ENV.R2_PUBLIC_URL}/${key}`;
    }

    private extractKeyFromR2Url(url: string): string {
        return url.slice(ENV.R2_PUBLIC_URL.length + 1);
    }

    /**
     * Wrap a storage-pipeline operation so raw SDK / network / sharp errors
     * surface to clients as `AVATAR_UPLOAD_FAILED` rather than the filter's
     * generic `INTERNAL_ERROR`. Already-structured `HttpException`s (e.g. our
     * own `BadRequestException` with a specific code) pass through untouched.
     */
    private async mapStorageError<T>(
        op: () => Promise<T>,
        operationLabel: string
    ): Promise<T> {
        try {
            return await op();
        } catch (err) {
            if (err instanceof HttpException) {
                throw err;
            }
            const error = err as Error;
            this.logger.error(
                `Avatar storage operation failed (${operationLabel}): ${error.message}`,
                error.stack
            );
            throw this.buildUploadFailedError(
                `Avatar ${operationLabel} failed`
            );
        }
    }

    private buildUploadFailedError(
        message: string
    ): InternalServerErrorException {
        return new InternalServerErrorException({
            code: RESPONSE_CODE.AVATAR_UPLOAD_FAILED,
            message,
        });
    }

    /**
     * Best-effort deletion of an R2 file referenced by its public URL.
     * Awaited so failures are logged, but never propagated — a stale orphan
     * in the bucket is a smaller problem than rolling back a successful commit.
     */
    private async safeDeleteR2File(url: string): Promise<void> {
        if (!this.isR2Url(url)) return;
        await this.safeDeleteKey(this.extractKeyFromR2Url(url));
    }

    private async safeDeleteKey(key: string): Promise<void> {
        try {
            await this.storage.deleteObject(key);
        } catch (err) {
            this.logger.warn(
                `Failed to delete R2 object "${key}": ${(err as Error).message}`
            );
        }
    }
}
