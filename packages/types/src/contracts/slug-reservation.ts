import { z } from 'zod';

/**
 * Sprint 20 — slug upsell flow. Спільні контракти для перевірки доступності
 * бажаного slug і його короткої броні за неплатником.
 *
 * Бронь тримає ім'я від інших, але сам slug у БД не комітиться і публічно не
 * вивішується — після оплати ім'я застосовується звичайним PATCH (тепер
 * дозволеним за рівнем). Деталі моделі — у `SlugReservation`-схемі API.
 */

export const SLUG_ENTITY_TYPES = ['business', 'account', 'invoice'] as const;
export type SlugEntityType = (typeof SLUG_ENTITY_TYPES)[number];

/**
 * Тривалість броні. Коротка і чесна до всіх: ім'я не може висіти заброньованим
 * довго заради одного неплатника (одна активна бронь на користувача,
 * авто-сплив). Зворотний відлік web рахує з `expiresAt`.
 */
export const SLUG_RESERVATION_TTL_MINUTES = 15;

export const SLUG_AVAILABILITY_STATUS = {
    /** Ім'я вільне — можна зайняти (платний пише одразу, free бронює на Save). */
    AVAILABLE: 'available',
    /** Зайняте живим slug, чужою rename-історією або активною бронню іншого. */
    TAKEN: 'taken',
    /** Системно зарезервоване слово (лише для бізнес-slug: `qr`, `api`, …). */
    RESERVED: 'reserved',
} as const;

export type SlugAvailabilityStatus =
    (typeof SLUG_AVAILABILITY_STATUS)[keyof typeof SLUG_AVAILABILITY_STATUS];

export const SlugAvailabilityResponseSchema = z.object({
    slug: z.string(),
    status: z.enum([
        SLUG_AVAILABILITY_STATUS.AVAILABLE,
        SLUG_AVAILABILITY_STATUS.TAKEN,
        SLUG_AVAILABILITY_STATUS.RESERVED,
    ]),
});

export type SlugAvailabilityResponse = z.infer<
    typeof SlugAvailabilityResponseSchema
>;

/**
 * Активна бронь у профілі (`GET /users/me`). Несе бажане ім'я, момент спливу і
 * snapshot канонічного шляху до цільової сутності на момент броні — web малює
 * зворотний відлік і будує PATCH для застосування наміру (на поверненні з
 * білінгу або при наступному заході в кабінет). Live поза `billing`-shape, бо
 * free-юзери (саме вони тримають броні) мають `billing: null`.
 */
export const SlugReservationViewSchema = z.object({
    entityType: z.enum(SLUG_ENTITY_TYPES),
    desiredSlug: z.string(),
    expiresAt: z.coerce.date(),
    businessSlug: z.string(),
    accountSlug: z.string().nullable(),
    invoiceSlug: z.string().nullable(),
});

export type SlugReservationView = z.infer<typeof SlugReservationViewSchema>;
