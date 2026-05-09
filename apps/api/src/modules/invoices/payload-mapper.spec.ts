import { Types } from 'mongoose';

import type { BusinessDocument } from '../businesses/schemas/business.schema';
import { buildPayloadInputFromInvoice } from './payload-mapper';
import type { InvoiceDocument } from './schemas/invoice.schema';

/** Helper: minimal business stub (тільки fields, які реально читає mapper). */
function makeBusiness(
    overrides: Partial<BusinessDocument> = {}
): BusinessDocument {
    return {
        name: 'ФОП Іваненко',
        requisites: {
            iban: 'UA213223130000026007233566001',
            taxId: '1234567899',
        },
        paymentPurposeTemplate: 'Оплата за послуги',
        ...overrides,
    } as unknown as BusinessDocument;
}

/** Helper: minimal invoice stub. */
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

describe('buildPayloadInputFromInvoice (Sprint 4 §4.3)', () => {
    describe('payeeSnapshot пріоритет над live business (Sprint 4 review fix)', () => {
        it('snapshot-fields перекривають current business — receiver name/iban/taxId не drift-ять при редагуванні business', () => {
            // КРИТИЧНИЙ INVARIANT: ФОП виставив рахунок на ім'я "ФОП Іваненко"
            // з IBAN-1, потім перейменувався і поміняв IBAN. Старе посилання
            // ОБОВʼЯЗКОВО має вести на оригінальні реквізити (snapshot),
            // інакше клієнт сплачує на нові реквізити, які вже не відповідають
            // фактичному рахунку.
            const business = makeBusiness({
                name: 'ФОП Петренко (renamed)',
                requisites: {
                    iban: 'UA903052992990004149999999999', // new IBAN
                    taxId: '9876543210',
                },
            } as Partial<BusinessDocument>);
            const invoice = makeInvoice({
                payeeSnapshot: {
                    recipientName: 'ФОП Іваненко (frozen)',
                    iban: 'UA213223130000026007233566001', // original IBAN
                    taxId: '1234567899',
                    paymentPurpose: 'Frozen purpose',
                },
            } as Partial<InvoiceDocument>);
            const result = buildPayloadInputFromInvoice(business, invoice);

            expect(result.receiverName).toBe('ФОП Іваненко (frozen)');
            expect(result.iban).toBe('UA213223130000026007233566001');
            expect(result.receiverTaxId).toBe('1234567899');
            expect(result.purpose).toBe('Frozen purpose');
        });

        it('snapshot.paymentPurpose пріоритет — runtime-template-edit не торкає payload', () => {
            // Особливо поганий кейс з review feedback-у: with-purpose slug
            // генерується на момент create з effectivePurpose, але payload
            // потім читав live business.paymentPurposeTemplate. URL fixed на
            // старе призначення, payload — нове. Snapshot фрозить purpose
            // у тому самому місці, де slug-генератор його використав.
            const business = makeBusiness({
                paymentPurposeTemplate: 'New template after edit',
            });
            const invoice = makeInvoice({
                paymentPurpose: null, // user не задав, мав inherit
                payeeSnapshot: {
                    recipientName: 'ФОП Іваненко',
                    iban: 'UA213223130000026007233566001',
                    taxId: '1234567899',
                    paymentPurpose: 'Original template at create',
                },
            } as Partial<InvoiceDocument>);
            const result = buildPayloadInputFromInvoice(business, invoice);
            expect(result.purpose).toBe('Original template at create');
        });
    });

    describe('legacy fallback на live business (payeeSnapshot=null/missing)', () => {
        it('маппить receiver-fields з business для legacy invoices', () => {
            // Existing-pre-Sprint-4-review-fix invoices не мають snapshot —
            // fallback на business поки migration не backfill-ить.
            const business = makeBusiness({
                name: 'ФОП Петренко',
                requisites: {
                    iban: 'UA903052992990004149123456789',
                    taxId: '9876543210',
                },
            } as Partial<BusinessDocument>);
            const result = buildPayloadInputFromInvoice(
                business,
                makeInvoice() // payeeSnapshot undefined
            );

            expect(result.receiverName).toBe('ФОП Петренко');
            expect(result.iban).toBe('UA903052992990004149123456789');
            expect(result.receiverTaxId).toBe('9876543210');
        });

        it('explicit payeeSnapshot=null теж тригерить fallback', () => {
            const result = buildPayloadInputFromInvoice(
                makeBusiness(),
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
            makeInvoice({ amount: 250000 })
        );
        expect(result.amountKopecks).toBe(250000);
    });

    it('amountKopecks: null → null (signage mode "клієнт вводить суму")', () => {
        const result = buildPayloadInputFromInvoice(
            makeBusiness(),
            makeInvoice({ amount: null, amountLocked: false })
        );
        expect(result.amountKopecks).toBeNull();
    });

    describe('fieldLockMask (derived з amountLocked)', () => {
        it('amountLocked=true → FFFF (все locked)', () => {
            const result = buildPayloadInputFromInvoice(
                makeBusiness(),
                makeInvoice({ amountLocked: true, amount: 100000 })
            );
            expect(result.fieldLockMask).toBe('FFFF');
        });

        it('amountLocked=false → FEFF (сума editable)', () => {
            const result = buildPayloadInputFromInvoice(
                makeBusiness(),
                makeInvoice({ amountLocked: false, amount: 100000 })
            );
            expect(result.fieldLockMask).toBe('FEFF');
        });
    });

    describe('purpose-inheritance (single helper з purpose-resolver)', () => {
        it('invoice.paymentPurpose != null → бере з invoice', () => {
            const result = buildPayloadInputFromInvoice(
                makeBusiness({ paymentPurposeTemplate: 'Default biz' }),
                makeInvoice({ paymentPurpose: 'Per-invoice override' })
            );
            expect(result.purpose).toBe('Per-invoice override');
        });

        it('invoice.paymentPurpose === null → fallback на business.paymentPurposeTemplate', () => {
            const result = buildPayloadInputFromInvoice(
                makeBusiness({
                    paymentPurposeTemplate: 'Послуги web-розробки',
                }),
                makeInvoice({ paymentPurpose: null })
            );
            expect(result.purpose).toBe('Послуги web-розробки');
        });
    });

    describe('validUntil (Kyiv-tz конвертація)', () => {
        it('null → null', () => {
            const result = buildPayloadInputFromInvoice(
                makeBusiness(),
                makeInvoice({ validUntil: null })
            );
            expect(result.validUntil).toBeNull();
        });

        it('Date → YYMMDDHHmmss формат у Kyiv-tz', () => {
            // Sprint-plan example: 23:59:59 Kyiv (DST) = UTC 20:59:59
            const dst = new Date('2026-05-04T20:59:59.000Z');
            const result = buildPayloadInputFromInvoice(
                makeBusiness(),
                makeInvoice({ validUntil: dst })
            );
            expect(result.validUntil).toBe('260504235959');
        });

        it('зимова дата (UTC+2): 22:30Z грудня 15 = Kyiv 00:30 грудня 16', () => {
            const winter = new Date('2026-12-15T22:30:00.000Z');
            const result = buildPayloadInputFromInvoice(
                makeBusiness(),
                makeInvoice({ validUntil: winter })
            );
            expect(result.validUntil).toBe('261216003000');
        });
    });

    it('full output shape (smoke): усі fields присутні', () => {
        const business = makeBusiness();
        const invoice = makeInvoice({
            amount: 150000,
            amountLocked: true,
            paymentPurpose: 'Оплата',
            validUntil: new Date('2026-12-31T21:59:59.000Z'),
        });
        const result = buildPayloadInputFromInvoice(business, invoice);

        expect(result).toEqual({
            receiverName: business.name,
            iban: business.requisites.iban,
            receiverTaxId: business.requisites.taxId,
            amountKopecks: 150000,
            purpose: 'Оплата',
            fieldLockMask: 'FFFF',
            validUntil: '261231235959',
        });
    });
});
