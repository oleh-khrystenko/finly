import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';

import type { AccountDocument } from '../accounts/schemas/account.schema';
import { InvoiceAccessGuard } from './invoice-access.guard';
import type { InvoicesService } from './invoices.service';
import type { InvoiceDocument } from './schemas/invoice.schema';

describe('InvoiceAccessGuard (Sprint 9 §SP-6 — lookup by accountId)', () => {
    let invoicesService: jest.Mocked<Pick<InvoicesService, 'getBySlug'>>;
    let guard: InvoiceAccessGuard;
    const accountId = new Types.ObjectId();
    const account = { _id: accountId } as AccountDocument;

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

    it('успіх: lookup за (account._id, invoiceSlug) → attach request.invoice', async () => {
        const invoice = {
            _id: new Types.ObjectId(),
            slug: 'inv-001-aB3xQ9k7',
        } as InvoiceDocument;
        invoicesService.getBySlug.mockResolvedValue(invoice);

        const request = {
            account,
            params: { invoiceSlug: 'inv-001-aB3xQ9k7' },
        };
        const ctx = buildContext(request);

        const result = await guard.canActivate(ctx);
        expect(result).toBe(true);
        expect(invoicesService.getBySlug).toHaveBeenCalledWith(
            accountId,
            'inv-001-aB3xQ9k7'
        );
        expect(request).toMatchObject({ invoice });
    });

    it('case-sensitive: lookup передає exact slug без to-lower', async () => {
        invoicesService.getBySlug.mockResolvedValue(null);
        const request = {
            account,
            params: { invoiceSlug: 'INV-001-aB3xQ9k7' },
        };
        await expect(
            guard.canActivate(buildContext(request))
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(invoicesService.getBySlug).toHaveBeenCalledWith(
            accountId,
            'INV-001-aB3xQ9k7'
        );
    });

    it('програмерська помилка: відсутній request.account → throw Error (не 404)', async () => {
        const request = {
            // ⚠ account undefined — попередній guard не запущений
            params: { invoiceSlug: 'foo' },
        };
        await expect(guard.canActivate(buildContext(request))).rejects.toThrow(
            /requires AccountAccessGuard/
        );
    });

    it('відсутній invoiceSlug у params → 404 INVOICE_NOT_FOUND', async () => {
        const request = { account, params: {} };
        await expect(
            guard.canActivate(buildContext(request))
        ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('порожній invoiceSlug → 404', async () => {
        const request = { account, params: { invoiceSlug: '' } };
        await expect(
            guard.canActivate(buildContext(request))
        ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('invoice не знайдено → 404 INVOICE_NOT_FOUND', async () => {
        invoicesService.getBySlug.mockResolvedValue(null);
        const request = {
            account,
            params: { invoiceSlug: 'missing-aaaaaaaa' },
        };
        await expect(
            guard.canActivate(buildContext(request))
        ).rejects.toBeInstanceOf(NotFoundException);
    });
});
