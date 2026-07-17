'use client';

import { type UseFormReturn, useFieldArray } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';

import UiButton from '@/shared/ui/UiButton';
import UiInput from '@/shared/ui/UiInput';
import UiTextarea from '@/shared/ui/UiTextarea';
import { getZodFieldError } from '@/shared/lib';

import { FieldHint } from './FieldHint';
import type { EditorFormValues } from './editorSchema';

export function GuideFaqFields({
    form,
}: {
    form: UseFormReturn<EditorFormValues>;
}) {
    const { register, control, formState } = form;
    const { fields, append, remove } = useFieldArray({
        control,
        name: 'faq',
    });

    return (
        <section>
            <div>
                <div className="flex items-center justify-between gap-3">
                    <h2 className="text-foreground text-lg font-semibold tracking-tight">
                        Часті запитання
                    </h2>
                    <UiButton
                        type="button"
                        variant="outline"
                        size="sm"
                        IconLeft={<Plus className="size-4" />}
                        onClick={() => append({ question: '', answer: '' })}
                    >
                        Додати
                    </UiButton>
                </div>
                <FieldHint>
                    <p>
                        Необовʼязковий розділ. Тут можна додати короткі питання,
                        які часто ставлять люди, і відповіді на них. Вони
                        зʼявляться в самому кінці статті.
                    </p>
                    <p>
                        Це корисно: іноді Google показує таке питання і відповідь
                        прямо у результатах пошуку, і людина бачить вашу
                        відповідь ще до заходу на сайт.
                    </p>
                </FieldHint>
            </div>

            {fields.length > 0 && (
                <div className="mt-4 space-y-3">
                    {fields.map((field, index) => {
                        const faqErrors = formState.errors.faq?.[index];
                        return (
                            <div
                                key={field.id}
                                className="border-border bg-card rounded-xl border p-4"
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
                                        Питання {index + 1}
                                    </span>
                                    <UiButton
                                        type="button"
                                        variant="icon"
                                        size="sm"
                                        aria-label="Видалити питання"
                                        onClick={() => remove(index)}
                                    >
                                        <Trash2 className="size-4" />
                                    </UiButton>
                                </div>
                                <div className="mt-3 space-y-3">
                                    <UiInput
                                        {...register(`faq.${index}.question`)}
                                        placeholder="Запитання"
                                        error={getZodFieldError(
                                            faqErrors?.question
                                        )}
                                        size="md"
                                    />
                                    <UiTextarea
                                        {...register(`faq.${index}.answer`)}
                                        placeholder="Відповідь"
                                        error={getZodFieldError(
                                            faqErrors?.answer
                                        )}
                                        autoGrow
                                        rows={2}
                                    />
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
}
