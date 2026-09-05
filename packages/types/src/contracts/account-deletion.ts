import { z } from 'zod';

/**
 * Sprint 31 — перелік того, що зникне разом з акаунтом. Запобіжник видалення
 * акаунта дзеркалить ручне видалення отримувача: людина спершу бачить обсяг
 * втрати, потім вписує кількості.
 *
 * Отримувачі, за якими лишається ще хтось, у перелік НЕ входять: вони
 * переживають видалення, з них зникає лише згадка про людину, що пішла.
 */
export const AccountDeletionPayeeSchema = z.object({
    name: z.string(),
    accountsCount: z.number().int().min(0),
    invoicesCount: z.number().int().min(0),
});

/**
 * Яким шляхом людина підтверджуватиме видалення. Розвилка та сама, що у
 * `POST /users/account/delete`: пароль у кого він є, разове посилання з листа
 * у решти. Фронтенд мусить знати її ДО показу запобіжника, бо крок
 * підтвердження в обох випадках стоїть після вписаних кількостей.
 */
export const ACCOUNT_DELETION_CONFIRM_METHODS = ['password', 'email'] as const;

export const accountDeletionConfirmMethodSchema = z.enum(
    ACCOUNT_DELETION_CONFIRM_METHODS
);

export const AccountDeletionPreviewSchema = z.object({
    confirmMethod: accountDeletionConfirmMethodSchema,
    /** Власні отримувачі людини (вона у полі власника). */
    owned: z.array(AccountDeletionPayeeSchema),
    /**
     * Клієнтські записи бухгалтера (без власника, людина єдиний менеджер).
     * Окрема група навмисно: бухгалтер мусить бачити, що зносить не тільки
     * своє, а й платіжні посилання клієнтів.
     */
    managed: z.array(AccountDeletionPayeeSchema),
    /** Сумарні числа для полів запобіжника. */
    totals: z.object({
        businessesCount: z.number().int().min(0),
        accountsCount: z.number().int().min(0),
        invoicesCount: z.number().int().min(0),
    }),
});

export type AccountDeletionConfirmMethod = z.infer<
    typeof accountDeletionConfirmMethodSchema
>;
export type AccountDeletionPayee = z.infer<typeof AccountDeletionPayeeSchema>;
export type AccountDeletionPreview = z.infer<
    typeof AccountDeletionPreviewSchema
>;
