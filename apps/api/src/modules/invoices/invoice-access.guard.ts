import {
    CanActivate,
    ExecutionContext,
    Injectable,
    NotFoundException,
    createParamDecorator,
} from '@nestjs/common';
import { Request } from 'express';
import { RESPONSE_CODE } from '@finly/types';

import type { AccountDocument } from '../accounts/schemas/account.schema';
import type { BusinessDocument } from '../businesses/schemas/business.schema';
import type { UserDocument } from '../users/schemas/user.schema';
import { InvoicesService } from './invoices.service';
import type { InvoiceDocument } from './schemas/invoice.schema';

/**
 * Sprint 4 §4.2 — guard для cabinet-ендпоінтів
 * `/businesses/me/:slug/invoices/:invoiceSlug`.
 *
 * **Контракт.** Стає у chain ПІСЛЯ `JwtActiveGuard` + `BusinessAccessGuard`.
 * Не робить повторного lookup-у бізнесу — читає `request.business` (already
 * attached `BusinessAccessGuard`-ом). Витягує `:invoiceSlug` з route-params,
 * лукапить через `InvoicesService.getBySlug(business._id, invoiceSlug)`,
 * attach-ить до `request.invoice`.
 *
 * **Жодних ownership-перевірок.** Owner-bit живе на business; якщо
 * `BusinessAccessGuard` пройшов, всі invoices під цим business автоматично
 * accessible. Cross-business access неможливий — invoice-slug compound-unique
 * `(businessId, slug)`, lookup за обома ключами.
 *
 * **Programmer-error pre-check.** Якщо `request.business` undefined —
 * `BusinessAccessGuard` не запущений у chain. Кидаємо `Error()`, не 401/404
 * (це **не** runtime-condition, а incorrect guard-stack у controller).
 *
 * **Case-sensitive lookup** (SP-8): на відміну від business-slug, invoice-slug
 * лукається exact-match (без `slugLower`-нормалізації). У 99% кейсів system-
 * generated; phantom value у case-insensitive lookup = 0.
 */
@Injectable()
export class InvoiceAccessGuard implements CanActivate {
    constructor(private readonly invoicesService: InvoicesService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context
            .switchToHttp()
            .getRequest<RequestWithInvoiceContext>();
        const account = request.account;
        if (!account) {
            throw new Error(
                'InvoiceAccessGuard requires AccountAccessGuard before it'
            );
        }

        const invoiceSlug = request.params?.invoiceSlug;
        if (typeof invoiceSlug !== 'string' || invoiceSlug.length === 0) {
            throw new NotFoundException({
                code: RESPONSE_CODE.INVOICE_NOT_FOUND,
                message: 'Invoice slug missing in route params',
            });
        }

        // Sprint 9 §SP-6 — lookup compound `(accountId, slug)`. Cross-account
        // access blocked structurally by compound-unique-index.
        const invoice = await this.invoicesService.getBySlug(
            account._id,
            invoiceSlug
        );
        if (!invoice) {
            throw new NotFoundException({
                code: RESPONSE_CODE.INVOICE_NOT_FOUND,
                message: 'Invoice not found',
            });
        }

        request.invoice = invoice;
        return true;
    }
}

/**
 * Param-decorator, що віддає resolved invoice з request-у. Призначений ТІЛЬКИ
 * для роутів під `InvoiceAccessGuard` — без guard-у `request.invoice` буде
 * undefined.
 */
export const CurrentInvoice = createParamDecorator(
    (_data: unknown, ctx: ExecutionContext) => {
        const request = ctx
            .switchToHttp()
            .getRequest<RequestWithInvoiceContext>();
        return request.invoice;
    }
);

interface RequestWithInvoiceContext extends Request {
    user?: UserDocument;
    business?: BusinessDocument;
    account?: AccountDocument;
    invoice?: InvoiceDocument;
}
