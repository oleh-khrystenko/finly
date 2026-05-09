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

describe('useQrLandingDraftStore', () => {
    beforeEach(() => {
        useQrLandingDraftStore.getState().clearAll();
        localStorage.clear();
    });

    describe('initial state', () => {
        it('formData = {}, result = null, intent = idle', () => {
            const s = useQrLandingDraftStore.getState();
            expect(s.formData).toEqual({});
            expect(s.result).toBeNull();
            expect(s.intent).toBe('idle');
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

    describe('persist round-trip (Sprint 8 §8.2 інваріант 1)', () => {
        it('setFormData → стан зберігається у localStorage під ключем finly:landing-draft', () => {
            useQrLandingDraftStore.getState().setFormData(VALID_FORM);

            const raw = localStorage.getItem('finly:landing-draft');
            expect(raw).not.toBeNull();
            const parsed = JSON.parse(raw!) as {
                state: { formData: typeof VALID_FORM };
                version: number;
            };
            expect(parsed.state.formData).toEqual(VALID_FORM);
            expect(parsed.version).toBe(1);
        });
    });

    describe('invalidateResult (Sprint 8 §8.2 інваріант 2)', () => {
        it('обнуляє result, але зберігає formData (юзер редагує поле — старий QR не вводить в оману)', () => {
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
            expect(s.formData).toEqual(VALID_FORM); // formData збережена
        });
    });

    describe('clearAll (Sprint 8 §8.2 інваріант 3)', () => {
        it('робить intent = "idle" — захист від повторного claim-trigger у hook (§8.4)', () => {
            const { setFormData, setResult, setIntent, clearAll } =
                useQrLandingDraftStore.getState();
            setFormData(VALID_FORM);
            setResult(VALID_RESULT);
            setIntent('claim-pending');

            clearAll();

            const s = useQrLandingDraftStore.getState();
            expect(s.intent).toBe('idle');
            expect(s.formData).toEqual({});
            expect(s.result).toBeNull();
        });
    });

    describe('partialize — persisted shape (Sprint 8 §8.2 захист від drift-у)', () => {
        it('у localStorage серіалізуються рівно formData/result/intent (без actions)', () => {
            useQrLandingDraftStore.getState().setFormData(VALID_FORM);

            const raw = localStorage.getItem('finly:landing-draft');
            const parsed = JSON.parse(raw!) as { state: Record<string, unknown> };
            expect(Object.keys(parsed.state).sort()).toEqual([
                'formData',
                'intent',
                'result',
            ]);
        });
    });

    describe('intent state-machine', () => {
        it.each(['idle', 'claim-pending', 'claimed', 'claim-failed'] as const)(
            'setIntent("%s") коректно оновлює стан',
            (intent) => {
                useQrLandingDraftStore.getState().setIntent(intent);
                expect(useQrLandingDraftStore.getState().intent).toBe(intent);
            }
        );
    });
});
