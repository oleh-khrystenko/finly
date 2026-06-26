import {
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    PutObjectCommand,
    S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';

import { ENV } from '../../../config/env';
import type {
    IStorageProvider,
    ObjectMetadata,
    PresignedUploadInput,
    PresignedUploadResult,
    UploadBufferInput,
} from '../interfaces/storage-provider.interface';

const PRESIGNED_URL_TTL_SECONDS = 5 * 60;

function isNotFoundError(err: unknown): boolean {
    if (typeof err !== 'object' || err === null) return false;
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    return (
        e.name === 'NotFound' ||
        e.name === 'NoSuchKey' ||
        e.$metadata?.httpStatusCode === 404
    );
}

@Injectable()
export class CloudflareR2Service implements IStorageProvider {
    private readonly client: S3Client;
    private readonly bucket: string;

    constructor() {
        this.client = new S3Client({
            region: 'auto',
            endpoint: `https://${ENV.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId: ENV.R2_ACCESS_KEY_ID,
                secretAccessKey: ENV.R2_SECRET_ACCESS_KEY,
            },
        });
        this.bucket = ENV.R2_BUCKET_NAME;
    }

    async generatePresignedUploadUrl(
        input: PresignedUploadInput
    ): Promise<PresignedUploadResult> {
        const command = new PutObjectCommand({
            Bucket: this.bucket,
            Key: input.key,
            ContentType: input.contentType,
        });

        const uploadUrl = await getSignedUrl(this.client, command, {
            expiresIn: PRESIGNED_URL_TTL_SECONDS,
        });

        return { uploadUrl, key: input.key };
    }

    async getObjectMetadata(key: string): Promise<ObjectMetadata> {
        try {
            const result = await this.client.send(
                new HeadObjectCommand({ Bucket: this.bucket, Key: key })
            );
            return {
                exists: true,
                contentType: result.ContentType ?? '',
                contentLength: result.ContentLength ?? 0,
            };
        } catch (err) {
            if (isNotFoundError(err)) {
                return { exists: false };
            }
            throw err;
        }
    }

    async downloadObject(key: string): Promise<Buffer> {
        const result = await this.client.send(
            new GetObjectCommand({ Bucket: this.bucket, Key: key })
        );
        if (!result.Body) {
            throw new Error(`R2 object "${key}" has no body`);
        }
        // AWS SDK v3 Node stream → Buffer. `transformToByteArray` доступний на
        // Body у Node-runtime (sdk-stream-mixin), уникає ручного stream-pump.
        const bytes = await result.Body.transformToByteArray();
        return Buffer.from(bytes);
    }

    async deleteObject(key: string): Promise<void> {
        await this.client.send(
            new DeleteObjectCommand({ Bucket: this.bucket, Key: key })
        );
    }

    async uploadBuffer(input: UploadBufferInput): Promise<void> {
        await this.client.send(
            new PutObjectCommand({
                Bucket: this.bucket,
                Key: input.key,
                Body: input.buffer,
                ContentType: input.contentType,
            })
        );
    }
}
