import { Types } from 'mongoose';

import type { AccountDocument } from '../accounts/schemas/account.schema';
import type { BusinessDocument } from '../businesses/schemas/business.schema';
import { buildPayloadInputFromInvoice } from './payload-mapper';
import type { InvoiceDocument } from './schemas/invoice.schema';

function makeBusiness(
    overrides: Partial<BusinessDocument> = {}
): BusinessDocument {
    return {
        name: 'ФОП Іваненко',
        taxId: '1234567899',
        paymentPurposeTemplate: 'Оплата за послуги',
        ...overrides,
    } as unknown as BusinessDocument;
}

function makeAccount(
    overrides: Partial<AccountDocument> = {}
): AccountDocument {
    return {
        iban: 'UA213223130000026007233566001',
        ...overrides,
    } as unknown as AccountDocument;
}

function makeInvoice(
    overrides: Partial<InvoiceDocument> = {}
): InvoiceDocument {
    return {
        _id: new Types.ObjectId(),
        slug: 'inv-001-aB3xQ9k7',
        amount: 150000,
        amountLocked: true,
        paymentPurpose: 'Custom invoice purpose',
        validUntil: null,
        ...overrides,
    } as unknown as InvoiceDocument;
}

describe('buildPayloadInputFromInvoice (Sprint 9 §9.1 — приймає 3 параметри)', () => {
    describe('payeeSnapshot пріоритет над live business/account', () => {
        it('snapshot-fields перекривають current business+account', () => {
            const business = makeBusiness({
                name: 'ФОП Петренко (renamed)',
                taxId: '9876543210',
            } as Partial<BusinessDocument>);
            const account = makeAccount({
                iban: 'UA903052992990004149999999999', // new IBAN
            } as Partial<AccountDocument>);
            const invoice = makeInvoice({
                payeeSnapshot: {
                    recipientName: 'ФОП Іваненко (frozen)',
                    iban: 'UA213223130000026007233566001', // original IBAN
                    taxId: '1234567899',
                    paymentPurpose: 'Frozen purpose',
                },
            } as Partial<InvoiceDocument>);
            const result = buildPayloadInputFromInvoice(
                business,
                account,
                invoice
            );

            expect(result.receiverName).toBe('ФОП Іваненко (frozen)');
            expect(result.iban).toBe('UA213223130000026007233566001');
            expect(result.receiverTaxId).toBe('1234567899');
            expect(result.purpose).toBe('Frozen purpose');
        });

        it('snapshot.paymentPurpose пріоритет — runtime-template-edit не торкає payload', () => {
            const business = makeBusiness({
                paymentPurposeTemplate: 'New template after edit',
            });
            const account = makeAccount();
            const invoice = makeInvoice({
                paymentPurpose: null,
                payeeSnapshot: {
                    recipientName: 'ФОП Іваненко',
                    iban: 'UA213223130000026007233566001',
                    taxId: '1234567899',
                    paymentPurpose: 'Original template at create',
                },
            } as Partial<InvoiceDocument>);
            const result = buildPayloadInputFromInvoice(
                business,
                account,
                invoice
            );
            expect(result.purpose).toBe('Original template at create');
        });
    });

    describe('legacy fallback на live business/account (payeeSnapshot=null)', () => {
        it('маппить receiver-fields з business + account для legacy invoices', () => {
            const business = makeBusiness({
                name: 'ФОП Петренко',
                taxId: '9876543210',
            } as Partial<BusinessDocument>);
            const account = makeAccount({
                iban: 'UA903052992990004149123456789',
            } as Partial<AccountDocument>);
            const result = buildPayloadInputFromInvoice(
                business,
                account,
                makeInvoice()
            );

            expect(result.receiverName).toBe('ФОП Петренко');
            expect(result.iban).toBe('UA903052992990004149123456789');
            expect(result.receiverTaxId).toBe('9876543210');
        });

        it('explicit payeeSnapshot=null теж тригерить fallback', () => {
            const result = buildPayloadInputFromInvoice(
                makeBusiness(),
                makeAccount(),
                makeInvoice({
                    payeeSnapshot: null,
                } as Partial<InvoiceDocument>)
            );
            expect(result.receiverName).toBe('ФОП Іваненко');
        });
    });

    it('amountKopecks: бере з invoice.amount (число у копійках)', () => {
        const result = buildPayloadInputFromInvoice(
            makeBusiness(),
            makeAccount(),
            makeInvoice({ amount: 250000 })
        );
        expect(result.amountKopecks).toBe(250000);
    });

    it('amountKopecks: null → null (signage mode "клієнт вводить суму")', () => {
        const result = buildPayloadInputFromInvoice(
            makeBusiness(),
            makeAccount(),
            makeInvoice({ amount: null, amountLocked: false })
        );
        expect(result.amountKopecks).toBeNull();
    });

    describe('fieldLockMask (derived з amountLocked)', () => {
        it('amountLocked=true → FFFF (все locked)', () => {
            const result = buildPayloadInputFromInvoice(
                makeBusiness(),
                makeAccount(),
                makeInvoice({ amountLocked: true, amount: 100000 })
            );
            expect(result.fieldLockMask).toBe('FFFF');
        });

        it('amountLocked=false → FEFF (сума editable)', () => {
            const result = buildPayloadInputFromInvoice(
                makeBusiness(),
                makeAccount(),
                makeInvoice({ amountLocked: false, amount: 100000 })
            );
            expect(result.fieldLockMask).toBe('FEFF');
        });
    });

    describe('purpose-inheritance', () => {
        it('invoice.paymentPurpose != null → бере з invoice', () => {
            const result = buildPayloadInputFromInvoice(
                makeBusiness({ paymentPurposeTemplate: 'Default biz' }),
                makeAccount(),
                makeInvoice({ paymentPurpose: 'Per-invoice override' })
            );
            expect(result.purpose).toBe('Per-invoice override');
        });

        it('invoice.paymentPurpose === null → fallback на business.paymentPurposeTemplate', () => {
            const result = buildPayloadInputFromInvoice(
                makeBusiness({
                    paymentPurposeTemplate: 'Послуги web-розробки',
                }),
                makeAccount(),
                makeInvoice({ paymentPurpose: null })
            );
            expect(result.purpose).toBe('Послуги web-розробки');
        });

        // Sprint 29 — ланцюг успадкування трирівневий: invoice → account →
        // business. Рахунок з власним призначенням (ЄСВ окремо від військового
        // збору) не має «провалюватись» одразу на шаблон отримувача, інакше
        // документ під ним пішов би в банк з чужим призначенням.
        it('invoice.paymentPurpose === null → account-override перекриває business-шаблон', () => {
            const result = buildPayloadInputFromInvoice(
                makeBusiness({
                    paymentPurposeTemplate: 'Оплата за послуги',
                }),
                makeAccount({
                    paymentPurposeTemplate: 'Військовий збір',
                } as Partial<AccountDocument>),
                makeInvoice({ paymentPurpose: null })
            );
            expect(result.purpose).toBe('Військовий збір');
        });

        it('invoice.paymentPurpose non-null перекриває і account-override', () => {
            const result = buildPayloadInputFromInvoice(
                makeBusiness(),
                makeAccount({
                    paymentPurposeTemplate: 'Військовий збір',
                } as Partial<AccountDocument>),
                makeInvoice({ paymentPurpose: 'Оплата за консультацію' })
            );
            expect(result.purpose).toBe('Оплата за консультацію');
        });
    });

    describe('validUntil (Kyiv-tz конвертація)', () => {
        it('null → null', () => {
            const result = buildPayloadInputFromInvoice(
                makeBusiness(),
                makeAccount(),
                makeInvoice({ validUntil: null })
            );
            expect(result.validUntil).toBeNull();
        });

        it('Date → YYMMDDHHmmss формат у Kyiv-tz', () => {
            const dst = new Date('2026-05-04T20:59:59.000Z');
            const result = buildPayloadInputFromInvoice(
                makeBusiness(),
                makeAccount(),
                makeInvoice({ validUntil: dst })
            );
            expect(result.validUntil).toBe('260504235959');
        });

        it('зимова дата (UTC+2): 22:30Z грудня 15 = Kyiv 00:30 грудня 16', () => {
            const winter = new Date('2026-12-15T22:30:00.000Z');
            const result = buildPayloadInputFromInvoice(
                makeBusiness(),
                makeAccount(),
                makeInvoice({ validUntil: winter })
            );
            expect(result.validUntil).toBe('261216003000');
        });
    });

    it('full output shape (smoke): усі fields присутні', () => {
        const business = makeBusiness();
        const account = makeAccount();
        const invoice = makeInvoice({
            amount: 150000,
            amountLocked: true,
            paymentPurpose: 'Оплата',
            validUntil: new Date('2026-12-31T21:59:59.000Z'),
        });
        const result = buildPayloadInputFromInvoice(business, account, invoice);

        expect(result).toEqual({
            receiverName: business.name,
            iban: account.iban,
            receiverTaxId: business.taxId,
            amountKopecks: 150000,
            purpose: 'Оплата',
            fieldLockMask: 'FFFF',
            validUntil: '261231235959',
        });
    });
});
