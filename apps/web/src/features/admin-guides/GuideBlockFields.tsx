'use client';

import { type UseFormReturn } from 'react-hook-form';
import { ChevronUp, ChevronDown, Trash2 } from 'lucide-react';

import UiButton from '@/shared/ui/UiButton';
import UiInput from '@/shared/ui/UiInput';
import UiTextarea from '@/shared/ui/UiTextarea';
import { getZodFieldError } from '@/shared/lib';

import { FieldHint } from './FieldHint';
import { GuideImageField } from './GuideImageField';
import type { EditorFormValues } from './editorSchema';

interface GuideBlockFieldsProps {
    form: UseFormReturn<EditorFormValues>;
    index: number;
    total: number;
    /** True while any block image upload is in flight — reorder/remove would
     * shift indices under a closure-bound upload, so those actions are locked. */
    locked: boolean;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onRemove: () => void;
    onUploadingChange: (uploading: boolean) => void;
}

export function GuideBlockFields({
    form,
    index,
    total,
    locked,
    onMoveUp,
    onMoveDown,
    onRemove,
    onUploadingChange,
}: GuideBlockFieldsProps) {
    const { register, watch, setValue, formState } = form;
    const blockErrors = formState.errors.blocks?.[index];
    const image = watch(`blocks.${index}.image`);

    return (
        <div className="border-border bg-card rounded-xl border p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
                    Блок {index + 1}
                </span>
                <div className="flex items-center gap-1">
                    <UiButton
                        type="button"
                        variant="icon"
                        size="sm"
                        aria-label="Підняти блок"
                        disabled={index === 0 || locked}
                        onClick={onMoveUp}
                    >
                        <ChevronUp className="size-4" />
                    </UiButton>
                    <UiButton
                        type="button"
                        variant="icon"
                        size="sm"
                        aria-label="Опустити блок"
                        disabled={index === total - 1 || locked}
                        onClick={onMoveDown}
                    >
                        <ChevronDown className="size-4" />
                    </UiButton>
                    <UiButton
                        type="button"
                        variant="icon"
                        size="sm"
                        aria-label="Видалити блок"
                        disabled={total === 1 || locked}
                        onClick={onRemove}
                    >
                        <Trash2 className="size-4" />
                    </UiButton>
                </div>
            </div>

            <div className="mt-4 space-y-4">
                <div>
                    <UiInput
                        {...register(`blocks.${index}.heading`)}
                        placeholder="Заголовок розділу (необовʼязково)"
                        label="Заголовок"
                        error={getZodFieldError(blockErrors?.heading)}
                        size="md"
                    />
                    <FieldHint>
                        <p>
                            Маленький заголовок для цього шматка статті (не
                            плутайте з назвою всієї статті, що вгорі). Наприклад:
                            «Які реквізити знадобляться». Можна лишити порожнім,
                            якщо цей блок іде без заголовка.
                        </p>
                    </FieldHint>
                </div>

                <div>
                    <UiTextarea
                        {...register(`blocks.${index}.text`)}
                        placeholder="Текст блоку. Пишіть звичайними словами."
                        label="Текст"
                        error={getZodFieldError(blockErrors?.text)}
                        autoGrow
                        maxRows={16}
                        rows={4}
                    />
                    <FieldHint>
                        <p>
                            Головний текст цього шматка статті. Пишіть звичайними
                            словами, так, як пояснили б знайомому за столом.
                        </p>
                        <p>
                            Кілька простих прийомів, якщо захочете щось
                            оформити:
                        </p>
                        <ul>
                            <li>
                                Щоб зробити слово <strong>жирним</strong>,
                                обгорніть його двома зірочками з кожного боку:{' '}
                                <code>**важливо**</code>.
                            </li>
                            <li>
                                Щоб зробити перелік, починайте кожен рядок з
                                риски і пробілу.
                            </li>
                            <li>
                                Щоб вставити посилання (клікабельне слово, що веде
                                на іншу сторінку), напишіть так:{' '}
                                <code>[слово](адреса)</code>. У квадратних дужках
                                те слово, яке побачить читач, у круглих, адреса,
                                куди воно веде.
                            </li>
                        </ul>
                        <p>Про посилання окремо, бо це важливо і корисно:</p>
                        <ul>
                            <li>
                                Щоб відправити читача на іншу вашу статтю, адреса
                                це <code>/guides/</code> плюс кінець адреси тієї
                                статті. Наприклад:{' '}
                                <code>
                                    [як виставити рахунок](/guides/yak-vystavyty-rakhunok-kliientu)
                                </code>
                                .
                            </li>
                            <li>
                                Щоб відправити на головну сторінку Finly, вкажіть
                                адресу сайту:{' '}
                                <code>
                                    [створити QR-код](https://finly.com.ua)
                                </code>
                                .
                            </li>
                        </ul>
                        <p>
                            Такі посилання між статтями корисні подвійно:
                            читачеві легко перейти до потрібного далі, а пошук у
                            Google краще розуміє, про що ваш сайт, і охочіше
                            показує його людям.
                        </p>
                    </FieldHint>
                </div>

                <GuideImageField
                    value={image}
                    onChange={(next) =>
                        setValue(`blocks.${index}.image`, next, {
                            shouldDirty: true,
                            shouldValidate: true,
                        })
                    }
                    onUploadingChange={onUploadingChange}
                    altError={getZodFieldError(blockErrors?.image?.alt)}
                    captionError={getZodFieldError(blockErrors?.image?.caption)}
                />
            </div>
        </div>
    );
}
