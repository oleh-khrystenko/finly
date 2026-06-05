'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { BANK_LABEL, type Account } from '@finly/types';
import UiButton from '@/shared/ui/UiButton';
import UiSectionCard from '@/shared/ui/UiSectionCard';

interface Props {
    account: Account;
}

/**
 * Sprint 15 — об'єднана секція "Реквізити" на account-cabinet-page. Замінює
 * окремі "Основне" (банк-label) + "IBAN" — обидві були readonly-реквізитами
 * незмінної платіжної ідентичності рахунку, тож живуть в одній картці.
 *
 * **Layout:** definition-list (`dl/dt/dd`) — семантична пара key→value. Банк
 * зверху, IBAN знизу з inline copy-кнопкою (у хедері "Реквізити" copy була б
 * двозначною). Розділювач між полями.
 *
 * **Null-bankCode (§SP-9):** поле "Банк" не рендериться (bank-mask `•{last4}`
 * лишається в `EditableAccountName`), але картка з IBAN рендериться завжди —
 * IBAN immutable та обов'язковий.
 *
 * **IBAN readonly без edit (§SP-2):** помилку в IBAN не виправити — рахунок
 * треба видалити (якщо немає інвойсів, §SP-3) і створити новий.
 */
export default function RequisitesSection({ account }: Props) {
    const [copied, setCopied] = useState(false);

    const bankLabel =
        account.bankCode !== null ? BANK_LABEL[account.bankCode] : null;

    const handleCopy = async (): Promise<void> => {
        try {
            await navigator.clipboard.writeText(account.iban);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            toast.error('Не вдалося скопіювати');
        }
    };

    return (
        <UiSectionCard title="Реквізити">
            <dl className="mt-6 space-y-5">
                {bankLabel && (
                    <div>
                        <dt className="text-muted-foreground text-base font-medium">
                            Банк
                        </dt>
                        <dd className="text-foreground mt-1 text-lg">
                            {bankLabel}
                        </dd>
                    </div>
                )}

                <div className={bankLabel ? 'border-border border-t pt-5' : ''}>
                    <dt className="text-muted-foreground text-base font-medium">
                        IBAN
                    </dt>
                    <dd className="mt-1.5 flex items-center justify-between gap-3">
                        <span className="text-foreground font-mono text-lg break-all">
                            {account.iban}
                        </span>
                        <UiButton
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void handleCopy()}
                            IconLeft={copied ? <Check /> : <Copy />}
                            className="shrink-0"
                        >
                            {copied ? 'Скопійовано' : 'Скопіювати'}
                        </UiButton>
                    </dd>
                </div>
            </dl>

            <p className="text-muted-foreground mt-4 text-sm">
                IBAN не можна змінити після створення рахунку.
            </p>
        </UiSectionCard>
    );
}
