'use client';

import { useEffect, useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, Eye, Plus } from 'lucide-react';
import {
    getAllAuthors,
    type Guide,
    type UpsertGuideRequest,
} from '@finly/types';

import UiButton from '@/shared/ui/UiButton';
import UiInput from '@/shared/ui/UiInput';
import UiSelect from '@/shared/ui/UiSelect';
import UiSpinner from '@/shared/ui/UiSpinner';
import { getZodFieldError } from '@/shared/lib';
import {
    adminGetGuide,
    adminListGuides,
    createGuide,
    extractApiErrorCode,
    getApiMessage,
    startDraftGuide,
    publishGuide,
    unpublishGuide,
    updateGuide,
} from '@/shared/api';

import { FieldHint } from './FieldHint';
import { GuideBlockFields } from './GuideBlockFields';
import { GuideFaqFields } from './GuideFaqFields';
import { GuideStatusBadge } from './GuideStatusBadge';
import { EditorFormSchema, type EditorFormValues } from './editorSchema';
import { useDeleteGuideDialogStore } from './deleteGuideDialogStore';

const AUTHOR_OPTIONS = getAllAuthors().map((a) => ({
    label: a.name,
    value: a.id,
}));

interface PillarOption {
    label: string;
    value: string;
}

function guideToForm(guide: Guide): EditorFormValues {
    return {
        slug: guide.slug,
        title: guide.title,
        description: guide.description,
        authorId: guide.authorId,
        pillarSlug: guide.pillarSlug ?? '',
        blocks: guide.blocks.map((b) => ({
            heading: b.heading ?? '',
            text: b.text,
            image: b.image,
        })),
        faq: guide.faq.map((f) => ({
            question: f.question,
            answer: f.answer,
        })),
    };
}

function formToPayload(values: EditorFormValues): UpsertGuideRequest {
    return {
        slug: values.slug,
        title: values.title.trim(),
        description: values.description.trim(),
        authorId: values.authorId,
        pillarSlug: values.pillarSlug === '' ? null : values.pillarSlug,
        blocks: values.blocks.map((b) => {
            const heading = b.heading.trim();
            const caption = b.image?.caption?.trim();
            return {
                ...(heading ? { heading } : {}),
                text: b.text.trim(),
                ...(b.image
                    ? {
                          image: {
                              src: b.image.src,
                              alt: b.image.alt.trim(),
                              width: b.image.width,
                              height: b.image.height,
                              ...(caption ? { caption } : {}),
                          },
                      }
                    : {}),
            };
        }),
        faq: values.faq.map((f) => ({
            question: f.question.trim(),
            answer: f.answer.trim(),
        })),
    };
}

const EMPTY_DEFAULTS: EditorFormValues = {
    slug: '',
    title: '',
    description: '',
    authorId: AUTHOR_OPTIONS[0]?.value ?? '',
    pillarSlug: '',
    // Порожньо: нова стаття це запланована тема, контент додається пізніше.
    blocks: [],
    faq: [],
};

interface GuideEditorProps {
    mode: 'create' | 'edit';
    guideId?: string;
}

export function GuideEditor({ mode, guideId }: GuideEditorProps) {
    const router = useRouter();
    const openDeleteDialog = useDeleteGuideDialogStore((s) => s.open);

    const [guide, setGuide] = useState<Guide | null>(null);
    const [pillarOptions, setPillarOptions] = useState<PillarOption[]>([]);
    const [loadError, setLoadError] = useState(false);
    const [actionPending, setActionPending] = useState(false);
    // Reorder/remove shift block indices, but an in-flight image upload holds a
    // closure-bound index. Lock those actions while any upload is running.
    const [activeUploads, setActiveUploads] = useState(0);
    const blocksLocked = activeUploads > 0;
    const handleBlockUploading = (uploading: boolean) => {
        setActiveUploads((n) => Math.max(0, n + (uploading ? 1 : -1)));
    };

    const form = useForm<EditorFormValues>({
        resolver: zodResolver(EditorFormSchema),
        mode: 'onTouched',
        defaultValues: EMPTY_DEFAULTS,
    });
    const { fields, append, remove, move } = useFieldArray({
        control: form.control,
        name: 'blocks',
    });

    // Load the guide (edit) and the pillar options once.
    useEffect(() => {
        let active = true;

        adminListGuides()
            .then((items) => {
                if (!active) return;
                setPillarOptions(
                    items
                        .filter(
                            (i) =>
                                i.pillarSlug === null && i.id !== guideId
                        )
                        .map((i) => ({ label: i.title, value: i.slug }))
                );
            })
            .catch((err) => {
                // Pillar options are optional (create-as-pillar still works),
                // but log so an auth/network failure is diagnosable instead of
                // vanishing silently — matches loadGuides degradation logging.
                console.error(
                    'admin-guides: failed to load pillar options',
                    err
                );
            });

        if (mode === 'edit' && guideId) {
            adminGetGuide(guideId)
                .then((loaded) => {
                    if (!active) return;
                    setGuide(loaded);
                    form.reset(guideToForm(loaded));
                })
                .catch(() => {
                    if (active) setLoadError(true);
                });
        }

        return () => {
            active = false;
        };
    }, [mode, guideId, form]);

    const isPlanned = guide?.status === 'planned';
    const isDraft = guide?.status === 'draft';
    const isPublished = guide?.status === 'published';
    const isSlugLocked = Boolean(guide && guide.datePublished !== null);
    const hasContent = Boolean(
        guide?.blocks.some((b) => b.text.trim() !== '')
    );

    const onSubmit = async (values: EditorFormValues) => {
        const payload = formToPayload(values);
        try {
            if (mode === 'create') {
                const created = await createGuide(payload);
                toast.success('Тему створено');
                router.push(`/admin/guides/${created.id}`);
            } else if (guideId) {
                const updated = await updateGuide(guideId, payload);
                setGuide(updated);
                form.reset(guideToForm(updated));
                toast.success('Зміни збережено');
            }
        } catch (err) {
            toast.error(getApiMessage(extractApiErrorCode(err), 'guides'));
        }
    };

    const runAction = async (
        action: () => Promise<Guide>,
        successMessage: string
    ) => {
        setActionPending(true);
        try {
            const updated = await action();
            setGuide(updated);
            form.reset(guideToForm(updated));
            toast.success(successMessage);
        } catch (err) {
            toast.error(getApiMessage(extractApiErrorCode(err), 'guides'));
        } finally {
            setActionPending(false);
        }
    };

    if (loadError) {
        return (
            <main className="mx-auto max-w-3xl px-4 py-14 text-center sm:px-6">
                <p className="text-muted-foreground text-sm">
                    Не вдалося завантажити гайд. Перевірте посилання.
                </p>
                <UiButton
                    as="link"
                    href="/admin/guides"
                    variant="text"
                    size="sm"
                    className="mt-4"
                    IconLeft={<ArrowLeft className="size-4" />}
                >
                    До списку
                </UiButton>
            </main>
        );
    }

    if (mode === 'edit' && !guide) {
        return (
            <div className="flex justify-center py-24">
                <UiSpinner size="lg" />
            </div>
        );
    }

    const { errors, isSubmitting, isDirty } = form.formState;

    return (
        <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 md:py-14 lg:px-8">
            <UiButton
                as="link"
                href="/admin/guides"
                variant="text"
                size="sm"
                IconLeft={<ArrowLeft className="size-4" />}
            >
                До списку
            </UiButton>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-foreground text-2xl font-semibold tracking-tight md:text-3xl">
                    {mode === 'create' ? 'Новий гайд' : 'Редагування гайда'}
                </h1>
                {guide && <GuideStatusBadge status={guide.status} />}
            </div>

            <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="mt-8 space-y-8"
            >
                <section className="space-y-6">
                    <div>
                        <UiInput
                            {...form.register('title')}
                            label="Назва"
                            placeholder="Як ФОП приймати оплату від клієнтів"
                            error={getZodFieldError(errors.title)}
                            size="lg"
                        />
                        <FieldHint>
                            <p>
                                Це заголовок статті, який читач побачить
                                найбільшими буквами вгорі сторінки, і саме його
                                показує Google у списку результатів пошуку.
                            </p>
                            <p>
                                Напишіть його простими словами, так, як людина
                                сама набрала б це питання в пошуку. Наприклад:
                                «Як ФОП приймати оплату від клієнтів».
                            </p>
                        </FieldHint>
                    </div>

                    <div>
                        <UiInput
                            {...form.register('description')}
                            label="Опис"
                            placeholder="Короткий опис для видачі і соцмереж"
                            error={getZodFieldError(errors.description)}
                            size="md"
                        />
                        <FieldHint>
                            <p>
                                Одне коротке речення про те, про що ця стаття.
                            </p>
                            <p>
                                Його видно в Google одразу під заголовком, ще до
                                того як людина зайшла на сторінку. Це наче
                                маленька вивіска: прочитавши її, людина вирішує,
                                чи цікаво їй натиснути. Напишіть просто і чесно,
                                без води.
                            </p>
                        </FieldHint>
                    </div>

                    <div>
                        <UiInput
                            {...form.register('slug')}
                            label="Адреса (slug)"
                            placeholder="yak-fop-pryimaty-oplatu"
                            error={getZodFieldError(errors.slug)}
                            disabled={isSlugLocked}
                            size="md"
                        />
                        <FieldHint>
                            {isSlugLocked ? (
                                <p>
                                    Це адреса сторінки в інтернеті (те, що йде
                                    після <code>/guides/</code> у рядку
                                    браузера). Її вже не можна змінювати, бо
                                    стаття опублікована: на неї могли поставити
                                    посилання інші сайти, і зміна їх зламала б.
                                </p>
                            ) : (
                                <>
                                    <p>
                                        Це кінець посилання на вашу статтю, тобто
                                        те, що люди бачитимуть в адресному рядку
                                        після <code>/guides/</code>.
                                    </p>
                                    <p>
                                        Правила прості: тільки маленькі
                                        англійські букви, цифри і риска замість
                                        пробілу. Не можна великих букв,
                                        українських літер, пробілів і крапок.
                                    </p>
                                    <p>
                                        Найлегший спосіб: візьміть назву статті,
                                        напишіть її англійськими буквами і
                                        поставте риску між словами. Для «Як ФОП
                                        приймати оплату» вийде{' '}
                                        <code>yak-fop-pryimaty-oplatu</code>.
                                    </p>
                                </>
                            )}
                        </FieldHint>
                    </div>

                    <div>
                        <UiSelect
                            label="Автор"
                            options={AUTHOR_OPTIONS}
                            value={form.watch('authorId')}
                            onChange={(v) =>
                                form.setValue('authorId', v, {
                                    shouldDirty: true,
                                })
                            }
                            error={getZodFieldError(errors.authorId)}
                            size="md"
                        />
                        <FieldHint>
                            <p>
                                Виберіть, від чийого імені написана стаття. Імʼя
                                і фото цієї людини зʼявляться внизу сторінки,
                                читачам це додає довіри. Якщо не знаєте, кого
                                поставити, залиште того, хто вже вибраний.
                            </p>
                        </FieldHint>
                    </div>

                    <div>
                        <UiSelect
                            label="Розділ"
                            options={[
                                {
                                    label: 'Це основний гайд (pillar)',
                                    value: '',
                                },
                                ...pillarOptions,
                            ]}
                            value={form.watch('pillarSlug')}
                            onChange={(v) =>
                                form.setValue('pillarSlug', v, {
                                    shouldDirty: true,
                                })
                            }
                            size="md"
                        />
                        <FieldHint>
                            <p>
                                Тут ви кажете, чи ця стаття головна у своїй темі,
                                чи вона доповнює якусь головну.
                            </p>
                            <p>
                                <strong>Головна стаття</strong> це велика
                                оглядова тема, наприклад «Як ФОП приймати
                                оплату». Якщо пишете саме таку, залиште варіант
                                «Це основний гайд».
                            </p>
                            <p>
                                <strong>Доповнююча стаття</strong> розкриває одне
                                вузьке питання всередині великої теми. Наприклад
                                «Як зробити QR-код» це частинка теми про оплату.
                                Тоді виберіть тут ту головну статтю, до якої вона
                                підходить.
                            </p>
                            <p>
                                Що це дає: коли статті звʼязані, внизу кожної
                                сама собою зʼявиться підказка з посиланням на
                                сусідню, і читач легко переходитиме від однієї до
                                іншої.
                            </p>
                        </FieldHint>
                    </div>
                </section>

                <section className="space-y-4">
                    <div>
                        <div className="flex items-center justify-between gap-3">
                            <h2 className="text-foreground text-lg font-semibold tracking-tight">
                                Блоки
                            </h2>
                            <UiButton
                                type="button"
                                variant="outline"
                                size="sm"
                                IconLeft={<Plus className="size-4" />}
                                onClick={() =>
                                    append({
                                        heading: '',
                                        text: '',
                                        image: undefined,
                                    })
                                }
                            >
                                Додати блок
                            </UiButton>
                        </div>
                        <FieldHint>
                            <p>
                                Стаття складається з блоків, які йдуть згори вниз
                                один за одним. Один блок це один шматочок статті:
                                невеликий заголовок і текст під ним, за бажанням
                                з картинкою.
                            </p>
                            <p>
                                Розбивайте статтю на блоки за змістом, так її
                                набагато легше читати, ніж суцільною стіною
                                тексту. Стрілками вгору і вниз можна міняти блоки
                                місцями, а кошиком, прибрати зайвий.
                            </p>
                        </FieldHint>
                    </div>
                    {typeof errors.blocks?.message === 'string' && (
                        <p className="text-destructive text-sm">
                            {errors.blocks.message}
                        </p>
                    )}
                    <div className="space-y-3">
                        {fields.map((field, index) => (
                            <GuideBlockFields
                                key={field.id}
                                form={form}
                                index={index}
                                total={fields.length}
                                locked={blocksLocked}
                                onMoveUp={() => move(index, index - 1)}
                                onMoveDown={() => move(index, index + 1)}
                                onRemove={() => remove(index)}
                                onUploadingChange={handleBlockUploading}
                            />
                        ))}
                    </div>
                </section>

                <GuideFaqFields form={form} />

                <div className="border-border flex flex-wrap items-center gap-3 border-t pt-6">
                    <UiButton
                        type="submit"
                        variant="filled"
                        size="md"
                        loading={isSubmitting}
                        // Під час завантаження картинки блока її `value` ще
                        // undefined — збереження відправило б блок без фото.
                        disabled={(mode === 'edit' && !isDirty) || blocksLocked}
                    >
                        {mode === 'create' ? 'Створити тему' : 'Зберегти'}
                    </UiButton>

                    {guide && (
                        <>
                            <UiButton
                                as="link"
                                href={`/admin/guides/${guide.id}/preview`}
                                variant="outline"
                                size="md"
                                IconLeft={<Eye className="size-4" />}
                            >
                                Превʼю
                            </UiButton>

                            {isPlanned && (
                                <UiButton
                                    type="button"
                                    variant="filled"
                                    size="md"
                                    disabled={actionPending}
                                    onClick={() => {
                                        if (isDirty) {
                                            toast.error(
                                                'Спершу збережіть зміни, а потім переносьте в чернетки.'
                                            );
                                            return;
                                        }
                                        void runAction(
                                            () => startDraftGuide(guide.id),
                                            'Перенесено в чернетки'
                                        );
                                    }}
                                >
                                    Перенести в чернетки
                                </UiButton>
                            )}

                            {isDraft && (
                                <UiButton
                                    type="button"
                                    variant="filled"
                                    size="md"
                                    disabled={actionPending}
                                    onClick={() => {
                                        if (isDirty) {
                                            toast.error(
                                                'Спершу збережіть зміни, а потім публікуйте.'
                                            );
                                            return;
                                        }
                                        if (!hasContent) {
                                            toast.error(
                                                'Додайте хоча б один блок тексту, перш ніж публікувати.'
                                            );
                                            return;
                                        }
                                        void runAction(
                                            () => publishGuide(guide.id),
                                            'Гайд опубліковано'
                                        );
                                    }}
                                >
                                    Опублікувати
                                </UiButton>
                            )}

                            {isPublished && (
                                <UiButton
                                    type="button"
                                    variant="outline"
                                    size="md"
                                    disabled={actionPending}
                                    onClick={() => {
                                        if (isDirty) {
                                            toast.error(
                                                'Спершу збережіть зміни, а потім знімайте з публікації.'
                                            );
                                            return;
                                        }
                                        void runAction(
                                            () => unpublishGuide(guide.id),
                                            'Знято з публікації'
                                        );
                                    }}
                                >
                                    Зняти з публікації
                                </UiButton>
                            )}

                            {!isPublished && (
                                <UiButton
                                    type="button"
                                    variant="destructive-outline"
                                    size="md"
                                    className="ml-auto"
                                    onClick={() =>
                                        openDeleteDialog(guide.id, guide.title)
                                    }
                                >
                                    Видалити
                                </UiButton>
                            )}
                        </>
                    )}
                </div>
            </form>
        </main>
    );
}
