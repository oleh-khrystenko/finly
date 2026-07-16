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
    publishGuide,
    unpublishGuide,
    updateGuide,
} from '@/shared/api';

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
        order: guide.order,
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
        order: values.order,
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
    order: 1,
    blocks: [{ heading: '', text: '', image: undefined }],
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

    const isPublished = guide?.status === 'published';
    const isSlugLocked = Boolean(guide && guide.datePublished !== null);

    const onSubmit = async (values: EditorFormValues) => {
        const payload = formToPayload(values);
        try {
            if (mode === 'create') {
                const created = await createGuide(payload);
                toast.success('Чернетку створено');
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
                <section className="space-y-4">
                    <UiInput
                        {...form.register('title')}
                        label="Назва"
                        placeholder="Як ФОП приймати оплату від клієнтів"
                        error={getZodFieldError(errors.title)}
                        size="lg"
                    />
                    <UiInput
                        {...form.register('description')}
                        label="Опис"
                        placeholder="Короткий опис для видачі і соцмереж"
                        error={getZodFieldError(errors.description)}
                        size="md"
                    />
                    <UiInput
                        {...form.register('slug')}
                        label="Адреса (slug)"
                        placeholder="yak-fop-pryimaty-oplatu"
                        error={getZodFieldError(errors.slug)}
                        disabled={isSlugLocked}
                        description={
                            isSlugLocked
                                ? 'Адреса зафіксована після першої публікації.'
                                : 'Лише малі латинські літери, цифри і дефіси.'
                        }
                        size="md"
                    />
                    <div className="grid gap-4 sm:grid-cols-2">
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
                        <UiInput
                            {...form.register('order', { valueAsNumber: true })}
                            type="number"
                            inputMode="numeric"
                            label="Порядок"
                            error={getZodFieldError(errors.order)}
                            size="md"
                        />
                    </div>
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
                </section>

                <section className="space-y-4">
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
                        {mode === 'create'
                            ? 'Створити чернетку'
                            : 'Зберегти'}
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

                            {isPublished ? (
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
                            ) : (
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
                                        void runAction(
                                            () => publishGuide(guide.id),
                                            'Гайд опубліковано'
                                        );
                                    }}
                                >
                                    Опублікувати
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
