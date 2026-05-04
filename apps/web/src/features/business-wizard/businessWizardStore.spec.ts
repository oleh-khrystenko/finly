import { useBusinessWizardStore } from './businessWizardStore';

describe('useBusinessWizardStore', () => {
    beforeEach(() => {
        useBusinessWizardStore.getState().reset();
    });

    it('початковий currentStep = 1', () => {
        expect(useBusinessWizardStore.getState().currentStep).toBe(1);
    });

    it('initial formData містить дефолти (type=fop, isVatPayer=false, всі 11 банків)', () => {
        const data = useBusinessWizardStore.getState().formData;
        expect(data.type).toBe('fop');
        expect(data.isVatPayer).toBe(false);
        expect(data.acceptedBanks).toHaveLength(11);
    });

    it('setStep змінює currentStep', () => {
        useBusinessWizardStore.getState().setStep(3);
        expect(useBusinessWizardStore.getState().currentStep).toBe(3);
    });

    it('patchFormData merge-ує partial у formData без втрати інших полів', () => {
        const { patchFormData } = useBusinessWizardStore.getState();
        patchFormData({ name: 'Іваненко' });
        patchFormData({
            requisites: {
                iban: 'UA213223130000026007233566001',
                taxId: '1234567899',
            },
        });
        const data = useBusinessWizardStore.getState().formData;
        expect(data.name).toBe('Іваненко');
        expect(data.requisites?.iban).toBe('UA213223130000026007233566001');
        expect(data.type).toBe('fop'); // дефолт залишився
    });

    it('reset повертає до initial state', () => {
        const { setStep, patchFormData, reset } =
            useBusinessWizardStore.getState();
        setStep(4);
        patchFormData({ name: 'Test' });
        reset();
        const s = useBusinessWizardStore.getState();
        expect(s.currentStep).toBe(1);
        expect(s.formData.name).toBeUndefined();
    });
});
