import { isPublicHost, PUBLIC_HOSTS } from './publicHosts';

/**
 * Перезавантажує `publicHosts` (а з ним і `./env`) з іншою конфігурацією.
 * Потрібно тому, що whitelist став ПОХІДНИМ від `NEXT_PUBLIC_PAY_PUBLIC_URL`:
 * саме цю залежність і треба перевіряти, інакше регресія «список розійшовся з
 * конфігурацією» лишилась би непокритою — рівно та регресія, через яку зашитий
 * у код порт був пасткою.
 */
function loadWithEnv(baseUrl: string, payUrl: string) {
    const original = {
        base: process.env.NEXT_PUBLIC_BASE_URL,
        pay: process.env.NEXT_PUBLIC_PAY_PUBLIC_URL,
    };
    process.env.NEXT_PUBLIC_BASE_URL = baseUrl;
    process.env.NEXT_PUBLIC_PAY_PUBLIC_URL = payUrl;
    try {
        let mod!: typeof import('./publicHosts');
        jest.isolateModules(() => {
            mod = jest.requireActual<typeof import('./publicHosts')>(
                './publicHosts'
            );
        });
        return mod;
    } finally {
        process.env.NEXT_PUBLIC_BASE_URL = original.base;
        process.env.NEXT_PUBLIC_PAY_PUBLIC_URL = original.pay;
    }
}

describe('PUBLIC_HOSTS / isPublicHost', () => {
    // Базові кейси — на прод-подібній конфігурації з `jest.setup.ts`
    // (кабінет і pay на різних піддоменах), як і решта web-тестів.

    it('whitelist — це хост з NEXT_PUBLIC_PAY_PUBLIC_URL', () => {
        expect(PUBLIC_HOSTS).toEqual(['pay.finly.com.ua']);
    });

    it('isPublicHost: pay.finly.com.ua → true', () => {
        expect(isPublicHost('pay.finly.com.ua')).toBe(true);
    });

    it('isPublicHost: cabinet finly.com.ua → false', () => {
        expect(isPublicHost('finly.com.ua')).toBe(false);
    });

    it('isPublicHost: null/undefined/empty → false', () => {
        expect(isPublicHost(null)).toBe(false);
        expect(isPublicHost(undefined)).toBe(false);
        expect(isPublicHost('')).toBe(false);
    });

    it('isPublicHost: case-INsensitive PAY.FINLY.COM.UA → true (RFC 7230 §2.7)', () => {
        // Регресія: strict-eq comparison ламав host-isolation. Reverse-proxy
        // / curl / нестандартні клієнти можуть передавати UPPER або mixed
        // case — middleware має розпізнавати як public, інакше Branch B
        // обходиться і `/auth/signin` повертає валідну відповідь на pay-host.
        expect(isPublicHost('PAY.FINLY.COM.UA')).toBe(true);
        expect(isPublicHost('Pay.Finly.Com.Ua')).toBe(true);
    });

    describe('похідність від конфігурації', () => {
        it('dev-конфігурація: pay-зона — це той самий host з іншим портом', () => {
            // У dev кабінет і pay-зона різняться ЛИШЕ портом, тож порівняння
            // мусить враховувати порт. Якби whitelist містив голий `localhost`,
            // кабінетний порт теж став би публічним — Branch B віддавав би 404
            // на `/business`, а `/auth/signin` зник би разом з можливістю увійти.
            const mod = loadWithEnv(
                'http://localhost:3000',
                'http://localhost:3001'
            );

            expect(mod.PUBLIC_HOSTS).toEqual(['localhost:3001']);
            expect(mod.isPublicHost('localhost:3001')).toBe(true);
            expect(mod.isPublicHost('LocalHost:3001')).toBe(true);
            expect(mod.isPublicHost('localhost:3000')).toBe(false);
            expect(mod.isPublicHost('localhost')).toBe(false);
        });

        it('зміна pay-порту в конфігурації переносить whitelist за собою', () => {
            // Головна регресія: доки порт був зашитий у код, `PAY_PORT=4001`
            // у `.env` розсинхронізував конфігурацію і whitelist — публічна
            // сторінка мовчки ставала 404-ом кабінету, а QR-коди вели у нікуди.
            const mod = loadWithEnv(
                'http://localhost:3000',
                'http://localhost:4001'
            );

            expect(mod.PUBLIC_HOSTS).toEqual(['localhost:4001']);
            expect(mod.isPublicHost('localhost:4001')).toBe(true);
            expect(mod.isPublicHost('localhost:3001')).toBe(false);
        });

        it('pay-origin, що збігається з кабінетним → падіння на старті', () => {
            // Ціна похідного whitelist: хибна конфігурація зробила б кабінет
            // публічною зоною, тобто `/business` і `/auth/signin` віддавали б
            // 404 і ніхто не зміг би увійти. Тому це crash, а не «як є».
            expect(() =>
                loadWithEnv('https://finly.com.ua', 'https://finly.com.ua')
            ).toThrow(/identical to NEXT_PUBLIC_BASE_URL/);
        });

        it('pay-origin не-URL → падіння на старті', () => {
            expect(() =>
                loadWithEnv('http://localhost:3000', 'pay.finly.com.ua')
            ).toThrow(/must be an absolute URL/);
        });
    });
});
