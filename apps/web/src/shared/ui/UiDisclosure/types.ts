import { ReactNode } from 'react';

export type UiDisclosureAlign = 'start' | 'center';

export interface UiDisclosureProps {
    /** Текст тригера (поряд із chevron-стрілкою). */
    label: ReactNode;
    /** Контент, що розкривається. */
    children: ReactNode;
    /** Розкрито на старті. За замовчуванням `false`. */
    defaultOpen?: boolean;
    /** Вирівнювання тригера: `start` (за замовчуванням) або `center`. */
    align?: UiDisclosureAlign;
    className?: string;
}
