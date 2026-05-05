import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';

import type { BusinessDocument } from '../businesses/schemas/business.schema';
import { InvoiceAccessGuard } from './invoice-access.guard';
import type { InvoicesService } from './invoices.service';
import type { InvoiceDocument } from './schemas/invoice.schema';

describe('InvoiceAccessGuard (Sprint 4 §4.2)', () => {
    let invoicesService: jest.Mocked<Pick<InvoicesService, 'getBySlug'>>;
    let guard: InvoiceAccessGuard;
    const businessId = new Types.ObjectId();
    const business = { _id: businessId } as BusinessDocument;

    /** Helper: побудувати ExecutionContext stub з кастомним request. */
    const buildContext = (
        request: Record<string, unknown>
    ): ExecutionContext => {
        return {
            switchToHttp: () => ({
                getRequest: () => request,
            }),
        } as unknown as ExecutionContext;
    };

    beforeEach(() => {
        invoicesService = {
            getBySlug: jest.fn(),
        };
        guard = new InvoiceAccessGuard(
            invoicesService as unknown as InvoicesService
        );
    });

    it('успіх: lookup за (business._id, invoiceSlug) → attach request.invoice', async () => {
        const invoice = {
            _id: new Types.ObjectId(),
            slug: 'inv-001-aB3xQ9k7',
        } as InvoiceDocument;
        invoicesService.getBySlug.mockResolvedValue(invoice);

        const request = {
            business,
            params: { slug: 'IvanEnko', invoiceSlug: 'inv-001-aB3xQ9k7' },
        };
        const ctx = buildContext(request);

        const result = await guard.canActivate(ctx);
        expect(result).toBe(true);
        expect(invoicesService.getBySlug).toHaveBeenCalledWith(
            businessId,
            'inv-001-aB3xQ9k7'
        );
        expect(request).toMatchObject({ invoice });
    });

    it('case-sensitive: lookup передає exact slug без to-lower', async () => {
        invoicesService.getBySlug.mockResolvedValue(null);
        const request = {
            business,
            params: { invoiceSlug: 'INV-001-aB3xQ9k7' }, // uppercase у середині
        };
        await expect(
            guard.canActivate(buildContext(request))
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(invoicesService.getBySlug).toHaveBeenCalledWith(
            businessId,
            'INV-001-aB3xQ9k7' // ← без модифікації; SP-8: case-sensitive
        );
    });

    it('програмерська помилка: відсутній request.business → throw Error (не 404)', async () => {
        const request = {
            // ⚠ business undefined — попередній guard не запущений
            params: { invoiceSlug: 'foo' },
        };
        await expect(guard.canActivate(buildContext(request))).rejects.toThrow(
            /requires BusinessAccessGuard/
        );
    });

    it('відсутній invoiceSlug у params → 404 INVOICE_NOT_FOUND', async () => {
        const request = { business, params: {} };
        await expect(
            guard.canActivate(buildContext(request))
        ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('порожній invoiceSlug → 404', async () => {
        const request = { business, params: { invoiceSlug: '' } };
        await expect(
            guard.canActivate(buildContext(request))
        ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('invoice не знайдено → 404 INVOICE_NOT_FOUND', async () => {
        invoicesService.getBySlug.mockResolvedValue(null);
        const request = {
            business,
            params: { invoiceSlug: 'missing-aaaaaaaa' },
        };
        await expect(
            guard.canActivate(buildContext(request))
        ).rejects.toBeInstanceOf(NotFoundException);
    });
});
