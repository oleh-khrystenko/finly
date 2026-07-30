import { z } from 'zod';

import { businessTypeSchema } from '../entities/business';
import { PayerSchema } from '../entities/payer';
import { individualTaxIdZod } from '../validation/tax-id';
import { objectIdSchema } from '../validation/common';

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

/**
 * Отримувач користувача, придатний як джерело даних платника: у ФОПа і фізособи
 * `taxId` — це РНОКПП тієї самої людини, за яку платять податки, і він уже
 * введений при створенні отримувача. Змушувати переносити його руками у список
 * платників означало б тримати дві копії тих самих даних, які розійдуться після
 * першого ж редагування отримувача.
 *
 * **Це проєкція, а не сутність.** Нічого не зберігається і не копіюється:
 * джерела читаються з наявних отримувачів на кожен захід, тож зникнення доступу
 * до бізнесу прибирає джерело саме собою.
 *
 * ТОВ і неприбуткові сюди не потрапляють: там `taxId` — це ЄДРПОУ юрособи, який
 * не є податковим номером людини і не проходить валідацію поля підстановки.
 *
 * `name` — «сира» назва без юр-форми: у призначення платежу має їхати ПІБ, а
 * префікс «ФОП» додається лише на відображення (`formatPayeeName`), тому `type`
 * віддається окремим полем.
 *
 * `isOwn` розділяє «це я» і «це мій клієнт»: власні отримувачі (`ownerId` —
 * сам користувач) описують саме ту людину, що зайшла, а клієнтські записи
 * бухгалтера (`ownerId: null` + `managers ∋ я`) — чужих людей. Без цього поля
 * список платників був би плоским переліком, у якому власні дані нічим не
 * відрізняються від десятка клієнтських.
 */
export const PayerSourceSchema = z.object({
    id: objectIdSchema,
    type: businessTypeSchema,
    name: z.string(),
    taxId: individualTaxIdZod,
    isOwn: z.boolean(),
});

export type PayerSource = z.infer<typeof PayerSourceSchema>;
