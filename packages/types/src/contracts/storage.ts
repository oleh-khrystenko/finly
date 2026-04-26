import { z } from 'zod';

/**
 * File key contract for avatar uploads: `avatars/{userId}/{uuid}.webp`.
 *
 * - `userId` — 24-hex MongoDB ObjectId, enforces per-user namespace isolation.
 * - `uuid`   — canonical 36-character UUID string. Version-agnostic regex so
 *             a future switch to UUID v7+ does not require a contract change.
 * - `.webp`  — only extension allowed; the output format is fixed.
 */
export const AVATAR_FILE_KEY_REGEX =
    /^avatars\/[0-9a-f]{24}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;

export const CommitAvatarUploadSchema = z.object({
    fileKey: z.string().regex(AVATAR_FILE_KEY_REGEX),
});

export type CommitAvatarUploadDto = z.infer<typeof CommitAvatarUploadSchema>;

export interface AvatarUploadUrlResponse {
    uploadUrl: string;
    fileKey: string;
}

export interface CommitAvatarUploadResponse {
    avatar: string;
}
