import {
    AVATAR,
    type AvatarUploadUrlResponse,
    type BrandLogoUploadUrlResponse,
    type BrandPreviewResponse,
    type CommitAvatarUploadResponse,
    type CommitBrandResponse,
} from '@finly/types';

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
export async function uploadToR2(uploadUrl: string, blob: Blob): Promise<void> {
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

// ── Sprint 21 — кастомний логотип бренду ─────────────────────────────────────

/** Presigned upload-url для логотипа бренду (під namespace бізнесу). */
export async function requestBrandLogoUploadUrl(
    businessSlug: string,
    contentType: string
): Promise<BrandLogoUploadUrlResponse> {
    const { data } = await apiClient.post<{ data: BrandLogoUploadUrlResponse }>(
        `/businesses/me/${encodeURIComponent(businessSlug)}/brand/upload-url`,
        { contentType }
    );
    return data.data;
}

/**
 * Direct upload оригіналу до R2 (без кропа). На відміну від avatar, `Content-Type`
 * — реальний тип файлу (presigned підписаний саме під нього), не фіксований webp.
 */
export async function uploadBrandLogoToR2(
    uploadUrl: string,
    file: File
): Promise<void> {
    const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
    });

    if (!response.ok) {
        throw new Error(
            `R2 upload failed with status ${response.status}: ${response.statusText}`
        );
    }
}

/** Прев'ю обох QR із завантаженим логотипом без активації. */
export async function previewBrandLogo(
    businessSlug: string,
    fileKey: string,
    displayName: string | null
): Promise<BrandPreviewResponse> {
    const { data } = await apiClient.post<{ data: BrandPreviewResponse }>(
        `/businesses/me/${encodeURIComponent(businessSlug)}/brand/preview`,
        { fileKey, displayName }
    );
    return data.data;
}

/**
 * Commit логотипа. Доступ ≥ brand → `outcome: 'active'` (рендериться одразу);
 * нижче → `outcome: 'pending'` (success-with-state, пейвол на боці UI).
 */
export async function commitBrandLogo(
    businessSlug: string,
    fileKey: string,
    displayName: string | null
): Promise<CommitBrandResponse> {
    const { data } = await apiClient.post<{ data: CommitBrandResponse }>(
        `/businesses/me/${encodeURIComponent(businessSlug)}/brand`,
        { fileKey, displayName }
    );
    return data.data;
}

/** Зняти бренд (active + pending), публічно повертається Finly. */
export async function deleteBrandLogo(businessSlug: string): Promise<void> {
    await apiClient.delete(
        `/businesses/me/${encodeURIComponent(businessSlug)}/brand`
    );
}
