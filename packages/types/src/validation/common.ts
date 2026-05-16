import { z } from 'zod';

/**
 * Zod-схеми для базових загальних полів. Кожне `min/max/regex/email`-обмеження
 * має явний `message`-код у форматі SCREAMING_SNAKE — це частина public-API
 * валідації. Коди стабільні, бек-енд тести спираються на них, а на frontend
 * `mapValidationCode(code)` (`apps/web/src/shared/api/mapValidationCode.ts`)
 * перекладає у user-facing UA-рядок.
 */

/** Unicode letters, spaces, apostrophes, hyphens. Min 2, max 100 chars. */
export const nameSchema = z
    .string()
    .trim()
    .min(2, { message: 'INVALID_NAME_TOO_SHORT' })
    .max(100, { message: 'INVALID_NAME_TOO_LONG' })
    .regex(/^[\p{L}\s'\-]+$/u, { message: 'INVALID_NAME_FORMAT' });

/** First name: 2–50 chars, Unicode letters, spaces, apostrophes, hyphens. */
export const firstNameSchema = z
    .string()
    .trim()
    .min(2, { message: 'INVALID_FIRST_NAME_TOO_SHORT' })
    .max(50, { message: 'INVALID_FIRST_NAME_TOO_LONG' })
    .regex(/^[\p{L}\s'\-]+$/u, { message: 'INVALID_FIRST_NAME_FORMAT' });

/** Last name: 1–50 chars, Unicode letters, spaces, apostrophes, hyphens. */
export const lastNameSchema = z
    .string()
    .trim()
    .min(1, { message: 'INVALID_LAST_NAME_REQUIRED' })
    .max(50, { message: 'INVALID_LAST_NAME_TOO_LONG' })
    .regex(/^[\p{L}\s'\-]+$/u, { message: 'INVALID_LAST_NAME_FORMAT' });

export const emailSchema = z.string().email({ message: 'INVALID_EMAIL' });

export const passwordSchema = z
    .string()
    .min(8, { message: 'INVALID_PASSWORD_TOO_SHORT' });

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
