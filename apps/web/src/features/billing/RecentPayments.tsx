'use client';

import { useEffect, useState } from 'react';
import {
    PAYMENT_RECORD_STATUS,
    PAYMENT_RECORD_TYPE,
    formatPrice,
    type PaymentRecord,
} from '@finly/types';
import { listPayments } from '@/shared/api/payments';
import { formatLocalDate } from '@/shared/lib';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSpinner from '@/shared/ui/UiSpinner';

const TYPE_LABELS: Record<PaymentRecord['type'], string> = {
    [PAYMENT_RECORD_TYPE.SUBSCRIPTION]: 'Підписка',
    [PAYMENT_RECORD_TYPE.ONE_OFF]: 'Доступ на місяць',
    [PAYMENT_RECORD_TYPE.UNMATCHED]: 'Нерозпізнане списання',
};

const STATUS_LABELS: Record<PaymentRecord['status'], string> = {
    [PAYMENT_RECORD_STATUS.APPROVED]: 'Сплачено',
    [PAYMENT_RECORD_STATUS.DECLINED]: 'Відхилено',
    [PAYMENT_RECORD_STATUS.REFUNDED]: 'Повернуто',
    [PAYMENT_RECORD_STATUS.PENDING]: 'Очікує',
};

const STATUS_CLASSES: Record<PaymentRecord['status'], string> = {
    [PAYMENT_RECORD_STATUS.APPROVED]: 'bg-success/15 text-success',
    [PAYMENT_RECORD_STATUS.DECLINED]: 'bg-destructive/15 text-destructive',
    [PAYMENT_RECORD_STATUS.REFUNDED]: 'bg-warning/15 text-warning',
    [PAYMENT_RECORD_STATUS.PENDING]: 'bg-muted text-muted-foreground',
};

/** `reloadKey` змінюється при зміні стану підписки → список перезавантажується. */
export default function RecentPayments({ reloadKey }: { reloadKey: string }) {
    const [payments, setPayments] = useState<PaymentRecord[] | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let active = true;
        listPayments(10)
            .then((items) => {
                if (active) {
                    setPayments(items);
                    setFailed(false);
                }
            })
            .catch(() => {
                if (active) {
                    setPayments([]);
                    setFailed(true);
                }
            });
        return () => {
            active = false;
        };
    }, [reloadKey]);

    if (payments === null) {
        return (
            <UiSectionCard title="Останні списання">
                <div className="flex justify-center py-8">
                    <UiSpinner size="sm" />
                </div>
            </UiSectionCard>
        );
    }

    if (failed) {
        return (
            <UiSectionCard title="Останні списання">
                <p className="text-muted-foreground mt-3 text-sm">
                    Не вдалося завантажити списання. Спробуйте пізніше
                </p>
            </UiSectionCard>
        );
    }

    if (payments.length === 0) {
        return (
            <UiSectionCard title="Останні списання">
                <p className="text-muted-foreground mt-3 text-sm">
                    Списань ще не було
                </p>
            </UiSectionCard>
        );
    }

    return (
        <UiSectionCard title="Останні списання">
            <ul className="divide-border mt-3 divide-y">
                {payments.map((p) => (
                    <li
                        key={p.id}
                        className="flex items-center justify-between gap-4 py-3"
                    >
                        <div className="min-w-0">
                            <p className="text-foreground text-sm font-medium">
                                {TYPE_LABELS[p.type]}
                            </p>
                            <p className="text-muted-foreground text-sm">
                                {formatLocalDate(p.createdAt)}
                            </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                            <span className="text-foreground text-sm font-semibold">
                                {formatPrice(p.amount, p.currency)}
                            </span>
                            <span
                                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASSES[p.status]}`}
                            >
                                {STATUS_LABELS[p.status]}
                            </span>
                        </div>
                    </li>
                ))}
            </ul>
        </UiSectionCard>
    );
}
