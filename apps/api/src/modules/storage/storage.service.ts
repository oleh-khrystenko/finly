import { Inject, Injectable, Logger } from '@nestjs/common';

import { ENV } from '../../config/env';
import {
    STORAGE_PROVIDER,
    type IStorageProvider,
    type ObjectMetadata,
    type PresignedUploadInput,
    type PresignedUploadResult,
    type UploadBufferInput,
} from './interfaces/storage-provider.interface';

/**
 * Sprint 13 §13 — pure file-ops над R2. До Sprint 13 цей сервіс володів
 * також доменом аватарки (`commit`/`delete`/`reUpload`), читав і мутував
 * User-документ через `UsersService`, що утворювало цикл `Storage → Users →
 * Auth → Storage`. Тепер сервіс знає тільки про файли: ключі, presign,
 * HeadObject, buffer-upload, delete, public-URL helpers. Avatar-домен живе
 * у `AvatarService` всередині `UsersModule`.
 */
@Injectable()
export class StorageService {
    private readonly logger = new Logger(StorageService.name);

    constructor(
        @Inject(STORAGE_PROVIDER)
        private readonly storage: IStorageProvider
    ) {}

    createPresignedUploadUrl(
        input: PresignedUploadInput
    ): Promise<PresignedUploadResult> {
        return this.storage.generatePresignedUploadUrl(input);
    }

    getObjectMetadata(key: string): Promise<ObjectMetadata> {
        return this.storage.getObjectMetadata(key);
    }

    uploadBuffer(input: UploadBufferInput): Promise<void> {
        return this.storage.uploadBuffer(input);
    }

    buildPublicUrl(key: string): string {
        return `${ENV.R2_PUBLIC_URL}/${key}`;
    }

    isR2Url(url: string): boolean {
        return url.startsWith(`${ENV.R2_PUBLIC_URL}/`);
    }

    /**
     * Best-effort deletion of an R2 object by key. Failures are logged, but
     * never propagated — orphan files in the bucket are a smaller problem than
     * rolling back a successful domain operation.
     */
    async safeDeleteByKey(key: string): Promise<void> {
        try {
            await this.storage.deleteObject(key);
        } catch (err) {
            this.logger.warn(
                `Failed to delete R2 object "${key}": ${(err as Error).message}`
            );
        }
    }

    /**
     * Best-effort deletion of an R2 object by its public URL. No-op for any URL
     * that is not under the configured R2 public prefix — protects against
     * accidentally treating external URLs (e.g. legacy Google avatars) as
     * R2 keys.
     */
    async safeDeleteByUrl(url: string): Promise<void> {
        if (!this.isR2Url(url)) return;
        const key = url.slice(ENV.R2_PUBLIC_URL.length + 1);
        await this.safeDeleteByKey(key);
    }
}
