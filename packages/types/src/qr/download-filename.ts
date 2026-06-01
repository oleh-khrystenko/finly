/**
 * Вид завантажуваного QR — визначає токен у назві файлу. У продукті два формати
 * QR: платіжний (NBU-payload, відкриває банк-додаток) і посилання на публічну
 * сторінку. Платіжний має дві норматив-allowed адреси (primary / legacy), тож
 * три види разом.
 */
export type QrDownloadKind = 'payment-primary' | 'payment-legacy' | 'page';

const QR_DOWNLOAD_TOKEN: Record<QrDownloadKind, string> = {
    'payment-primary': 'oplata',
    'payment-legacy': 'oplata-alt',
    page: 'storinka',
};

/**
 * Єдине джерело істини для назви завантажуваного QR-файлу. Кличеться обома
 * шляхами завантаження — фронтом (`anchor.download` у `UiQrCard`) і бекендом
 * (`Content-Disposition` у public QR-endpoint-ах) — щоб назва не розходилась
 * між ними (раніше дублювалась з двома різними словниками й дрифтила).
 *
 * `slug` — наразі leaf-ідентифікатор сутності (бізнес / рахунок / інвойс).
 */
export function buildQrDownloadFilename(
    kind: QrDownloadKind,
    slug: string
): string {
    return `qr-${QR_DOWNLOAD_TOKEN[kind]}-${slug}.png`;
}
