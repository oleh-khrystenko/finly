import { MVP_BANKS } from '../constants/banks';
import {
    BANK_PAYLOAD_VERSION,
    getPayloadVersionForBank,
} from './bank-version-map';
import { PAYLOAD_VERSIONS } from './format-version';

describe('BANK_PAYLOAD_VERSION', () => {
    it('покриває всі банки з MVP_BANKS (smoke-test exhaustivness)', () => {
        for (const bank of MVP_BANKS) {
            expect(BANK_PAYLOAD_VERSION[bank]).toBeDefined();
        }
    });

    it('усі значення — з PAYLOAD_VERSIONS', () => {
        for (const bank of MVP_BANKS) {
            expect(PAYLOAD_VERSIONS).toContain(BANK_PAYLOAD_VERSION[bank]);
        }
    });

    it('MVP-стан: усі 11 банків — на 003', () => {
        expect(Object.keys(BANK_PAYLOAD_VERSION)).toHaveLength(
            MVP_BANKS.length
        );
        for (const bank of MVP_BANKS) {
            expect(BANK_PAYLOAD_VERSION[bank]).toBe('003');
        }
    });
});

describe('getPayloadVersionForBank', () => {
    it('повертає 003 для всіх MVP банків', () => {
        for (const bank of MVP_BANKS) {
            expect(getPayloadVersionForBank(bank)).toBe('003');
        }
    });

    it('точкова перевірка популярних банків', () => {
        expect(getPayloadVersionForBank('privatbank')).toBe('003');
        expect(getPayloadVersionForBank('monobank')).toBe('003');
        expect(getPayloadVersionForBank('pumb')).toBe('003');
    });
});
