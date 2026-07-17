import { z } from 'zod';

import { BRAND_LOGO } from '../constants/storage';
import { brandDisplayNameSchema, type BusinessBrand } from '../entities/brand';

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

/**
 * Sprint 21 — кастомний логотип бренду. File key:
 * `brand-logos/{businessId}/{uuid}.{png|jpg|jpeg|webp}`.
 *
 * - `businessId` — 24-hex ObjectId, namespace-ізоляція на рівні бізнесу (бренд
 *   успадковують усі рахунки/інвойси одного отримувача).
 * - `uuid` — canonical 36-char UUID, version-agnostic.
 * - Розширення відповідає одному з трьох дозволених форматів (без кропа оригінал
 *   завантажується як є, тож extension не фіксований як у avatar).
 */
export const BRAND_LOGO_FILE_KEY_REGEX =
    /^brand-logos\/[0-9a-f]{24}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpe?g|webp)$/;

/**
 * Запит presigned upload-url. Клієнт передає реальний `Content-Type` обраного
 * файлу — сервер підписує PUT саме під нього й виводить розширення file-key з
 * нього (presigned PUT вимагає exact-match Content-Type, інакше R2 → 403).
 */
export const RequestBrandLogoUploadUrlSchema = z.object({
    contentType: z.enum(BRAND_LOGO.ALLOWED_MIME_TYPES),
});

export type RequestBrandLogoUploadUrlDto = z.infer<
    typeof RequestBrandLogoUploadUrlSchema
>;

/**
 * Commit завантаженого логотипа. `displayName` опційний (лого-тільки — валідний
 * стан); `null` явно очищає назву, `undefined`/відсутнє — лишає без зміни на
 * боці сервісу (семантику фіналізує commit-flow). Логотип обов'язковий: «назва
 * без лого» поза скоупом (немає лого → публічно показуємо Finly, а не назву).
 */
export const CommitBrandSchema = z.object({
    fileKey: z.string().regex(BRAND_LOGO_FILE_KEY_REGEX),
    displayName: brandDisplayNameSchema.nullable().optional(),
});

export type CommitBrandDto = z.infer<typeof CommitBrandSchema>;

export interface BrandLogoUploadUrlResponse {
    uploadUrl: string;
    fileKey: string;
}

/**
 * Результат commit-у бренду. Дзеркало slug-upsell «success-with-state, не throw»:
 *   - `active` — доступ ≥ brand, бренд рендериться публічно одразу (`BRAND_UPDATED`).
 *   - `pending` — доступ нижче brand, лого збережено у pending-слот, відповідь
 *     несе пейвол-стан (`BRAND_REQUIRES_PLAN`), а не помилку.
 */
export const BRAND_COMMIT_OUTCOME = {
    ACTIVE: 'active',
    PENDING: 'pending',
} as const;

export type BrandCommitOutcome =
    (typeof BRAND_COMMIT_OUTCOME)[keyof typeof BRAND_COMMIT_OUTCOME];

export interface CommitBrandResponse {
    outcome: BrandCommitOutcome;
    /** Оновлений блок бренду бізнесу (для синхронізації кабінету без re-fetch). */
    brand: BusinessBrand;
}

/**
 * Прев'ю обох QR із наданим логотипом без активації. `nbuPngBase64` — `null`,
 * коли у бізнесі ще немає жодного рахунку (немає валідного НБУ-payload для
 * рендеру); кабінет тоді показує лише сторінкове прев'ю.
 */
export interface BrandPreviewResponse {
    pagePngBase64: string;
    nbuPngBase64: string | null;
}

/**
 * Sprint 28 — ілюстрації блоків гайдів: `guide-images/{uuid}.webp`.
 *
 * Без per-user namespace: контент спільний адмінський, ownership гарантує
 * guard ролі admin на ендпоінтах, не структура ключа. UUID version-agnostic.
 */
export const GUIDE_IMAGE_FILE_KEY_REGEX =
    /^guide-images\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;

export const CommitGuideImageSchema = z.object({
    fileKey: z.string().regex(GUIDE_IMAGE_FILE_KEY_REGEX),
});

export type CommitGuideImageDto = z.infer<typeof CommitGuideImageSchema>;

export interface GuideImageUploadUrlResponse {
    uploadUrl: string;
    fileKey: string;
}

export interface CommitGuideImageResponse {
    url: string;
}
