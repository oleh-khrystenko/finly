'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
    CreatePayerSchema,
    PERSONALIZATION_FULL_NAME_MAX,
    type CreatePayerDto,
} from '@finly/types';
import { z } from 'zod';
import UiButton from '@/shared/ui/UiButton';
import UiInput from '@/shared/ui/UiInput';
import { getZodFieldError } from '@/shared/lib';

type PayerFormValues = z.input<typeof CreatePayerSchema>;

/** Довжина РНОКПП — поле ріже нецифри, тож більше набрати неможливо. */
const TAX_ID_LENGTH = 10;

interface Props {
    /** Значення для редагування; порожньо — форма додавання. */
    initialValue?: CreatePayerDto;
    submitLabel: string;
    onSubmit: (values: CreatePayerDto) => Promise<void>;
    onCancel: () => void;
}

/**
 * Sprint 30 — форма одного платника. Спільна для додавання і редагування:
 * поля ті самі, а різниця лише у підписі кнопки і початкових значеннях.
 * Валідація — та сама схема, що на сервері й на публічній формі підстановки,
 * інакше збережений запис міг би не пройти генерацію QR.
 */
export default function PayerForm({
    initialValue,
    submitLabel,
    onSubmit,
    onCancel,
}: Props) {
    const form = useForm<PayerFormValues>({
        resolver: zodResolver(CreatePayerSchema),
        mode: 'onTouched',
        defaultValues: {
            fullName: initialValue?.fullName ?? '',
            taxId: initialValue?.taxId ?? '',
        },
    });

    const { errors, isSubmitting } = form.formState;

    return (
        <form
            onSubmit={form.handleSubmit(async (values) => {
                await onSubmit({
                    fullName: values.fullName.trim(),
                    taxId: values.taxId.trim(),
                });
            })}
            className="border-border bg-background space-y-4 rounded-lg border p-4"
        >
            <div>
                <label className="text-muted-foreground mb-1.5 block text-sm">
                    Прізвище, ім&apos;я, по батькові
                </label>
                <UiInput
                    {...form.register('fullName')}
                    type="text"
                    maxLength={PERSONALIZATION_FULL_NAME_MAX}
                    placeholder="Петренко Іван Іванович"
                    error={getZodFieldError(errors.fullName)}
                    size="lg"
                />
            </div>

            <div>
                <label className="text-muted-foreground mb-1.5 block text-sm">
                    РНОКПП (податковий номер)
                </label>
                <UiInput
                    {...form.register('taxId', {
                        onChange: (e) => {
                            e.target.value = e.target.value.replace(/\D/g, '');
                        },
                    })}
                    type="text"
                    inputMode="numeric"
                    maxLength={TAX_ID_LENGTH}
                    placeholder="10 цифр"
                    error={getZodFieldError(errors.taxId)}
                    size="lg"
                />
            </div>

            <div className="flex items-center gap-3">
                <UiButton
                    type="submit"
                    variant="filled"
                    size="md"
                    loading={isSubmitting}
                >
                    {submitLabel}
                </UiButton>
                <UiButton
                    type="button"
                    variant="text"
                    size="md"
                    onClick={onCancel}
                    disabled={isSubmitting}
                >
                    Скасувати
                </UiButton>
            </div>
        </form>
    );
}
