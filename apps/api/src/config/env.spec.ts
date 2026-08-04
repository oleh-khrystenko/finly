import { getNonNegativeIntEnvVar } from './env';

describe('getNonNegativeIntEnvVar (Sprint 19 — TRUST_PROXY_HOPS guard)', () => {
    const NAME = 'TEST_NON_NEGATIVE_INT';

    afterEach(() => {
        delete process.env[NAME];
    });

    it.each([
        ['0', 0],
        ['1', 1],
        ['12', 12],
    ])('parses valid value %s', (raw, expected) => {
        process.env[NAME] = raw;
        expect(getNonNegativeIntEnvVar(NAME)).toBe(expected);
    });

    it('crashes on missing variable (fail-fast)', () => {
        expect(() => getNonNegativeIntEnvVar(NAME)).toThrow(/is not defined/);
    });

    it.each([
        // parseInt мовчки давав NaN ('true') або обрізав хвіст ('1abc');
        // NaN у Express `trust proxy` поводиться як 0 — XFF ігнорується.
        ['true'],
        ['1abc'],
        ['-1'],
        ['1.5'],
        ['  '],
    ])('rejects non-integer/negative value %p', (raw) => {
        process.env[NAME] = raw;
        expect(() => getNonNegativeIntEnvVar(NAME)).toThrow(
            /must be a non-negative integer/
        );
    });
});
