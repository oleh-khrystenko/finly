import {
    ALLOWED_NBU_PAYLOAD_LINK_HOSTS_003,
    NBU_HOST_LEGACY,
    NBU_HOST_PRIMARY,
    URL_PREFIX_002,
    isAllowedNbuPayloadLinkHost003,
} from './url-prefix';

describe('NBU URL prefixes — постанова № 97 від 19.08.2025', () => {
    describe('URL_PREFIX_002', () => {
        it('зафіксований на legacy host згідно з нормативом (Додаток 3 §I таблиця 1)', () => {
            expect(URL_PREFIX_002).toBe('https://bank.gov.ua/qr/');
        });
    });

    describe('NBU_HOST_PRIMARY / NBU_HOST_LEGACY', () => {
        it('NBU_HOST_PRIMARY = "qr.bank.gov.ua" (рекомендований нормативом для 003)', () => {
            expect(NBU_HOST_PRIMARY).toBe('qr.bank.gov.ua');
        });

        it('NBU_HOST_LEGACY = "bank.gov.ua/qr" (запасний варіант для двох-кнопкової UI)', () => {
            expect(NBU_HOST_LEGACY).toBe('bank.gov.ua/qr');
        });
    });

    describe('ALLOWED_NBU_PAYLOAD_LINK_HOSTS_003', () => {
        it('містить лише два host-варіанти, дозволених нормативом для не-НПП', () => {
            expect(ALLOWED_NBU_PAYLOAD_LINK_HOSTS_003).toEqual([
                NBU_HOST_PRIMARY,
                NBU_HOST_LEGACY,
            ]);
        });
    });

    describe('isAllowedNbuPayloadLinkHost003', () => {
        it('приймає основний host', () => {
            expect(isAllowedNbuPayloadLinkHost003('qr.bank.gov.ua')).toBe(true);
        });

        it('приймає fallback host', () => {
            expect(isAllowedNbuPayloadLinkHost003('bank.gov.ua/qr')).toBe(true);
        });

        it('відхиляє домен Finly (Finly не є надавачем платіжних послуг)', () => {
            expect(isAllowedNbuPayloadLinkHost003('pay.finly.com.ua')).toBe(
                false
            );
        });

        it('відхиляє повний URL замість host-частини', () => {
            expect(
                isAllowedNbuPayloadLinkHost003('https://qr.bank.gov.ua/')
            ).toBe(false);
        });

        it('відхиляє порожній рядок', () => {
            expect(isAllowedNbuPayloadLinkHost003('')).toBe(false);
        });

        it('відхиляє host з trailing slash', () => {
            expect(isAllowedNbuPayloadLinkHost003('qr.bank.gov.ua/')).toBe(
                false
            );
        });

        it('case-sensitive — відхиляє upper-case', () => {
            expect(isAllowedNbuPayloadLinkHost003('QR.BANK.GOV.UA')).toBe(
                false
            );
        });
    });
});
