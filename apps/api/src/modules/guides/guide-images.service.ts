import { randomUUID } from 'crypto';

import {
    BadRequestException,
    HttpException,
    Injectable,
    InternalServerErrorException,
    Logger,
} from '@nestjs/common';
import { GUIDE_IMAGE, RESPONSE_CODE } from '@finly/types';

import { StorageService } from '../storage/storage.service';

interface GuideImageUploadUrlResult {
    uploadUrl: string;
    fileKey: string;
}

/**
 * Sprint 28 — ілюстрації блоків гайдів, дзеркало avatar-pipeline: presigned
 * PUT підписує лише webp, commit верифікує HeadObject-ом (тип + розмір), бо
 * presigned PUT не несе верхньої межі Content-Length. Без user-namespace у
 * ключі: ownership гарантує AdminGuard на ендпоінтах.
 */
@Injectable()
export class GuideImagesService {
    private readonly logger = new Logger(GuideImagesService.name);

    constructor(private readonly storage: StorageService) {}

    async createUploadUrl(): Promise<GuideImageUploadUrlResult> {
        const fileKey = `guide-images/${randomUUID()}.webp`;

        const { uploadUrl } = await this.mapStorageError(
            () =>
                this.storage.createPresignedUploadUrl({
                    key: fileKey,
                    contentType: GUIDE_IMAGE.OUTPUT_FORMAT,
                }),
            'presign guide image upload'
        );

        return { uploadUrl, fileKey };
    }

    /** Формат fileKey уже перевірений Zod DTO (`GUIDE_IMAGE_FILE_KEY_REGEX`). */
    async commitUpload(fileKey: string): Promise<string> {
        const metadata = await this.mapStorageError(
            () => this.storage.getObjectMetadata(fileKey),
            'read guide image metadata'
        );
        if (!metadata.exists) {
            throw new BadRequestException({
                code: RESPONSE_CODE.GUIDE_IMAGE_UPLOAD_NOT_FOUND,
                message: 'Uploaded file not found',
            });
        }

        if (
            metadata.contentType !== GUIDE_IMAGE.OUTPUT_FORMAT ||
            metadata.contentLength > GUIDE_IMAGE.MAX_FILE_SIZE
        ) {
            // Cleanup невалідного файлу ДО відмови — інакше HeadObject-
            // enforcement втрачає сенс.
            await this.storage.safeDeleteByKey(fileKey);
            throw new BadRequestException({
                code: RESPONSE_CODE.GUIDE_IMAGE_UPLOAD_INVALID,
                message: 'Uploaded file has invalid type or size',
            });
        }

        return this.storage.buildPublicUrl(fileKey);
    }

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
                `Guide image storage operation failed (${operationLabel}): ${error.message}`,
                error.stack
            );
            throw new InternalServerErrorException({
                code: RESPONSE_CODE.GUIDE_IMAGE_UPLOAD_FAILED,
                message: `Guide image ${operationLabel} failed`,
            });
        }
    }
}
