import {
    PAYLOAD_ERROR_CODES,
    PayloadValidationError,
} from './errors';

describe('PayloadValidationError', () => {
    it('зберігає code, field, version у public-полях', () => {
        const err = new PayloadValidationError(
            'PAYLOAD_FIELD_TOO_LONG_CHARS',
            'receiverName',
            '003'
        );
        expect(err.code).toBe('PAYLOAD_FIELD_TOO_LONG_CHARS');
        expect(err.field).toBe('receiverName');
        expect(err.version).toBe('003');
    });

    it('виставляє name = PayloadValidationError для error-handler-ів', () => {
        const err = new PayloadValidationError(
            'PAYLOAD_INVALID_AMOUNT',
            'amountKopecks',
            '002'
        );
        expect(err.name).toBe('PayloadValidationError');
        expect(err).toBeInstanceOf(Error);
    });

    it('генерує дефолтний message з усіх полів', () => {
        const err = new PayloadValidationError(
            'PAYLOAD_OVERALL_SIZE_EXCEEDED',
            'payload',
            '003'
        );
        expect(err.message).toContain('PAYLOAD_OVERALL_SIZE_EXCEEDED');
        expect(err.message).toContain('payload');
        expect(err.message).toContain('003');
    });

    it('приймає custom message', () => {
        const err = new PayloadValidationError(
            'PAYLOAD_NON_COMPLIANT_HOST',
            'host',
            '003',
            'Custom explanation here'
        );
        expect(err.message).toBe('Custom explanation here');
    });

    it('допускає version=null для помилок поза payload-контекстом (host для 002 не потрібен)', () => {
        const err = new PayloadValidationError(
            'PAYLOAD_NON_COMPLIANT_HOST',
            'host',
            null
        );
        expect(err.version).toBeNull();
        expect(err.message).toContain('n/a');
    });
});

describe('PAYLOAD_ERROR_CODES', () => {
    it('має унікальні значення', () => {
        const set = new Set(PAYLOAD_ERROR_CODES);
        expect(set.size).toBe(PAYLOAD_ERROR_CODES.length);
    });

    it('усі починаються з префіксу PAYLOAD_ (для namespace-ізоляції з іншими модулями mapApiCode)', () => {
        for (const code of PAYLOAD_ERROR_CODES) {
            expect(code.startsWith('PAYLOAD_')).toBe(true);
        }
    });
});
