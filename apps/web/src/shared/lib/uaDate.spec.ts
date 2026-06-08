import { uaDateToIso, isoToUaDate } from './uaDate';

describe('uaDateToIso', () => {
    it('валідна дата ДД.ММ.РРРР → ISO', () => {
        expect(uaDateToIso('15.08.2026')).toBe('2026-08-15');
        expect(uaDateToIso('01.01.2026')).toBe('2026-01-01');
        expect(uaDateToIso(' 31.12.2026 ')).toBe('2026-12-31');
    });

    it('неіснуюча дата → null', () => {
        expect(uaDateToIso('31.02.2026')).toBeNull();
        expect(uaDateToIso('30.02.2026')).toBeNull();
        expect(uaDateToIso('00.05.2026')).toBeNull();
        expect(uaDateToIso('15.13.2026')).toBeNull();
    });

    it('невалідний формат → null', () => {
        expect(uaDateToIso('')).toBeNull();
        expect(uaDateToIso('15.8.2026')).toBeNull();
        expect(uaDateToIso('2026-08-15')).toBeNull();
        expect(uaDateToIso('15/08/2026')).toBeNull();
        expect(uaDateToIso('abc')).toBeNull();
    });
});

describe('isoToUaDate', () => {
    it('ISO → ДД.ММ.РРРР', () => {
        expect(isoToUaDate('2026-08-15')).toBe('15.08.2026');
        expect(isoToUaDate('2026-01-01')).toBe('01.01.2026');
    });

    it('невалідний/порожній вхід → пустий рядок', () => {
        expect(isoToUaDate('')).toBe('');
        expect(isoToUaDate('15.08.2026')).toBe('');
    });

    it('round-trip uaDateToIso ∘ isoToUaDate', () => {
        const iso = uaDateToIso('07.03.2026')!;
        expect(isoToUaDate(iso)).toBe('07.03.2026');
    });
});
