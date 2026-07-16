import { z } from 'zod';
import {
    guideDescriptionSchema,
    guideSlugSchema,
    guideTitleSchema,
} from '@finly/types';

/**
 * Form-level schema for the constructor. Softer than the API `UpsertGuideSchema`
 * where the UI holds transient states the payload never sees: empty heading /
 * caption (dropped to `undefined` on submit) and `pillarSlug: ''` (meaning "this
 * is a pillar", mapped to `null`). Fields with real constraints reuse the shared
 * sub-schemas so inline errors match the server.
 */

const editorBlockImageSchema = z.object({
    src: z.string(),
    alt: z
        .string()
        .trim()
        .min(3, 'Опишіть зображення (мінімум 3 символи)')
        .max(200, 'Опис задовгий (максимум 200 символів)'),
    width: z.number(),
    height: z.number(),
    // Empty caption is a valid transient state (dropped to undefined on submit);
    // a filled one must satisfy the API bounds (min 3, max 300), or the server
    // rejects the whole payload with a generic error and no inline hint.
    caption: z
        .string()
        .refine(
            (v) => {
                const t = v.trim();
                return t === '' || (t.length >= 3 && t.length <= 300);
            },
            { message: 'Підпис має бути від 3 до 300 символів' }
        )
        .optional(),
});

const editorBlockSchema = z.object({
    heading: z.string().refine(
        (v) => {
            const t = v.trim();
            return t === '' || (t.length >= 3 && t.length <= 120);
        },
        { message: 'Заголовок має бути від 3 до 120 символів' }
    ),
    text: z
        .string()
        .trim()
        .min(1, 'Додайте текст блоку')
        .max(20000, 'Текст задовгий (максимум 20000 символів)'),
    image: editorBlockImageSchema.optional(),
});

const editorFaqSchema = z.object({
    question: z
        .string()
        .trim()
        .min(3, 'Введіть запитання')
        .max(300, 'Запитання задовге (максимум 300 символів)'),
    answer: z
        .string()
        .trim()
        .min(3, 'Введіть відповідь')
        .max(2000, 'Відповідь задовга (максимум 2000 символів)'),
});

export const EditorFormSchema = z.object({
    slug: guideSlugSchema,
    title: guideTitleSchema,
    description: guideDescriptionSchema,
    authorId: z.string().min(1, 'Оберіть автора'),
    /** `''` → стаття є pillar; інакше slug наявного pillar. */
    pillarSlug: z.string(),
    order: z
        // Порожнє поле з `valueAsNumber` дає NaN → schema-level `error` ловить
        // і type-, і NaN-кейс українською замість дефолтного англомовного Zod.
        .number({ error: 'Введіть номер порядку (ціле число від 1 до 999)' })
        .int('Порядок має бути цілим числом')
        .min(1, 'Порядок має бути не менше 1')
        .max(999, 'Порядок має бути не більше 999'),
    // min/max mirror the API `UpsertGuideSchema` so oversized structures fail
    // inline instead of as a generic server rejection.
    blocks: z
        .array(editorBlockSchema)
        .min(1, 'Додайте хоча б один блок')
        .max(100, 'Забагато блоків (максимум 100)'),
    faq: z.array(editorFaqSchema).max(50, 'Забагато запитань (максимум 50)'),
});

export type EditorFormValues = z.infer<typeof EditorFormSchema>;
