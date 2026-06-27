'use client';

import Image from 'next/image';

import { composeClasses } from '@/shared/lib';
import type { UiBrandLogoProps } from './types';

/**
 * Sprint 21 — кастомний логотип отримувача на публічних pay-сторінках. `unoptimized`
 * рендерить чистий `<img>` без `_next/image`: працює на pay-хості без залежності
 * від `remotePatterns` і не пере-кодує лого (зберігає прозорість/чіткість).
 *
 * Логотип завантажують під білий фон QR (темний друк на прозорому), тож на темній
 * темі він зливається. Тема-незалежна світла пластина (`--brand-plate`) дає йому
 * сталу світлу поверхню в обох темах: у light межа ледь помітна (зливається з
 * фоном), у dark — світла картка з чітким краєм.
 */
export default function UiBrandLogo({ src, alt, className }: UiBrandLogoProps) {
    return (
        <span className="bg-brand-plate border-brand-plate-border inline-flex items-center justify-center rounded-xl border px-5 py-4 dark:shadow-md">
            <Image
                src={src}
                alt={alt}
                width={240}
                height={96}
                unoptimized
                className={composeClasses(
                    'h-14 w-auto max-w-[220px] object-contain',
                    className
                )}
            />
        </span>
    );
}
