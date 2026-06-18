/**
 * Avatar media pipeline — single source of truth shared by API and web.
 *
 * Size is enforced on the application layer (client pre-check + server
 * `HeadObject` validation at commit time) because presigned PUT URLs cannot
 * carry an upper-bound `Content-Length` constraint: S3/R2 treat a signed
 * `ContentLength` as an exact match, and `Content-Length` is a forbidden
 * request header in the Fetch API.
 */
export const AVATAR = {
    /** Max size of the post-crop WebP blob that clients may upload (5 MB). */
    MAX_FILE_SIZE: 5 * 1024 * 1024,
    /** Square canvas edge in pixels — clients crop to this, server resizes to this. */
    OUTPUT_SIZE: 512,
    /** Only output MIME allowed. Signed into presigned PUT URLs. */
    OUTPUT_FORMAT: 'image/webp',
    /** WebP quality used by `canvas.toBlob` on the client and `sharp.webp` on the server. */
    OUTPUT_QUALITY: 0.85,
    /**
     * Input MIME types accepted by the file picker before cropping. HEIC
     * intentionally excluded: every browser-side HEIC decoder transitively
     * depends on libheif (LGPL-3.0), which is incompatible with the repo's
     * permissive licence profile. iOS Safari ≥14 auto-converts HEIC to JPEG
     * on file-pick when `accept` omits the HEIC MIME, so iPhone UX is
     * preserved without shipping a decoder.
     */
    ALLOWED_MIME_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
} as const;

export type AvatarOutputFormat = typeof AVATAR.OUTPUT_FORMAT;
export type AvatarAllowedMimeType = (typeof AVATAR.ALLOWED_MIME_TYPES)[number];

/**
 * Sprint 21 — кастомний логотип бренду. На відміну від avatar, логотип
 * завантажується БЕЗ кропа: оригінальні байти йдуть прямо в R2, тож presigned
 * PUT підписує реальний `Content-Type` файлу (один з трьох), а не фіксований
 * webp. Розмір/формат/аспект/«майже білий» валідуються на commit (server-side
 * `HeadObject` + sharp-метадані), бо presigned PUT не несе верхньої межі
 * `Content-Length` (S3/R2 трактують підписаний як точний збіг, а сам заголовок
 * заборонений у Fetch API).
 */
export const BRAND_LOGO = {
    /**
     * Max raw upload size (1 MB). Велика плашка у центрі сторінкового QR на
     * корекції H — на межі сканованості; малий файл тримає її компактною.
     */
    MAX_FILE_SIZE: 1 * 1024 * 1024,
    /**
     * Input MIME, що приймає file-picker і підписує presigned PUT. JPEG без
     * прозорості (тільки білий фон); PNG/WEBP — прозорий авто-кладеться на білий
     * на commit. SVG свідомо виключено (XSS-вектор, окрема задача).
     */
    ALLOWED_MIME_TYPES: ['image/png', 'image/jpeg', 'image/webp'],
} as const;

export type BrandLogoAllowedMimeType =
    (typeof BRAND_LOGO.ALLOWED_MIME_TYPES)[number];
