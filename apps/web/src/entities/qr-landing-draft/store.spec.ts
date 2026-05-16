import { useQrLandingDraftStore } from './store';

const VALID_FORM = {
    receiverName: 'Іваненко',
    iban: 'UA213223130000026007233566001',
    taxId: '1234567899',
    purpose: 'Поповнення рахунку',
};

const VALID_RESULT = {
    link: 'https://qr.bank.gov.ua/abc',
    qrPngBase64: 'iVBORw0KGgo',
};

const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('useQrLandingDraftStore', () => {
    beforeEach(() => {
        useQrLandingDraftStore.getState().clearAll();
        localStorage.clear();
    });

    describe('initial state', () => {
        it('formData = {}, result = null, intent = idle, claimIdempotencyKey = null', () => {
            const s = useQrLandingDraftStore.getState();
            expect(s.formData).toEqual({});
            expect(s.result).toBeNull();
            expect(s.intent).toBe('idle');
            expect(s.claimIdempotencyKey).toBeNull();
        });
    });

    describe('setFormData', () => {
        it('merge-ує partial patch у formData без втрати інших полів', () => {
            const { setFormData } = useQrLandingDraftStore.getState();
            setFormData({ receiverName: 'Іваненко' });
            setFormData({ iban: 'UA213223130000026007233566001' });

            const data = useQrLandingDraftStore.getState().formData;
            expect(data.receiverName).toBe('Іваненко');
            expect(data.iban).toBe('UA213223130000026007233566001');
        });
    });

    describe('persist round-trip', () => {
        it('setFormData → стан зберігається у localStorage під ключем finly:landing-draft', () => {
            useQrLandingDraftStore.getState().setFormData(VALID_FORM);

            const raw = localStorage.getItem('finly:landing-draft');
            expect(raw).not.toBeNull();
            const parsed = JSON.parse(raw!) as {
                state: { formData: typeof VALID_FORM };
                version: number;
            };
            expect(parsed.state.formData).toEqual(VALID_FORM);
            // Sprint 10 — v2 → v3 (granular intent + claimIdempotencyKey).
            expect(parsed.version).toBe(3);
        });
    });

    describe('invalidateResult', () => {
        it('обнуляє result, але зберігає formData', () => {
            const { setFormData, setResult, invalidateResult } =
                useQrLandingDraftStore.getState();
            setFormData(VALID_FORM);
            setResult(VALID_RESULT);

            expect(useQrLandingDraftStore.getState().result).toEqual(
                VALID_RESULT
            );

            invalidateResult();

            const s = useQrLandingDraftStore.getState();
            expect(s.result).toBeNull();
            expect(s.formData).toEqual(VALID_FORM);
        });
    });

    describe('clearAll', () => {
        it('reset intent + formData + result + claimIdempotencyKey', () => {
            const { setFormData, setResult, setIntent, clearAll } =
                useQrLandingDraftStore.getState();
            setFormData(VALID_FORM);
            setResult(VALID_RESULT);
            setIntent('claim-pending');

            expect(
                useQrLandingDraftStore.getState().claimIdempotencyKey
            ).toMatch(UUID_REGEX);

            clearAll();

            const s = useQrLandingDraftStore.getState();
            expect(s.intent).toBe('idle');
            expect(s.formData).toEqual({});
            expect(s.result).toBeNull();
            expect(s.claimIdempotencyKey).toBeNull();
        });
    });

    describe('partialize — persisted shape', () => {
        it('у localStorage серіалізуються рівно formData/result/intent/claimIdempotencyKey (без actions)', () => {
            useQrLandingDraftStore.getState().setFormData(VALID_FORM);

            const raw = localStorage.getItem('finly:landing-draft');
            const parsed = JSON.parse(raw!) as {
                state: Record<string, unknown>;
            };
            expect(Object.keys(parsed.state).sort()).toEqual([
                'claimIdempotencyKey',
                'formData',
                'intent',
                'result',
            ]);
        });
    });

    describe('intent state-machine + claimIdempotencyKey lifecycle', () => {
        it('idle → claim-pending генерує UUID v4 одноразово; повторні setIntent("claim-pending") залишають той самий ключ', () => {
            const { setIntent } = useQrLandingDraftStore.getState();
            expect(
                useQrLandingDraftStore.getState().claimIdempotencyKey
            ).toBeNull();

            setIntent('claim-pending');
            const first =
                useQrLandingDraftStore.getState().claimIdempotencyKey;
            expect(first).toMatch(UUID_REGEX);

            // Recovery-cycle reuse — той самий token.
            setIntent('claim-pending');
            expect(
                useQrLandingDraftStore.getState().claimIdempotencyKey
            ).toBe(first);
        });

        it('середні транзиції (claim-business-pending, claim-failed-business, ...) НЕ торкають claimIdempotencyKey', () => {
            const { setIntent } = useQrLandingDraftStore.getState();
            setIntent('claim-pending');
            const key =
                useQrLandingDraftStore.getState().claimIdempotencyKey;

            (
                [
                    'claim-business-pending',
                    'claim-account-pending',
                    'claim-failed-business',
                    'claim-failed-account',
                    'claimed',
                ] as const
            ).forEach((intent) => {
                setIntent(intent);
                expect(useQrLandingDraftStore.getState().intent).toBe(intent);
                expect(
                    useQrLandingDraftStore.getState().claimIdempotencyKey
                ).toBe(key);
            });
        });
    });

    describe('migrate v2 → v3', () => {
        it('legacy intent=claim-failed → idle (downgrade на recoverable state)', () => {
            const v2Payload = JSON.stringify({
                state: {
                    formData: VALID_FORM,
                    result: VALID_RESULT,
                    intent: 'claim-failed',
                },
                version: 2,
            });
            localStorage.setItem('finly:landing-draft', v2Payload);

            void useQrLandingDraftStore.persist.rehydrate();

            const s = useQrLandingDraftStore.getState();
            expect(s.intent).toBe('idle');
            expect(s.formData).toEqual(VALID_FORM);
            expect(s.result).toEqual(VALID_RESULT);
            expect(s.claimIdempotencyKey).toBeNull();
        });

        it('legacy intent=claim-pending → idle (key недоступний з v2-snapshot, силент-стак гасимо)', () => {
            // Sprint 10 review fix — у v2 'claim-pending' був валідним станом
            // Sprint 8/9, але v3 потребує persisted claimIdempotencyKey (якого
            // у v2 не було). Pass-through дав би intent='claim-pending' +
            // claimIdempotencyKey=null → silent-stuck-state. Reset на 'idle'
            // дає user-у можливість свідомо натиснути CTA ще раз.
            const v2Payload = JSON.stringify({
                state: {
                    formData: VALID_FORM,
                    result: VALID_RESULT,
                    intent: 'claim-pending',
                },
                version: 2,
            });
            localStorage.setItem('finly:landing-draft', v2Payload);

            void useQrLandingDraftStore.persist.rehydrate();

            const s = useQrLandingDraftStore.getState();
            expect(s.intent).toBe('idle');
            expect(s.formData).toEqual(VALID_FORM);
            expect(s.result).toEqual(VALID_RESULT);
            expect(s.claimIdempotencyKey).toBeNull();
        });

        it('legacy intent=claimed pass-through (benign-terminal-state)', () => {
            const v2Payload = JSON.stringify({
                state: {
                    formData: VALID_FORM,
                    result: null,
                    intent: 'claimed',
                },
                version: 2,
            });
            localStorage.setItem('finly:landing-draft', v2Payload);

            void useQrLandingDraftStore.persist.rehydrate();

            const s = useQrLandingDraftStore.getState();
            expect(s.intent).toBe('claimed');
            expect(s.claimIdempotencyKey).toBeNull();
        });

        it('legacy intent=idle переноситься напряму + claimIdempotencyKey=null default', () => {
            const v2Payload = JSON.stringify({
                state: {
                    formData: VALID_FORM,
                    result: null,
                    intent: 'idle',
                },
                version: 2,
            });
            localStorage.setItem('finly:landing-draft', v2Payload);

            void useQrLandingDraftStore.persist.rehydrate();

            const s = useQrLandingDraftStore.getState();
            expect(s.intent).toBe('idle');
            expect(s.formData).toEqual(VALID_FORM);
            expect(s.claimIdempotencyKey).toBeNull();
        });

        it('v1 / corrupted payload → reset на INITIAL_STATE', () => {
            const v1Payload = JSON.stringify({
                state: {
                    formData: VALID_FORM,
                    result: VALID_RESULT,
                    intent: 'claim-pending',
                },
                version: 1,
            });
            localStorage.setItem('finly:landing-draft', v1Payload);

            void useQrLandingDraftStore.persist.rehydrate();

            const s = useQrLandingDraftStore.getState();
            expect(s.intent).toBe('idle');
            expect(s.formData).toEqual({});
            expect(s.result).toBeNull();
            expect(s.claimIdempotencyKey).toBeNull();
        });
    });
});
