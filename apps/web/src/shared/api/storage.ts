import {
    AVATAR,
    type AvatarUploadUrlResponse,
    type CommitAvatarUploadResponse,
} from '@cyanship/types';

import { apiClient } from './client';

export async function requestAvatarUploadUrl(): Promise<AvatarUploadUrlResponse> {
    const { data } = await apiClient.post<{ data: AvatarUploadUrlResponse }>(
        '/storage/avatar/upload-url'
    );
    return data.data;
}

export async function commitAvatarUpload(
    fileKey: string
): Promise<CommitAvatarUploadResponse> {
    const { data } = await apiClient.post<{ data: CommitAvatarUploadResponse }>(
        '/storage/avatar/commit',
        { fileKey }
    );
    return data.data;
}

export async function deleteAvatar(): Promise<void> {
    await apiClient.delete('/storage/avatar');
}

/**
 * Direct upload to R2 via the presigned PUT URL. Uses the native `fetch`
 * rather than `apiClient` because:
 *   - the destination is R2, not our API — no Bearer token, no CSRF, no baseURL
 *   - the `Content-Type` header must EXACTLY match what the backend signed
 *     into the presigned URL (`image/webp`), otherwise R2 rejects with
 *     403 `SignatureDoesNotMatch`.
 * `Content-Length` is set by the browser automatically from the blob body and
 * cannot be controlled programmatically (forbidden request header in Fetch).
 */
export async function uploadToR2(
    uploadUrl: string,
    blob: Blob
): Promise<void> {
    const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': AVATAR.OUTPUT_FORMAT },
        body: blob,
    });

    if (!response.ok) {
        throw new Error(
            `R2 upload failed with status ${response.status}: ${response.statusText}`
        );
    }
}
