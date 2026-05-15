import { randomUUID } from 'crypto';

import {
    BadRequestException,
    HttpException,
    Injectable,
    InternalServerErrorException,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import sharp from 'sharp';
import { AVATAR, AVATAR_FILE_KEY_REGEX, RESPONSE_CODE } from '@finly/types';

import { StorageService } from '../storage/storage.service';
import { User, UserDocument } from './schemas/user.schema';

interface AvatarUploadUrlResult {
    uploadUrl: string;
    fileKey: string;
}

/**
 * Sprint 13 §13 — domain-owner аватарки. До Sprint 13 ця логіка жила у
 * `StorageService` і робила profile-update через `UsersService`, що утворювало
 * цикл `Storage → Users → Auth → Storage`. Тепер AvatarService живе всередині
 * `UsersModule` поруч з `UsersService` і модифікує User-документ напряму через
 * `userModel`, а `StorageService` спустився до pure file-ops.
 */
@Injectable()
export class AvatarService {
    private readonly logger = new Logger(AvatarService.name);

    constructor(
        @InjectModel(User.name)
        private readonly userModel: Model<UserDocument>,
        private readonly storage: StorageService
    ) {}

    async createAvatarUploadUrl(
        userId: string
    ): Promise<AvatarUploadUrlResult> {
        const fileKey = `avatars/${userId}/${randomUUID()}.webp`;

        const { uploadUrl } = await this.mapStorageError(
            () =>
                this.storage.createPresignedUploadUrl({
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

        const newPublicUrl = this.storage.buildPublicUrl(fileKey);

        // Idempotency guard — a duplicate commit for the file already bound to
        // the profile would otherwise pass `oldUrl` into `safeDeleteByUrl`,
        // deleting the file we just stored. Return the existing URL instead.
        const user = await this.userModel.findById(userId).exec();
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
            await this.storage.safeDeleteByKey(fileKey);
            throw new BadRequestException({
                code: RESPONSE_CODE.AVATAR_UPLOAD_INVALID,
                message: 'Uploaded file has invalid type or size',
            });
        }

        const updated = await this.userModel
            .findByIdAndUpdate(
                userId,
                { 'profile.avatar': newPublicUrl },
                { new: true }
            )
            .exec();
        if (!updated) {
            // Race: profile disappeared between findById and findByIdAndUpdate.
            // Best-effort cleanup of the orphan file and abort.
            await this.storage.safeDeleteByKey(fileKey);
            throw new NotFoundException('User not found');
        }

        if (oldUrl) {
            await this.storage.safeDeleteByUrl(oldUrl);
        }

        return newPublicUrl;
    }

    async deleteAvatar(userId: string): Promise<void> {
        const user = await this.userModel.findById(userId).exec();
        if (!user) {
            throw new NotFoundException('User not found');
        }

        const currentUrl = user.profile.avatar;
        await this.userModel
            .findByIdAndUpdate(
                userId,
                { $unset: { 'profile.avatar': 1 } },
                { new: true }
            )
            .exec();

        if (currentUrl) {
            await this.storage.safeDeleteByUrl(currentUrl);
        }
    }

    /**
     * Fetch an external avatar (e.g. Google OAuth `photos[0].value`), re-encode
     * to WebP 512×512, upload into the user's avatars namespace AND persist the
     * resulting URL on the user profile. Caller does not touch
     * `user.profile.avatar` afterwards — the pair is owned by this service.
     *
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

        const publicUrl = this.storage.buildPublicUrl(fileKey);
        const updated = await this.userModel
            .findByIdAndUpdate(
                userId,
                { 'profile.avatar': publicUrl },
                { new: true }
            )
            .exec();
        if (!updated) {
            // Race: profile disappeared between earlier work and the persist
            // step. Best-effort cleanup of the orphan file so the bucket does
            // not accumulate dead avatars; do not leak NotFound as the more
            // generic AVATAR_UPLOAD_FAILED.
            await this.storage.safeDeleteByKey(fileKey);
            throw new NotFoundException('User not found');
        }

        return publicUrl;
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
}
