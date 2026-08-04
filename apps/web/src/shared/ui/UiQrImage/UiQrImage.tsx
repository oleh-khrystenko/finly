'use client';

import { useCallback, useState } from 'react';
import { composeClasses } from '@/shared/lib';
import type { UiQrImageProps } from './types';

const UiQrImage = ({ src, alt, className }: UiQrImageProps) => {
    const [loaded, setLoaded] = useState(false);

    // Ref callback ловить cached-image case: якщо PNG уже в HTTP-кеші,
    // браузер декодує його ДО mount-у і `onLoad` не вистрелить. На момент
    // attach-у ref-у `complete === true` — використовуємо це як trigger.
    // Свідомо НЕ useEffect, щоб не тригерити `react-hooks/set-state-in-effect`.
    const refCallback = useCallback((node: HTMLImageElement | null) => {
        if (node?.complete && node.naturalWidth > 0) setLoaded(true);
    }, []);

    return (
        // Без `aspect-square`: брендований QR (Sprint 14) має смуги — полотно
        // вище за ширину, аспект різний per-тип. Контейнер сидить на натуральну
        // висоту зображення (`h-auto`), skeleton overlay заповнює її.
        <div
            className={composeClasses(
                'relative w-full overflow-hidden',
                className
            )}
        >
            {!loaded && (
                <div
                    className="bg-secondary absolute inset-0 animate-pulse"
                    aria-hidden="true"
                />
            )}
            {/* next/image не використовуємо: re-encode WebP/AVIF + sharpen
                ламає precision-raster QR. HTTP-кеш на API endpoint уже є. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                ref={refCallback}
                src={src}
                alt={alt}
                loading="lazy"
                onLoad={() => setLoaded(true)}
                onError={() => setLoaded(true)}
                className={composeClasses(
                    'relative block h-auto w-full transition-opacity duration-200',
                    loaded ? 'opacity-100' : 'opacity-0'
                )}
            />
        </div>
    );
};

UiQrImage.displayName = 'UiQrImage';

export default UiQrImage;
