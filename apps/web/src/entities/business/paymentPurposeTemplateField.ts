import { type BusinessType } from '@finly/types';

/**
 * UI-config поля "Призначення платежу за замовчуванням" per BusinessType.
 *
 * Це поле живе на `Business.paymentPurposeTemplate` — default-текст, що
 * підставляється у поле 12 NBU-payload-у (формати 002/003) і його бачить
 * **платник** у своєму банку перед підтвердженням оплати. Тому слово на
 * місці "платежу" мусить відповідати соціальному контексту одержувача:
 * фізособа збирає donate-и → "переказ"; ФОП/ТОВ продає → "платіж";
 * неприбуткова організація приймає членські внески/пожертви → "внесок".
 *
 * Description однакова для всіх типів — обидва consumer-и (`Step4PurposeBanks`
 * у wizard, `BanksSection` у edit) показують один і той самий пояснювальний
 * хінт. Виносити окремі description per-type було б шумом без сигналу.
 *
 * Discriminator-таблиця замість `if/else` — додавання нового `BusinessType`
 * без оновлення цього мапінгу дає compile-error через
 * `Record<BusinessType, ...>` exhaustiveness.
 */

export interface PaymentPurposeTemplateFieldConfig {
    label: string;
    placeholder: string;
    description: string;
}

const DESCRIPTION =
    'Призначення за замовчуванням. Для конкретного рахунку можна задати власний.';

const CONFIG_BY_TYPE: Record<BusinessType, PaymentPurposeTemplateFieldConfig> =
    {
        individual: {
            label: 'Призначення переказу',
            placeholder: 'Переказ коштів',
            description: DESCRIPTION,
        },
        fop: {
            label: 'Призначення платежу',
            placeholder: 'Оплата за послуги',
            description: DESCRIPTION,
        },
        tov: {
            label: 'Призначення платежу',
            placeholder: 'Оплата за товар',
            description: DESCRIPTION,
        },
        organization: {
            label: 'Призначення внеску',
            placeholder: 'Благодійний внесок',
            description: DESCRIPTION,
        },
    };

export const paymentPurposeTemplateFieldConfig = (
    type: BusinessType
): PaymentPurposeTemplateFieldConfig => CONFIG_BY_TYPE[type];
