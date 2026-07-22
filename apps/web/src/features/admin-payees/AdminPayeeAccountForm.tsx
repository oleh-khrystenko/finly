'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
    BANK_LABEL,
    UpdateSystemPayeeAccountSchema,
    type Account,
    type Business,
} from '@finly/types';

import { formatPayeeName } from '@/entities/business';
import {
    adminUpdatePayeeAccount,
    extractApiErrorCode,
    getApiMessage,
} from '@/shared/api';
import UiBreadcrumb from '@/shared/ui/UiBreadcrumb';
import UiButton from '@/shared/ui/UiButton';
import UiInput from '@/shared/ui/UiInput';
import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiSectionCard from '@/shared/ui/UiSectionCard';

import { collectFieldErrors, type FieldErrors } from './fieldErrors';
import { PurposeTemplateField } from './PurposeTemplateField';

interface Props {
    payee: Business;
    account: Account;
}

/**
 * Sprint 29 — редагування реквізитів системного отримувача
 * (`/admin/payees/[slug]/accounts/[accountSlug]/edit`).
 *
 * Три поля, кожне з власною причиною існувати:
 *  - **назва** — підпис рядка у каталозі («ЄСВ», «Військовий збір»);
 *  - **slug** — красиве посилання на публічну сторінку. Кабінетний шлях сюди
 *    недосяжний (гейт власності), а каталог пускає лише красиві посилання, тож
 *    без цього поля системний запис лишався б з автогенерованим хвостом;
 *  - **призначення** — per-рахунок, бо одне ГУ ДПС тримає реквізити під ЄСВ і
 *    під військовий збір з різними текстами. Порожнє поле = успадкувати шаблон
 *    отримувача (те саме `null`, що на бекенді).
 *
 * IBAN незмінний після створення (інваріант моделі), тому показується як текст.
 * Структура форми дзеркалить `AdminPayeeForm`: ті самі Ui-примітиви, спільний
 * `PurposeTemplateField` і спільна мапа повідомлень.
 */
export function AdminPayeeAccountForm({ payee, account }: Props) {
    const router = useRouter();

    const [name, setName] = useState(account.name ?? '');
    const [slug, setSlug] = useState(account.slug);
    const [purpose, setPurpose] = useState(
        account.paymentPurposeTemplate ?? ''
    );
    const [errors, setErrors] = useState<FieldErrors>({});
    const [submitting, setSubmitting] = useState(false);

    const detailHref = `/admin/payees/${payee.slug}`;
    const bankLabel =
        account.bankCode !== null ? BANK_LABEL[account.bankCode] : null;
    const trimmedPurpose = purpose.trim();
    const trimmedName = name.trim();

    const submit = async () => {
        const parsed = UpdateSystemPayeeAccountSchema.safeParse({
            // Порожнє поле знімає назву: рядок каталогу повертається до
            // авто-підпису за банком і хвостом IBAN, а не лишається з текстом,
            // який адмін щойно стер.
            name: trimmedName === '' ? null : trimmedName,
            slug: slug.trim(),
            // Порожній шаблон означає «успадкувати від отримувача», а не
            // «порожнє призначення»: саме це на бекенді виражає `null`.
            paymentPurposeTemplate:
                trimmedPurpose === '' ? null : trimmedPurpose,
        });
        if (!parsed.success) {
            setErrors(collectFieldErrors(parsed.error.issues));
            return;
        }
        setErrors({});
        setSubmitting(true);
        try {
            await adminUpdatePayeeAccount(
                payee.slug,
                account.slug,
                parsed.data
            );
            toast.success('Реквізити оновлено');
            router.push(detailHref);
        } catch (err) {
            toast.error(getApiMessage(extractApiErrorCode(err), 'accounts'));
            setSubmitting(false);
        }
    };

    return (
        <UiPageContainer className="space-y-6 py-10 md:py-14">
            <UiBreadcrumb
                items={[
                    { label: 'Системні отримувачі', href: '/admin/payees' },
                    {
                        label: formatPayeeName(payee.type, payee.name),
                        href: detailHref,
                    },
                    { label: 'Реквізити' },
                ]}
            />
            <h1 className="text-foreground text-2xl font-semibold tracking-tight md:text-3xl">
                Редагування реквізитів
            </h1>

            <UiSectionCard title="Основне">
                <div className="mt-4 space-y-4">
                    <div>
                        <p className="text-muted-foreground text-sm font-medium">
                            IBAN
                        </p>
                        <p className="text-foreground mt-1 font-mono text-sm break-all">
                            {account.iban}
                        </p>
                        {bankLabel && (
                            <p className="text-muted-foreground mt-1 text-sm">
                                {bankLabel}
                            </p>
                        )}
                    </div>
                    <UiInput
                        label="Назва реквізитів (необовʼязково)"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        error={errors.name}
                        placeholder="ЄСВ"
                    />
                    <UiInput
                        label="Посилання (slug)"
                        value={slug}
                        onChange={(e) => setSlug(e.target.value)}
                        error={errors.slug}
                        placeholder="esv"
                    />
                </div>
            </UiSectionCard>

            <UiSectionCard title="Призначення платежу">
                <p className="text-muted-foreground mt-2 text-sm">
                    Порожнє поле означає, що реквізити беруть шаблон отримувача.
                    Власний текст потрібен, коли реквізити під різні платежі:
                    ЄСВ і військовий збір розносить саме призначення. Маркери
                    підставить платник на публічній сторінці.
                </p>
                <PurposeTemplateField
                    label="Шаблон призначення (необовʼязково)"
                    value={purpose}
                    onChange={setPurpose}
                    error={errors.paymentPurposeTemplate}
                    placeholder="Єдиний внесок {taxId} за {period}"
                />
            </UiSectionCard>

            <div className="flex justify-end gap-3">
                <UiButton as="link" href={detailHref} variant="text" size="md">
                    Скасувати
                </UiButton>
                <UiButton
                    type="button"
                    variant="filled"
                    size="md"
                    loading={submitting}
                    onClick={() => void submit()}
                >
                    Зберегти зміни
                </UiButton>
            </div>
        </UiPageContainer>
    );
}
