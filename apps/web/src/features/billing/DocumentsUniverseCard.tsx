'use client';

import { FileText } from 'lucide-react';
import {
    SUBSCRIPTION_STATUS,
    formatPrice,
    type BillingCatalog,
    type BillingProfileView,
} from '@finly/types';
import { pluralizeUa } from '@/shared/lib';

interface Props {
    catalog: BillingCatalog;
    profile: BillingProfileView | null;
}

/**
 * Sprint 27 — всесвіт «Документи»: збереження + AI-обробка + пошук, кредитна
 * модель. Механіка збудована на бекенді, але вітрина під прапором
 * (`catalog.documents.enabled`): поки вимкнено — прев'ю пакетів з бейджем
 * «Незабаром». Гілка активного стану (баланс кредитів) готова на майбутнє.
 */
export default function DocumentsUniverseCard({ catalog, profile }: Props) {
    const docs = catalog.documents;
    const credits = profile?.documents.credits;
    // Живий доступ = ACTIVE або PAST_DUE (як у BrandUniverseCard): профіль з
    // покинутим checkout-ом (INCOMPLETE) чи згаслий (CANCELED/UNPAID) тримає
    // бажаний/старий tierSize у БД, але нічого не оплачено — показуємо вітрину
    // пакетів, а не баланс кредитів.
    const entitled =
        profile != null &&
        (profile.status === SUBSCRIPTION_STATUS.ACTIVE ||
            profile.status === SUBSCRIPTION_STATUS.PAST_DUE);
    const active = entitled && profile.documents.tierSize != null;
    const muted = !docs.enabled;

    return (
        <section
            className={`bg-card rounded-xl border p-6 md:p-8 ${muted ? 'opacity-90' : ''}`}
        >
            <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                    <span className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-lg">
                        <FileText className="size-5" />
                    </span>
                    <div>
                        <h2 className="text-foreground text-xl font-semibold tracking-tight">
                            Документи
                        </h2>
                        <p className="text-muted-foreground text-sm">
                            Зберігання, AI-теги і пошук по документах
                        </p>
                    </div>
                </div>
                {!docs.enabled && (
                    <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-3 py-1 text-xs font-medium">
                        Незабаром
                    </span>
                )}
            </div>

            {active && credits ? (
                <div className="mt-6 grid grid-cols-2 gap-4">
                    <div className="border-border rounded-lg border p-4">
                        <p className="text-muted-foreground text-xs">
                            Баланс кредитів
                        </p>
                        <p className="text-foreground mt-1 text-2xl font-semibold">
                            {credits.balance}
                        </p>
                    </div>
                    <div className="border-border rounded-lg border p-4">
                        <p className="text-muted-foreground text-xs">
                            Сховище
                        </p>
                        <p className="text-foreground mt-1 text-2xl font-semibold">
                            {Math.round(credits.storageBytesUsed / 1e9)} ГБ
                        </p>
                    </div>
                </div>
            ) : (
                <ul className="mt-6 space-y-2">
                    {docs.tiers.map((tier) => (
                        <li
                            key={tier.size}
                            className="border-border flex items-center justify-between gap-3 rounded-lg border p-4"
                        >
                            <div>
                                <p className="text-foreground text-sm font-medium">
                                    {pluralizeUa(
                                        tier.size,
                                        'отримувач',
                                        'отримувачі',
                                        'отримувачів'
                                    )}
                                </p>
                                <p className="text-muted-foreground text-xs">
                                    {tier.monthlyCredits} кредитів/міс ·{' '}
                                    {tier.storageGb} ГБ
                                </p>
                            </div>
                            <span className="text-foreground text-sm font-semibold">
                                {formatPrice(tier.priceAmount, catalog.currency)}
                                <span className="text-muted-foreground text-xs font-normal">
                                    {' '}
                                    /міс
                                </span>
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
