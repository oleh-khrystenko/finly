import { z } from 'zod';

import { personalizationFullNameZod } from '../contracts/personalization';
import { individualTaxIdZod } from '../validation/tax-id';
import { objectIdSchema } from '../validation/common';

/**
 * Sprint 30 — платник, за якого користувач платить регулярно (сценарій
 * бухгалтера з десятком клієнтів). Належить користувачу, живе поруч з профілем
 * і використовується лише як джерело підстановки на податковій сторінці.
 *
 * **Чому ПІБ валідується схемою персоналізації, а не `nameSchema`.** Значення
 * підставляється у призначення платежу і потрапляє в QR, тож єдиний коректний
 * набір правил — той самий, що на публічній формі підстановки (NBU-charset +
 * ліміт поля). Власна схема «імені» тут дозволила б зберегти запис, який на
 * сторінці оплати впаде на валідації і платити ним буде неможливо.
 */
export const PayerSchema = z.object({
    id: objectIdSchema,
    fullName: personalizationFullNameZod,
    taxId: individualTaxIdZod,
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
});

export type Payer = z.infer<typeof PayerSchema>;

/**
 * Верхня межа записів на користувача. Це допоміжний список під платежі, а не
 * міні-CRM: без межі один обліковий запис перетворює колекцію на сховище
 * персональних даних третіх осіб довільного розміру. Досягнення межі —
 * окремий код відповіді з поясненням, а не мовчазна відмова збереження.
 */
export const PAYERS_MAX_PER_USER = 50;
