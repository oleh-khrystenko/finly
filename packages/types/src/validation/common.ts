import { z } from 'zod';

/** Unicode letters, spaces, apostrophes, hyphens. Min 2, max 100 chars. */
export const nameSchema = z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(/^[\p{L}\s'\-]+$/u);

/** First name: 2–50 chars, Unicode letters, spaces, apostrophes, hyphens. */
export const firstNameSchema = z
    .string()
    .trim()
    .min(2)
    .max(50)
    .regex(/^[\p{L}\s'\-]+$/u);

/** Last name: up to 50 chars, Unicode letters, spaces, apostrophes, hyphens. */
export const lastNameSchema = z
    .string()
    .trim()
    .max(50)
    .regex(/^[\p{L}\s'\-]+$/u);

export const emailSchema = z.string().email();

export const passwordSchema = z.string().min(8);

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
