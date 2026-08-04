import { composeClasses } from '@/shared/lib';
import type { UiWorkspaceColumnsProps } from './types';

/**
 * Двоколонковий робочий простір деталок кабінету: зліва основний стовп
 * (публічне посилання, вкладені списки, реквізити), справа допоміжний
 * (бренд, публічність, небезпечна зона). Нижче xl — один стос: спершу
 * робоче, потім допоміжне, danger востаннє.
 *
 * `25rem` допоміжного стовпа — єдина точка правди для всіх деталок;
 * `minmax(0,1fr)` + `min-w-0` дозволяють вмісту (довгі slug-и, IBAN)
 * стискатись замість розпирати сітку.
 */
const UiWorkspaceColumns = ({
    main,
    aside,
    className,
}: UiWorkspaceColumnsProps) => (
    <div
        className={composeClasses(
            'grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_25rem]',
            className
        )}
    >
        <div className="min-w-0 space-y-6">{main}</div>
        <div className="min-w-0 space-y-6">{aside}</div>
    </div>
);

UiWorkspaceColumns.displayName = 'UiWorkspaceColumns';

export default UiWorkspaceColumns;
