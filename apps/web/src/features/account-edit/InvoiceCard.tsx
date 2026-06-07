import { type Invoice } from '@finly/types';
import UiNavCard from '@/shared/ui/UiNavCard';
import { composeClasses, formatKyivDate } from '@/shared/lib';
import {
    formatKopecksAsHryvnia,
    getInvoiceStatus,
    isInvoicePurposeRuntimeInherited,
    resolveInvoicePayeePurpose,
} from '@/entities/invoice';

interface Props {
    invoice: Invoice;
    businessSlug: string;
    accountSlug: string;
    /**
     * Template для legacy fallback (`payeeSnapshot === null && payment
     * Purpose === null`) — той самий runtime-resolution-path, що backend
     * `payload-mapper`. Передається з batch-fetch-у `Business`-документу на
     * parent-сторінці.
     */
    businessPaymentPurposeTemplate: string;
}

/**
 * Sprint 4 §4.4 + Sprint 9 §SP-5 — навігаційна картка рахунку у списку секції
 * "Рахунки" на account-cabinet-page. Єдина дія — "Відкрити" (`UiNavCard`):
 * копіювання посилання живе на власній сторінці рахунку, не на картці у списку.
 *
 * Cabinet-link — `/business/{biz}/account/{acc}/invoice/{inv}` (матрьошка §SP-5).
 */
export default function InvoiceCard({
    invoice,
    businessSlug,
    accountSlug,
    businessPaymentPurposeTemplate,
}: Props) {
    const formattedAmount = formatKopecksAsHryvnia(invoice.amount);
    const isExpired = getInvoiceStatus(invoice.validUntil) === 'expired';
    const purpose = resolveInvoicePayeePurpose(
        invoice.payeeSnapshot,
        invoice.paymentPurpose,
        businessPaymentPurposeTemplate
    );
    const isRuntimeInherited = isInvoicePurposeRuntimeInherited(
        invoice.payeeSnapshot,
        invoice.paymentPurpose
    );
    // Рядок терміну — лише коли термін заданий. Без терміну рахунок безстроковий,
    // рядка немає (і бейджа теж — статус завжди "активний", нема про що сигналити).
    const validUntilDate =
        invoice.validUntil !== null
            ? formatKyivDate(invoice.validUntil)
            : null;

    return (
        <UiNavCard
            href={`/business/${businessSlug}/account/${accountSlug}/invoice/${invoice.slug}`}
            surface="muted"
            ariaLabel={`Відкрити рахунок ${invoice.slug}`}
            title={<span className="font-mono">{invoice.slug}</span>}
            titleAttr={invoice.slug}
            badge={isExpired ? <ExpiredBadge /> : undefined}
            meta={
                <>
                    <p className="text-foreground font-medium">
                        {formattedAmount ?? 'Без суми (клієнт вводить)'}
                    </p>
                    <p
                        className={composeClasses(
                            'line-clamp-2',
                            isRuntimeInherited &&
                                'text-muted-foreground/70 italic'
                        )}
                        title={
                            isRuntimeInherited
                                ? 'Успадковано з налаштувань отримувача'
                                : undefined
                        }
                    >
                        {purpose}
                    </p>
                    {validUntilDate !== null && (
                        <p>
                            Дійсний до:{' '}
                            <span className="text-foreground">
                                {validUntilDate}
                            </span>
                        </p>
                    )}
                </>
            }
        />
    );
}

/**
 * Червоний попереджувальний бейдж — рендериться лише для прострочених рахунків
 * (термін минув). Активні бейджа не мають: "Активний" на кожній картці був би
 * шумом, що дублює рядок терміну.
 */
function ExpiredBadge() {
    return (
        <span className="bg-destructive/10 text-destructive shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium">
            Прострочено
        </span>
    );
}
