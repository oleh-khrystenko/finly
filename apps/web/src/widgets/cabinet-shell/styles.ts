/**
 * Спільні класи рядків навігації кабінету (sidebar + drawer + account).
 *
 * `[&>span]:flex [&>span]:w-full …` — UiButton загортає children у єдиний span;
 * селектор робить його full-width flex-рядком, тож іконка/лейбл/бейдж стають
 * горизонтальним рядком, а `justify-center` кнопки не центрує вміст (span і так
 * на всю ширину). Той самий патерн, що у `MobileMenuSheet`.
 */
export const navRowClass =
    'w-full min-h-11 rounded-lg px-3 font-medium [&>span]:flex [&>span]:w-full [&>span]:items-center [&>span]:gap-3';

/** Hover для неактивних пунктів. Активний свій hover не має — підкладка стала. */
export const navRowHoverClass = 'hover:bg-muted';

/**
 * Активний пункт: бренд-тінт + primary-колір іконки й лейбла. `text-primary!` —
 * важливий, бо `UiButton` варіант `text` вже ставить `text-muted-foreground`, і
 * без пріоритету Tailwind лишив би сірий текст (порядок у темі, не в className).
 */
export const navRowActiveClass = 'bg-primary/10 font-semibold text-primary!';

export const navIconClass =
    'flex size-5 shrink-0 items-center justify-center [&>svg]:size-5';

export const navBadgeClass =
    'ml-auto rounded-full bg-muted px-2 py-0.5 text-xs leading-none text-muted-foreground';
