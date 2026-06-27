/**
 * Версійний токен бренду для cache-bust QR-картинки.
 *
 * QR-зображення віддається сирим `<img>` за СТАБІЛЬНИМ URL з
 * `Cache-Control: public, max-age=300`. Сам брендований PNG залежить від
 * активного логотипа бізнесу, але URL його не кодує — тож після зміни бренду
 * браузер ще до 5 хв показував би старий закешований код (на проді це непомітно,
 * бо QR відкривають свіжою сесією; у кабінеті — одразу після завантаження лого).
 *
 * Активний `logoUrl` несе свіжий uuid на кожен commit бренду (а його відсутність
 * означає дефолтний Finly-брендинг), тож його сегмент — достатній ключ: новий
 * бренд → новий токен → новий URL → браузер тягне свіже зображення, старий кеш
 * осиротіє. `max-age` лишається недоторканим (свідоме рішення гасіння публічної
 * сторінки), cache-bust живе виключно в query.
 *
 * @param activeLogoUrl `business.brand.active.logoUrl` (кабінет) або
 *   `business.logo` публічного view; `null`/`undefined` → дефолтний бренд.
 */
export function qrBrandVersion(
    activeLogoUrl: string | null | undefined
): string {
    if (!activeLogoUrl) return 'finly';
    const fileName = activeLogoUrl.split('/').pop() ?? '';
    const uuid = fileName.replace(/\.(png|jpe?g|webp)$/i, '');
    return uuid || 'finly';
}
