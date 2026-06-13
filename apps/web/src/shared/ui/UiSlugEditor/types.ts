import type { SlugAvailabilityStatus, SlugReservationView } from '@finly/types';

export interface UiSlugEditorProps {
    /** Поточний канонічний slug сутності (read-mode + порівняння на no-op). */
    currentSlug: string;
    /** Незмінний host-prefix адреси (`pay.finly.com.ua/biz/`), muted у display. */
    prefix: string;
    /** Повна public-URL поточного slug — для «Відкрити» / «Копіювати». */
    publicUrl: string;
    /** aria-label інпута. */
    ariaLabel: string;
    /** Пояснення під інпутом (account/invoice: про history-redirect). */
    helpText?: string;
    /** Формат-валідація бажаного імені (Zod). Повертає UA-помилку або null. */
    validate: (value: string) => string | null;
    /**
     * Платний рівень (brand+). true → Save пише slug одразу (PATCH); false →
     * Save кладе ім'я на холд і відкриває inline-апсел. Також керує показом
     * кнопки «Згенерувати нове посилання» (платна дія).
     */
    isPaid: boolean;
    /** Live-перевірка доступності бажаного імені (усі рівні). */
    checkAvailability: (slug: string) => Promise<SlugAvailabilityStatus>;
    /** Холд бажаного вільного імені (free-flow на Save). */
    reserve: (slug: string) => Promise<SlugReservationView>;
    /** Запис slug (платний шлях). */
    onSave: (slug: string) => Promise<void>;
    /** Відкриває confirm-діалог скидання на свіже випадкове посилання. */
    onRegenerate: () => void;
    /** Primary CTA апселу: прямий checkout підписки з поверненням на цю сторінку. */
    onSubscribe: () => void;
    /** Підпис ціни на primary CTA («Підписатись · 49 грн/міс»). */
    subscribePriceLabel: string;
    /**
     * Активна бронь ЦІЄЇ сутності (з `users/me`): показати апсел одразу з
     * відліком, що залишився, коли користувач повертається на сторінку.
     */
    initialReservation?: SlugReservationView | null;
    /** Фолбек «оберіть інше»: одразу відкрити поле редагування на mount. */
    autoStartEdit?: boolean;
}
