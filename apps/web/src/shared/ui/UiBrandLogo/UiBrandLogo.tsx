'use client';

import Image from 'next/image';

import { composeClasses } from '@/shared/lib';
import type { UiBrandLogoProps } from './types';

/**
 * Sprint 21 — кастомний логотип отримувача на публічних pay-сторінках. `unoptimized`
 * рендерить чистий `<img>` без `_next/image`: працює на pay-хості без залежності
 * від `remotePatterns` і не пере-кодує лого (зберігає прозорість/чіткість).
 */
export default function UiBrandLogo({ src, alt, className }: UiBrandLogoProps) {
    return (
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
    );
}
