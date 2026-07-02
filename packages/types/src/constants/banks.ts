/**
 * MVP-набір українських банків — стартовий пул для публічної сторінки бізнесу.
 *
 * Це структурні ідентифікатори (wire-values для БД, Zod, URL); метадані для
 * рендеру (label, logo) живуть на UI-шарі і додаються у Sprint 3. Перелік
 * розширюється за фактом попиту після релізу — список не permanent.
 *
 * Джерело: `docs/product/qr-decisions.md` §1.7.
 */
export const MVP_BANKS = [
    'privatbank',
    'monobank',
    'abank',
    'pumb',
    'sense',
    'raiffeisen',
    'izibank',
    'oschadbank',
    'ukrgazbank',
    'credit_dnipro',
    'ukrsibbank',
] as const;

export type BankCode = (typeof MVP_BANKS)[number];

/**
 * UA-лейбли для UI (wizard step 4, кабінет banks-section, public-сторінка).
 * Sprint 3 рішення B5 каже про реальні логотипи на public-сторінці; cabinet
 * UI Phase 7-8 використовує text labels (іконки додаються разом з public
 * route у Phase 9). Single source of truth — і wizard, і cabinet, і public
 * читають звідси.
 */
export const BANK_LABEL: Record<BankCode, string> = {
    privatbank: 'ПриватБанк',
    monobank: 'monobank',
    pumb: 'ПУМБ',
    oschadbank: 'Ощадбанк',
    sense: 'Sense Bank',
    ukrgazbank: 'Укргазбанк',
    izibank: 'IZIBank',
    raiffeisen: 'Raiffeisen',
    abank: 'A-Bank',
    credit_dnipro: 'Кредит Дніпро',
    ukrsibbank: 'UKRSIBBANK',
};

/**
 * Per-bank app-launch метадані для відкриття конкретного банк-додатку з
 * публічної сторінки оплати (Sprint 5 §3.1, `docs/sprints/05-per-bank/`).
 *
 * Механізм (підтверджений на iOS 26.5 / iPhone 13, Safari + Chrome):
 *  - **iOS** — приватна URL-схема банку. Беремо НБУ legacy payload-link
 *    `https://bank.gov.ua/qr/<payload>` і підміняємо `https` на схему банку
 *    (`mono://bank.gov.ua/qr/<payload>`). Схему `mono://` в системі заявив лише
 *    monobank, тож iOS відкриває рівно цей додаток (діалог "Відкрити у …?") і
 *    парсить той самий base64 payload, що й через universal link.
 *  - **Android** — `intent://`-URL з примусовим `package=` (той самий payload,
 *    scheme=https). Кожен банк декларує app-link на хост `bank.gov.ua`, тож
 *    package-targeting відкриває саме його; не встановлений → Play Store.
 *
 * iOS-схему тримаємо **лише** для банків, підтверджених на реальному пристрої
 * (privat/mono/abank — `docs/sprints/05-per-bank/bank-status.md`). Решта —
 * `iosScheme: null`: приватної схеми, що приймає НБУ-payload, у них немає
 * (pumb/sense перевірено — не реагують; інші — не підтверджено). Це впливає
 * лише на **тап**: банк з `null`-схемою відкривається через загальний НБУ-link
 * (fallback у `buildBankAppLink`), а не власним додатком. Які банки взагалі
 * показувати на iOS — окреме рішення (`IOS_HIDDEN_BANKS`), не похідне від
 * наявності схеми. На Android банк відкривається завжди: `intent://package=`
 * б'є в verified app-link НБУ (`bank.gov.ua/.well-known/assetlinks.json`
 * делегує ці пакети).
 *
 * **Крихкість**: iOS-схеми приватні й недокументовані — банк може їх змінити,
 * і кнопка тихо перестане відкривати додаток. Тому UI завжди лишає загальний
 * НБУ-link + QR як запасний шлях. Джерело значень — публічні app-link реєстри
 * банків (`docs/sprints/05-per-bank/research-aasa.md`).
 */
export interface BankAppLaunch {
    /** iOS приватна URL-схема (без `://`), або `null` якщо невідома. */
    iosScheme: string | null;
    /** Android application id для `intent://`-package-targeting. */
    androidPackage: string;
}

export const BANK_APP_LAUNCH: Record<BankCode, BankAppLaunch> = {
    privatbank: { iosScheme: 'privat24', androidPackage: 'ua.privatbank.ap24' },
    monobank: { iosScheme: 'mono', androidPackage: 'com.ftband.mono' },
    pumb: { iosScheme: null, androidPackage: 'com.fuib.android.spot.online' },
    oschadbank: {
        iosScheme: null,
        androidPackage: 'com.unitybars.corplight.oschadbank',
    },
    sense: { iosScheme: null, androidPackage: 'ua.alfabank.mobile.android' },
    ukrgazbank: { iosScheme: null, androidPackage: 'com.ugb.app' },
    izibank: { iosScheme: null, androidPackage: 'ua.izibank.app' },
    raiffeisen: { iosScheme: null, androidPackage: 'ua.raiffeisen.myraif' },
    abank: { iosScheme: 'abank24', androidPackage: 'ua.com.abank' },
    credit_dnipro: { iosScheme: null, androidPackage: 'com.creditdnepr.mb' },
    ukrsibbank: {
        iosScheme: null,
        androidPackage: 'com.ukrsibbank.uso.android',
    },
};

/**
 * Банки, які НЕ показуємо у сітці оплати на iOS (`UiBankAppGrid`).
 *
 * Historically iOS-список = банки з `iosScheme !== null` (whitelist). Тепер це
 * явний blacklist: на iOS показуємо всі банки, крім перелічених тут. pumb/sense
 * перевірено на реальному пристрої — вони ігнорують і приватну схему, і НБУ
 * universal-link, тож їхня кнопка на iOS не веде нікуди корисного; raiffeisen
 * тримаємо закритим за тим самим рішенням. Решта банків показуються: ті, що
 * мають `iosScheme`, відкривають свій додаток; інші — падають на загальний
 * НБУ-link через `buildBankAppLink` → `null`-fallback у `UiBankAppGrid`.
 */
export const IOS_HIDDEN_BANKS: readonly BankCode[] = [
    'pumb',
    'sense',
    'raiffeisen',
];

/** Мобільна платформа, для якої будуємо per-bank deep-link. */
export type BankAppPlatform = 'ios' | 'android';

/**
 * Будує deep-link, що відкриває конкретний банк-додаток, з НБУ legacy
 * payload-link (`https://bank.gov.ua/qr/<payload>`).
 *
 * Повертає `null`, коли відкрити саме цей банк на даній платформі неможливо
 * (iOS без відомої приватної схеми) — caller робить fallback на загальний
 * НБУ-universal-link.
 *
 * @param nbuLegacyLink НБУ payload-link форми `https://bank.gov.ua/qr/<b64>`.
 * @param bank Код банку з `MVP_BANKS`.
 * @param platform Цільова мобільна платформа.
 */
export function buildBankAppLink(
    nbuLegacyLink: string,
    bank: BankCode,
    platform: BankAppPlatform
): string | null {
    const launch = BANK_APP_LAUNCH[bank];

    if (platform === 'ios') {
        if (launch.iosScheme === null) return null;
        // Підміна лише протоколу: `https://…` → `<scheme>://…`. base64url
        // payload не містить літерал `https`, тож anchored-replace безпечний.
        return nbuLegacyLink.replace(/^https/, launch.iosScheme);
    }

    // Android: intent:// з примусовим package + Play Store fallback.
    const intentUrl = nbuLegacyLink.replace(/^https/, 'intent');
    const storeFallback = `https://play.google.com/store/apps/details?id=${launch.androidPackage}`;
    return `${intentUrl}#Intent;scheme=https;package=${launch.androidPackage};S.browser_fallback_url=${encodeURIComponent(storeFallback)};end`;
}
