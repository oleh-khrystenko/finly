export interface UiQrPanelProps {
    /** QR-image endpoint без query (напр. `/api/.../qr/business.png`). */
    endpoint: string;
    /** Фіксований query endpoint-а (напр. `{ host: 'primary' }` для NBU). */
    params?: Record<string, string>;
    /** Заголовок-дія. Опускається, коли блок єдиний і назва зайва (бізнес-вивіска). */
    title?: string;
    /** Рядок-пояснення під заголовком. */
    description: string;
    alt: string;
    /** Імʼя файлу для кнопки завантаження друкарського розміру. */
    downloadFilename: string;
}
