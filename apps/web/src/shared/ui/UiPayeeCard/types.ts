export interface UiPayeeCardProps {
    /**
     * Назва отримувача коштів (вже з юр-формою, напр. «ФОП {ПІБ}»). Якщо
     * `undefined` — рядок «Отримувач» не рендериться (use-case: account-page,
     * де отримувач уже показаний як hero-h1, а картка несе лише реквізити).
     */
    recipient?: string;
    /** Назва банку («ПриватБанк»); `null` на нерозпізнаному IBAN — drop-ається. */
    bankLabel: string | null;
    /** Маска IBAN («•2580») — server-derived disambiguator, завжди показуємо. */
    ibanMask: string;
    /**
     * Власна назва реквізитів, що дав власник. Показуємо тихим вторинним рядком
     * лише коли вона несе додатковий сенс (не дублює банк-лейбл).
     */
    accountName?: string | null;
}
