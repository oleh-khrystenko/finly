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
 *
 * `mix-blend-multiply` на зображенні гасить білий фон лого: білий × тон плашки =
 * тон плашки, тож шов між не-чисто-білою плашкою і білим прямокутником зображення
 * зникає, а темний друк множенням не змінюється. `isolate` на плашці замикає
 * блендинг на її фоні — без нього multiply протікав би на фон сторінки.
 *
 * Опційний `displayName` — косметичний підпис поряд з лого. Колір
 * `--brand-plate-foreground` тема-незалежний (плашка завжди світла, тож текст
 * завжди темний).
 */
export default function UiBrandLogo({
    src,
    alt,
    displayName,
    className,
}: UiBrandLogoProps) {
    return (
        <span className="bg-brand-plate border-brand-plate-border text-brand-plate-foreground isolate inline-flex max-w-full items-center justify-center gap-1 rounded-xl border px-5 py-4 dark:shadow-md">
            <Image
                src={src}
                alt={alt}
                width={240}
                height={96}
                unoptimized
                className={composeClasses(
                    'h-14 w-auto max-w-[220px] shrink-0 object-contain mix-blend-multiply',
                    className
                )}
            />
            {displayName && (
                <span className="max-w-56 text-4xl leading-tight font-semibold break-words">
                    {displayName}
                </span>
            )}
        </span>
    );
}
