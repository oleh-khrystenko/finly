import {
    BANK_APP_LAUNCH,
    MVP_BANKS,
    buildBankAppLink,
    type BankCode,
} from './banks';

const LEGACY = 'https://bank.gov.ua/qr/QkNECjAwMg';

describe('BANK_APP_LAUNCH', () => {
    it('покриває кожен банк з MVP_BANKS (Record exhaustiveness)', () => {
        for (const bank of MVP_BANKS) {
            expect(BANK_APP_LAUNCH[bank]).toBeDefined();
            expect(BANK_APP_LAUNCH[bank].androidPackage).toMatch(/\w+\.\w+/);
        }
    });
});

describe('buildBankAppLink — iOS', () => {
    it('підміняє лише протокол на приватну схему банку', () => {
        expect(buildBankAppLink(LEGACY, 'monobank', 'ios')).toBe(
            'mono://bank.gov.ua/qr/QkNECjAwMg'
        );
        expect(buildBankAppLink(LEGACY, 'privatbank', 'ios')).toBe(
            'privat24://bank.gov.ua/qr/QkNECjAwMg'
        );
        expect(buildBankAppLink(LEGACY, 'abank', 'ios')).toBe(
            'abank24://bank.gov.ua/qr/QkNECjAwMg'
        );
    });

    it('повертає null, коли iOS-схема невідома (fallback на caller)', () => {
        expect(buildBankAppLink(LEGACY, 'oschadbank', 'ios')).toBeNull();
        expect(buildBankAppLink(LEGACY, 'raiffeisen', 'ios')).toBeNull();
    });

    it('не чіпає payload навіть якщо він гіпотетично містив би "https"', () => {
        // anchored `^https` — підміна лише на початку, не всередині payload.
        const link = 'https://bank.gov.ua/qr/httpsLikePayload';
        expect(buildBankAppLink(link, 'monobank', 'ios')).toBe(
            'mono://bank.gov.ua/qr/httpsLikePayload'
        );
    });
});

describe('buildBankAppLink — Android', () => {
    it('будує intent:// з примусовим package та Play Store fallback', () => {
        const link = buildBankAppLink(LEGACY, 'monobank', 'android');
        expect(link).toContain('intent://bank.gov.ua/qr/QkNECjAwMg#Intent;');
        expect(link).toContain('scheme=https;');
        expect(link).toContain('package=com.ftband.mono;');
        expect(link).toContain(
            `S.browser_fallback_url=${encodeURIComponent(
                'https://play.google.com/store/apps/details?id=com.ftband.mono'
            )};`
        );
        expect(link!.endsWith(';end')).toBe(true);
    });

    it('будує посилання навіть для банків без iOS-схеми (Android покривається завжди)', () => {
        for (const bank of MVP_BANKS as readonly BankCode[]) {
            const link = buildBankAppLink(LEGACY, bank, 'android');
            expect(link).not.toBeNull();
            expect(link).toContain(
                `package=${BANK_APP_LAUNCH[bank].androidPackage};`
            );
        }
    });
});
