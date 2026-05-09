import type { InvoicePayeeSnapshot } from '@finly/types';
import {
    effectiveInvoicePurpose,
    isInvoicePurposeRuntimeInherited,
    resolveInvoicePayeePurpose,
} from './effectiveInvoicePurpose';

// Mirror backend `apps/api/src/modules/invoices/purpose-resolver.spec.ts`.
// Якщо backend контракт зміниться (наприклад, "auto-fallback на template для
// empty/whitespace") — бекенд-тест почне падати, цей frontend-тест мусить
// бути оновлений у тому ж commit-і. Симетрія тестів — guard від silent drift.
describe('effectiveInvoicePurpose (frontend mirror)', () => {
    it('returns invoice purpose коли non-null', () => {
        expect(effectiveInvoicePurpose('Custom invoice', 'Default biz')).toBe(
            'Custom invoice'
        );
    });

    it('returns business template коли invoice purpose === null', () => {
        expect(effectiveInvoicePurpose(null, 'Default biz')).toBe(
            'Default biz'
        );
    });

    it('passthrough empty string (caller-validated invariant)', () => {
        expect(effectiveInvoicePurpose('', 'Default biz')).toBe('');
    });

    it('passthrough whitespace-only', () => {
        expect(effectiveInvoicePurpose('   ', 'Default biz')).toBe('   ');
    });

    it('повертає cyrillic input as-is', () => {
        expect(
            effectiveInvoicePurpose('Оплата за консультацію', 'Default')
        ).toBe('Оплата за консультацію');
    });

    it('preserves emoji у inheritance-bottom (business template)', () => {
        expect(effectiveInvoicePurpose(null, 'Послуги 🚀')).toBe('Послуги 🚀');
    });
});

// Mirror backend `apps/api/src/modules/invoices/payload-mapper.spec.ts` —
// snapshot-first behavior. Інваріант: cabinet UI показує РІВНО ТЕ, що піде у
// NBU payload. Якщо backend chain зміниться (наприклад, snapshot як hint
// замість primary), цей spec має бути оновлений у тому ж commit-і.
describe('resolveInvoicePayeePurpose (snapshot-aware mirror)', () => {
    const makeSnapshot = (purpose: string): InvoicePayeeSnapshot => ({
        recipientName: 'ФОП Іванко',
        iban: 'UA213223130000026007233566001',
        taxId: '1234567890',
        paymentPurpose: purpose,
    });

    it('snapshot.paymentPurpose пріоритет над live template — runtime-template-edit не ламає UI/payload-консистентність', () => {
        // ФОП виставив інвойс з paymentPurpose: null коли template був
        // "Original template at create"; потім поміняв template у settings.
        // Snapshot заморожений — UI має показати оригінал.
        expect(
            resolveInvoicePayeePurpose(
                makeSnapshot('Original template at create'),
                null,
                'New template after edit'
            )
        ).toBe('Original template at create');
    });

    it('snapshot пріоритет навіть коли invoice.paymentPurpose !== null (impossible-but-safe)', () => {
        // Snapshot — single source of truth; будь-який runtime-стан invoice
        // ігнорується. Цей кейс блокується сервісом на write (snapshot
        // populate-иться з resolved-purpose), але resolver має детерміновану
        // поведінку для будь-якого input.
        expect(
            resolveInvoicePayeePurpose(
                makeSnapshot('Snapshot wins'),
                'Per-invoice override',
                'Template'
            )
        ).toBe('Snapshot wins');
    });

    it('legacy fallback: snapshot=null + paymentPurpose=null → live template', () => {
        expect(
            resolveInvoicePayeePurpose(null, null, 'Послуги web-розробки')
        ).toBe('Послуги web-розробки');
    });

    it('legacy fallback: snapshot=null + paymentPurpose=string → invoice override', () => {
        expect(
            resolveInvoicePayeePurpose(null, 'Per-invoice override', 'Default')
        ).toBe('Per-invoice override');
    });
});

describe('isInvoicePurposeRuntimeInherited', () => {
    const snap: InvoicePayeeSnapshot = {
        recipientName: 'ФОП Іванко',
        iban: 'UA213223130000026007233566001',
        taxId: '1234567890',
        paymentPurpose: 'Frozen',
    };

    it('true тільки коли snapshot=null AND paymentPurpose=null', () => {
        expect(isInvoicePurposeRuntimeInherited(null, null)).toBe(true);
    });

    it('false коли snapshot non-null навіть з paymentPurpose=null (frozen at create — не runtime drift)', () => {
        expect(isInvoicePurposeRuntimeInherited(snap, null)).toBe(false);
    });

    it('false коли paymentPurpose non-null (explicit override, не наслідування)', () => {
        expect(isInvoicePurposeRuntimeInherited(null, 'Custom')).toBe(false);
        expect(isInvoicePurposeRuntimeInherited(snap, 'Custom')).toBe(false);
    });
});
