/**
 * Вид завантажуваного QR — визначає префікс назви файлу. У продукті два формати
 * QR: платіжний (NBU-payload формату 003, відкриває банк-додаток) і посилання на
 * публічну сторінку. Платіжний має дві норматив-allowed адреси НБУ — основну
 * (`qr.bank.gov.ua`) і запасну (`bank.gov.ua/qr`), однаковий payload, різний
 * лише host. Сторінковий код — «дефолтний» тип, без токена; платіжні марковані.
 *
 * Формат 002 поки не введено: жоден endpoint його не рендерить і не віддає на
 * завантаження. Токен формату додамо, якщо/коли 002-завантаження зʼявиться.
 */
export type QrDownloadKind = 'payment-primary' | 'payment-legacy' | 'page';

/**
 * Ланцюг slug-ів сутності, для якої будується назва. Глибина = рівень:
 * бізнес (лише `businessSlug`) → рахунок (+`accountSlug`) → інвойс (+`invoiceSlug`).
 * Повний ланцюг гарантує унікальність назви (invoice slug унікальний лише в межах
 * рахунку — `(accountId, slug)`, тож сам по собі колізіє між рахунками).
 */
export interface QrDownloadTarget {
    businessSlug: string;
    accountSlug?: string;
    invoiceSlug?: string;
}

const QR_DOWNLOAD_PREFIX: Record<QrDownloadKind, string> = {
    'payment-primary': 'finly-nbu',
    'payment-legacy': 'finly-nbu-alt',
    page: 'finly',
};

/**
 * Єдине джерело істини для назви завантажуваного QR-файлу. Кличеться обома
 * шляхами завантаження — фронтом (`anchor.download` у `UiQrCard`) і бекендом
 * (`Content-Disposition` у public QR-endpoint-ах) — щоб назва не розходилась
 * між ними.
 */
export function buildQrDownloadFilename(
    kind: QrDownloadKind,
    target: QrDownloadTarget
): string {
    const chain = [target.businessSlug, target.accountSlug, target.invoiceSlug]
        .filter((slug): slug is string => Boolean(slug))
        .join('-');
    return `${QR_DOWNLOAD_PREFIX[kind]}-${chain}.png`;
}
