'use client';

import type { Invoice, UpdateInvoiceRequest } from '@finly/types';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import { getInvoiceStatus } from '@/entities/invoice';
import AmountSection, { AmountLockSwitch } from './AmountSection';
import PurposeSection from './PurposeSection';
import ValidUntilSection from './ValidUntilSection';

interface Props {
    invoice: Invoice;
    /** Resolved шаблон рівня рахунку — див. `PurposeSection`. */
    inheritedPaymentPurposeTemplate: string;
    onSave: (patch: UpdateInvoiceRequest) => Promise<void>;
}

/**
 * Одна merged-картка «Дані платежу» замість окремих карток (Сума / блокування /
 * Призначення / Термін дії) — усі поля задають дані одного платежу і йдуть у
 * платіжне посилання. Назва в одному ряду з business/account-картками («Дані
 * одержувача», «Банківські дані»). Дзеркало business `RequisitesCard`:
 * розділювачі `divide-border` між рядками тримають візуальну ієрархію без
 * вкладених карток.
 *
 * Тогл блокування суми — окремий рядок одразу під «Сумою» (дзеркало SEO-тоглу
 * на business-сторінці), а не вкладена рамка у money-полі.
 *
 * Badge "Прострочено" живе у хедері картки (раніше — у власному хедері секції
 * "Термін дії"), щоб статус читався на рівні всього блоку параметрів.
 */
export default function PaymentDetailsCard({
    invoice,
    inheritedPaymentPurposeTemplate,
    onSave,
}: Props) {
    const isExpired = getInvoiceStatus(invoice.validUntil) === 'expired';

    return (
        <UiSectionCard
            title="Дані платежу"
            headerRight={
                isExpired ? (
                    <span className="bg-destructive/10 text-destructive shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium">
                        Прострочено
                    </span>
                ) : undefined
            }
        >
            <div className="divide-border mt-4 divide-y">
                <div className="pb-6">
                    <AmountSection invoice={invoice} onSave={onSave} />
                </div>
                <div className="py-6">
                    <AmountLockSwitch invoice={invoice} onSave={onSave} />
                </div>
                <div className="py-6">
                    <PurposeSection
                        invoice={invoice}
                        inheritedPaymentPurposeTemplate={
                            inheritedPaymentPurposeTemplate
                        }
                        onSave={onSave}
                    />
                </div>
                <div className="pt-6">
                    <ValidUntilSection invoice={invoice} onSave={onSave} />
                </div>
            </div>
        </UiSectionCard>
    );
}
