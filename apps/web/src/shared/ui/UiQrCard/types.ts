export interface UiQrCardProps {
    /** QR-image endpoint без query (напр. `/api/.../qr/business.png`). */
    endpoint: string;
    /** Фіксований query endpoint-а (напр. `{ host: 'primary' }` для NBU). */
    params?: Record<string, string>;
    /** Заголовок-дія: що робить цей код («Оплата в банку» / «Відкрити сторінку»). */
    title: string;
    /** Додатковий рядок-пояснення (напр. яка адреса NBU). */
    caption?: string;
    alt: string;
    /** Імʼя файлу для кнопки завантаження друкарського розміру. */
    downloadFilename: string;
}
