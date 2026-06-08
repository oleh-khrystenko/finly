import { type BankCode } from '@finly/types';
import { composeClasses } from '@/shared/lib';

export interface UiBankLogoProps {
    bank: BankCode;
    /**
     * Класи розміру (+ інші). За замовчуванням `size-10`. Передавайте сюди
     * розмір під контекст (напр. `size-12 sm:size-14`).
     */
    className?: string;
    /**
     * `alt`. За замовчуванням `''` — логотип декоративний, бо назву банку у
     * всіх місцях несе сусідній текстовий label / `aria-label` кнопки.
     */
    alt?: string;
}

/**
 * Єдине джерело істини для рендеру логотипа банку.
 *
 * Файли — `apps/web/public/banks/<bankCode>.webp` (офіційні іконки App Store,
 * генеруються `apps/api/scripts/generate-bank-logos.ts`). Споживачі —
 * `UiBankAppGrid` (банк-чузер) і `LandingBanks` (trust-rail); обидва беруть
 * логотип звідси, без власних плейсхолдерів.
 *
 * Без `'use client'` — це чистий `<img>`, тож працює і в server-компонентах
 * (`LandingBanks`), і в client (`UiBankAppGrid`). Плейн `<img>` (як `UiQrImage`):
 * next/image зайвий для крихітного same-origin asset.
 */
export default function UiBankLogo({
    bank,
    className,
    alt = '',
}: UiBankLogoProps) {
    return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
            src={`/banks/${bank}.webp`}
            alt={alt}
            width={56}
            height={56}
            loading="lazy"
            className={composeClasses(
                'border-border shrink-0 rounded-lg border object-contain',
                className ?? 'size-10'
            )}
        />
    );
}
