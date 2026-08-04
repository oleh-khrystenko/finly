import type { PublicCatalogView } from '@finly/types';
import CatalogSections from './CatalogSections';

interface Props {
    catalog: PublicCatalogView;
}

/**
 * Sprint 29 — публічний каталог отримувачів на головній pay-хоста. Секції за
 * категоріями (порядок і склад визначає бекенд), у кожній картки отримувачів,
 * що ведуть на їхню чинну публічну сторінку.
 *
 * Тіло каталогу спільне з кабінетною сторінкою (`CatalogSections`); тут лишень
 * публічна шапка — на pay-хості це головна сторінка з власним h1, у кабінеті
 * заголовок дає кабінетний контейнер.
 */
export default function PublicCatalog({ catalog }: Props) {
    return (
        <div className="mx-auto max-w-2xl space-y-12 px-4 py-12">
            <header className="space-y-2 text-center">
                <h1 className="text-foreground text-2xl font-bold tracking-tight md:text-3xl">
                    Перевірені отримувачі
                </h1>
                <p className="text-muted-foreground text-base">
                    Готові сторінки для оплати податків, зборів і благодійних
                    внесків. Оберіть отримувача і платіть за QR-кодом.
                </p>
            </header>

            <CatalogSections catalog={catalog} />
        </div>
    );
}
