import { Types } from 'mongoose';

import type { BusinessDocument } from './schemas/business.schema';
import { buildPayloadInputFromBusiness } from './payload-mapper';

describe('buildPayloadInputFromBusiness', () => {
    const baseBusiness = {
        name: 'ФОП Іваненко',
        requisites: {
            iban: 'UA213223130000026007233566001',
            taxId: '1234567899',
        },
        paymentPurposeTemplate: 'Оплата за послуги',
        // Усе інше з BusinessDocument не використовується mapper-ом, тому
        // мінімальна заглушка — фокус тесту на логіці маппінгу, а не на shape.
    } as unknown as BusinessDocument;

    it('маппить name → receiverName', () => {
        const result = buildPayloadInputFromBusiness(baseBusiness);
        expect(result.receiverName).toBe('ФОП Іваненко');
    });

    it('маппить requisites.iban → iban', () => {
        const result = buildPayloadInputFromBusiness(baseBusiness);
        expect(result.iban).toBe('UA213223130000026007233566001');
    });

    it('маппить requisites.taxId → receiverTaxId', () => {
        const result = buildPayloadInputFromBusiness(baseBusiness);
        expect(result.receiverTaxId).toBe('1234567899');
    });

    it('маппить paymentPurposeTemplate → purpose', () => {
        const result = buildPayloadInputFromBusiness(baseBusiness);
        expect(result.purpose).toBe('Оплата за послуги');
    });

    it('amountKopecks завжди null (вивіска без суми, рішення A3)', () => {
        const result = buildPayloadInputFromBusiness(baseBusiness);
        expect(result.amountKopecks).toBeNull();
    });

    it('не leak-ить непотрібні поля бізнесу у payload (taxationSystem, ownerId, slug, ...)', () => {
        const business = {
            ...baseBusiness,
            slug: 'IvanEnko',
            slugLower: 'ivanenko',
            taxationSystem: 'simplified-3',
            isVatPayer: true,
            ownerId: new Types.ObjectId(),
            managers: [],
            seoIndexEnabled: false,
        } as unknown as BusinessDocument;
        const result = buildPayloadInputFromBusiness(business);
        expect(Object.keys(result).sort()).toEqual([
            'amountKopecks',
            'iban',
            'purpose',
            'receiverName',
            'receiverTaxId',
        ]);
    });
});
