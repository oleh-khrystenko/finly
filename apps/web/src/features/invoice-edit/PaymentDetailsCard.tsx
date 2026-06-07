'use client';

import type { Business, Invoice, UpdateInvoiceRequest } from '@finly/types';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import { getInvoiceStatus } from '@/entities/invoice';
import AmountSection from './AmountSection';
import PurposeSection from './PurposeSection';
import ValidUntilSection from './ValidUntilSection';

interface Props {
    invoice: Invoice;
    business: Business;
    onSave: (patch: UpdateInvoiceRequest) => Promise<void>;
}

/**
 * Одна merged-картка «Параметри платежу» замість трьох окремих
 * (Сума і блокування / Призначення / Термін дії) — усі поля задають параметри
 * одного платежу і йдуть у платіжне посилання. Дзеркало business
 * `RequisitesCard`: розділювачі `divide-border` між рядками тримають візуальну
 * ієрархію без вкладених карток.
 *
 * Badge "Прострочено" живе у хедері картки (раніше — у власному хедері секції
 * "Термін дії"), щоб статус читався на рівні всього блоку параметрів.
 */
export default function PaymentDetailsCard({
    invoice,
    business,
    onSave,
}: Props) {
    const isExpired = getInvoiceStatus(invoice.validUntil) === 'expired';

    return (
        <UiSectionCard
            title="Параметри платежу"
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
                    <PurposeSection
                        invoice={invoice}
                        business={business}
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
