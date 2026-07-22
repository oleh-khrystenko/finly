'use client';

import type { ReactNode } from 'react';
import type { AutoSlugMode } from '@finly/types';
import UiRadioCardGroup from '@/shared/ui/UiRadioCardGroup';
import { INVOICE_FORMAT_META, type InvoiceFormatChoice } from './invoiceFormat';

interface Props {
    value: InvoiceFormatChoice;
    onChange: (next: InvoiceFormatChoice) => void;
    /** Набір видимих опцій: `CREATE_FORMAT_ORDER` (6) або `RESET_FORMAT_ORDER` (5). */
    options: readonly InvoiceFormatChoice[];
    /**
     * «Домашній формат» рахунку. Опція, що йому відповідає (або `simple` при
     * `null`), отримує бейдж «за замовчуванням» — читання пам'яті. Запис пам'яті
     * (галочка «запам'ятати») — поза цим компонентом, у формі створення.
     */
    defaultMode: AutoSlugMode | null;
    label?: string;
    error?: ReactNode;
}

/**
 * Sprint 17 §billing-design — спільний picker формату нумерації для форми
 * створення рахунку і діалогу перевипуску посилання. Privacy-warning для
 * `with-purpose` навмисно не тут: форма створення показує його модалкою, діалог
 * перевипуску — inline-текстом, тож презентація лишається за caller-ом.
 */
export default function InvoiceFormatPicker({
    value,
    onChange,
    options,
    defaultMode,
    label,
    error,
}: Props) {
    const effectiveDefault: InvoiceFormatChoice = defaultMode ?? 'simple';

    const cards = options.map((opt) => {
        const meta = INVOICE_FORMAT_META[opt];
        const isDefault = opt === effectiveDefault;
        return {
            value: opt,
            title: (
                <span className="flex flex-wrap items-center gap-2">
                    {meta.title}
                    {isDefault && (
                        <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-medium">
                            за замовчуванням
                        </span>
                    )}
                </span>
            ),
            description: `Приклад: ${meta.example}`,
        };
    });

    return (
        <UiRadioCardGroup<InvoiceFormatChoice>
            columns={{ mobile: 1 }}
            value={value}
            onChange={onChange}
            options={cards}
            label={label}
            error={error}
        />
    );
}
