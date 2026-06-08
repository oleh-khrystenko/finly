import type { AutoSlugMode, SlugInput, SlugPreset } from '@finly/types';

/**
 * Sprint 17 §billing-design — єдине джерело істини для вибору формату нумерації
 * рахунку. Раніше це жило двома неузгодженими списками: gear-попап на сторінці
 * реквізитів (`InvoiceNumberingMenu`, 4 пресети) і плоский `UiSelect` у формі
 * створення (6 опцій). Тепер один набір опцій + helpers обслуговує і форму
 * створення, і діалог перевипуску.
 *
 * `InvoiceFormatChoice` = 4 пресети + `explicit` + `random`. Підмножина без
 * `explicit` — це `AutoSlugMode` (`packages/types`): саме її можна запам'ятати
 * як «домашній формат» рахунку і відтворити перевипуском.
 */
export type InvoiceFormatChoice = SlugPreset | 'explicit' | 'random';

interface InvoiceFormatMeta {
    title: string;
    /** Короткий приклад результату — конкретніший за назву формату. */
    example: string;
}

export const INVOICE_FORMAT_META: Record<
    InvoiceFormatChoice,
    InvoiceFormatMeta
> = {
    simple: { title: 'Послідовний', example: '001' },
    'with-month': { title: 'Рік і місяць', example: 'рік-місяць-001' },
    'with-year': { title: 'Рік', example: 'рік-001' },
    'with-purpose': { title: 'За призначенням', example: 'призначення-001' },
    explicit: { title: 'Ввести самому', example: 'ваш-варіант' },
    random: { title: 'Випадковий код', example: 'aB3xQ9k7' },
};

/** Форма створення: усі 6 варіантів (включно з ручним вводом). */
export const CREATE_FORMAT_ORDER: readonly InvoiceFormatChoice[] = [
    'simple',
    'with-month',
    'with-year',
    'with-purpose',
    'explicit',
    'random',
];

/**
 * Перевипуск: лише 5 авто-варіантів. `explicit` виключено — ручний rename вже
 * робить кнопка «Редагувати» на тій самій сторінці, а перевипуск семантично
 * означає авто-генерацію (його не можна «згенерувати» ручним текстом).
 */
export const RESET_FORMAT_ORDER: readonly InvoiceFormatChoice[] = [
    'simple',
    'with-month',
    'with-year',
    'with-purpose',
    'random',
];

/**
 * Авто-режим — будь-який вибір, окрім ручного. Виключення єдиного `'explicit'`
 * з union залишає рівно `AutoSlugMode`, тож type-guard коректний без cast-у.
 */
export function isAutoSlugMode(
    choice: InvoiceFormatChoice
): choice is AutoSlugMode {
    return choice !== 'explicit';
}

/** Конструює API-shape `SlugInput` з вибору + (для `explicit`) ручної частини. */
export function choiceToSlugInput(
    choice: InvoiceFormatChoice,
    humanPart: string
): SlugInput {
    if (choice === 'explicit') {
        return { kind: 'explicit', humanPart };
    }
    if (choice === 'random') {
        return { kind: 'random' };
    }
    return { kind: 'preset', preset: choice };
}
