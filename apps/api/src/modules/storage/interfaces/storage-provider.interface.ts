export interface PresignedUploadInput {
    key: string;
    contentType: string;
}

export interface PresignedUploadResult {
    uploadUrl: string;
    key: string;
}

export type ObjectMetadata =
    | { exists: true; contentType: string; contentLength: number }
    | { exists: false };

export interface UploadBufferInput {
    key: string;
    buffer: Buffer;
    contentType: string;
}

export interface IStorageProvider {
    generatePresignedUploadUrl(
        input: PresignedUploadInput
    ): Promise<PresignedUploadResult>;

    getObjectMetadata(key: string): Promise<ObjectMetadata>;

    /**
     * Завантажує повний вміст об'єкта у Buffer. Кидає, якщо об'єкта немає
     * (caller валідує наявність через `getObjectMetadata` перед викликом).
     */
    downloadObject(key: string): Promise<Buffer>;

    deleteObject(key: string): Promise<void>;

    uploadBuffer(input: UploadBufferInput): Promise<void>;
}

export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');
