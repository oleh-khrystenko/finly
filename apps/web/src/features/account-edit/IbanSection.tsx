'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import type { Account } from '@finly/types';
import UiButton from '@/shared/ui/UiButton';
import UiSectionCard from '@/shared/ui/UiSectionCard';

interface Props {
    account: Account;
}

/**
 * Sprint 9 §9.2 + §SP-2 — секція "IBAN" на account-cabinet-page. Readonly
 * (IBAN immutable post-creation, §SP-2) + copy-кнопка.
 *
 * **Чому readonly без edit-кнопки**: помилка в IBAN неможливо виправити —
 * ФОП мусить видалити account (якщо немає інвойсів, §SP-3) і створити новий.
 * Той самий patern, що Sprint 4 invoice-slug + Sprint 7 business-type.
 */
export default function IbanSection({ account }: Props) {
    const [copied, setCopied] = useState(false);

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
        <UiSectionCard
            title="IBAN"
            headerRight={
                <UiButton
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleCopy()}
                    IconLeft={copied ? <Check /> : <Copy />}
                >
                    {copied ? 'Скопійовано' : 'Скопіювати'}
                </UiButton>
            }
        >
            <p className="text-foreground font-mono text-sm break-all">
                {account.iban}
            </p>
            <p className="text-muted-foreground mt-2 text-xs">
                IBAN не можна змінити після створення рахунку.
            </p>
        </UiSectionCard>
    );
}
