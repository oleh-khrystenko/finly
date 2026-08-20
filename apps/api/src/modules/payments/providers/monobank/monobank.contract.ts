import { type CardDetails, toCardPaymentMethod } from '@finly/types';
import { asRecord, str } from './monobank.signature';

/**
 * Домовленість із monobank «Плата»: адреси API, вікно очікування і розбір полів
 * відповіді. Живе окремо від сервісу, бо ту саму домовленість читає не лише
 * Nest-провайдер — разові скрипти (беквіл способу оплати) ходять у той самий
 * рахунок без Nest-контейнера. Другий екземпляр назв полів мовчки розійшовся б
 * з першим на найближчій зміні контракту: провайдера полагодили б, а скрипт
 * далі писав би порожнечу, і жодної помилки при цьому не сталося б.
 */
export const MONOBANK_API_BASE = 'https://api.monobank.ua';
export const MONOBANK_INVOICE_CREATE = '/api/merchant/invoice/create';
export const MONOBANK_WALLET_PAYMENT = '/api/merchant/wallet/payment';
export const MONOBANK_INVOICE_STATUS = '/api/merchant/invoice/status';
export const MONOBANK_PUBKEY = '/api/merchant/pubkey';

/** Вікно очікування відповіді провайдера: без нього запит висить безкінечно. */
export const MONOBANK_REQUEST_TIMEOUT_MS = 20_000;

/**
 * Дані картки з `paymentInfo`. Для Apple Pay / Google Pay `maskedPan` — номер
 * пристрою, а не картки платника; спосіб оплати тримає саме цю різницю, тож
 * читається разом із номером і ніколи окремо.
 *
 * Назви полів узяті з документації і не мають автоматичної перевірки: розбіжність
 * дасть тихий `null`, а не помилку. Звіряються живою оплатою — `docs/manual-checks`
 * PAY-6.
 */
export function cardDetailsFromPayload(
    payload: Record<string, unknown>
): CardDetails {
    const paymentInfo = asRecord(payload.paymentInfo);
    if (!paymentInfo) {
        return {
            cardMask: null,
            cardPaymentMethod: null,
            cardPaymentSystem: null,
            cardBank: null,
        };
    }
    return {
        cardMask: str(paymentInfo.maskedPan),
        cardPaymentMethod: toCardPaymentMethod(str(paymentInfo.paymentMethod)),
        cardPaymentSystem: str(paymentInfo.paymentSystem),
        cardBank: str(paymentInfo.bank),
    };
}
