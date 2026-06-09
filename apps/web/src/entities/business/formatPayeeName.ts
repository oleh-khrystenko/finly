import { BUSINESS_TYPE_LABEL, type BusinessType } from '@finly/types';

/**
 * Юр-форми, що є **частиною назви отримувача**, а не бейджем (конвенція:
 * ТОВ/ФОП рендеряться у титулі разом з назвою, бо банк-переказ адресується
 * саме на «ФОП {ПІБ}» / «ТОВ {назва}»). `individual` (фізособа) і
 * `organization` (неприбуткова) лишаються голою назвою: ПІБ фізособи
 * самодостатній, а довгий префікс «Неприбуткова організація» — категорія,
 * а не частина юр-назви.
 */
const LEGAL_FORM_PREFIX: Partial<Record<BusinessType, string>> = {
    fop: BUSINESS_TYPE_LABEL.fop,
    tov: BUSINESS_TYPE_LABEL.tov,
};

/**
 * Формує відображувану назву отримувача коштів для публічних платіжних
 * сторінок: «ФОП Христенко Олег Анатолійович», «ТОВ Назва», або голу назву
 * для фізособи/організації. Single source of truth для всіх public-view
 * (business-root, account, invoice).
 */
export function formatPayeeName(type: BusinessType, name: string): string {
    const prefix = LEGAL_FORM_PREFIX[type];
    return prefix ? `${prefix} ${name}` : name;
}
