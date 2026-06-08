'use client';

import type { Business, UpdateBusinessRequest } from '@finly/types';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import RequisitesSection from './RequisitesSection';
import TaxationSection, { hasTaxationFields } from './TaxationSection';
import PurposeSection from './PurposeSection';

interface Props {
    business: Business;
    onSave: (patch: UpdateBusinessRequest) => Promise<void>;
}

/**
 * Sprint 13: одна merged-картка «Реквізити» замість трьох окремих
 * (Реквізити / Оподаткування / Призначення) — усі поля стосуються даних, що
 * йдуть у платіжне посилання. Розділювачі `divide-border` між рядками тримають
 * візуальну ієрархію без зайвих контейнерів.
 *
 * Оподаткування — conditional rendering через `hasTaxationFields` type-guard:
 * для individual / organization taxation-поля null і блок не показується.
 */
export default function RequisitesCard({ business, onSave }: Props) {
    return (
        <UiSectionCard title="Дані отримувача">
            <div className="divide-border mt-4 divide-y">
                <div className="pb-6">
                    <RequisitesSection business={business} onSave={onSave} />
                </div>
                {hasTaxationFields(business) && (
                    <div className="py-6">
                        <TaxationSection
                            business={business}
                            onSave={onSave}
                        />
                    </div>
                )}
                <div className="pt-6">
                    <PurposeSection business={business} onSave={onSave} />
                </div>
            </div>
        </UiSectionCard>
    );
}
