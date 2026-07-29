import { z } from 'zod';

import { PayerSchema } from '../entities/payer';

/**
 * Sprint 30 — CRUD списку платників у кабінеті. Ті самі ендпоінти працюють і з
 * pay-хоста: обидва хости обслуговує один фронтенд-контейнер, тож виклик іде на
 * той самий origin під спільною сесією, окремої публічної поверхні для
 * персональних даних не існує.
 *
 * Редагування — повна заміна обох полів (форма показує обидва): часткове
 * оновлення дало б валідний порожній PATCH без жодного ефекту.
 */
export const CreatePayerSchema = PayerSchema.pick({
    fullName: true,
    taxId: true,
});

export const UpdatePayerSchema = CreatePayerSchema;

/** Запис списку у відповіді API (дати серіалізуються як ISO-рядки). */
export const PayerViewSchema = PayerSchema;

export type CreatePayerDto = z.infer<typeof CreatePayerSchema>;
export type UpdatePayerDto = z.infer<typeof UpdatePayerSchema>;
export type PayerView = z.infer<typeof PayerViewSchema>;
