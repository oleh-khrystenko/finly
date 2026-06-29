'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Check, ScanLine } from 'lucide-react';
import { type BankCode } from '@finly/types';

import UiBankLogo from '@/shared/ui/UiBankLogo';

import { DecorativeQr } from './DecorativeQr';

/**
 * Hero-сцена на основі реального фото iPhone (`/landing/phone-hero.webp`).
 *
 * Фото зняте під кутом, екран — зелений chroma-key. Замість плаского mockup-у
 * ми проєктуємо живий платіжний UI **на сам екран фото** через `matrix3d`-
 * гомографію: дизайн-канвас `SCREEN_W×SCREEN_H` мапиться рівно на чотирикутник
 * зеленого екрана (кути вимірено пікселями з оригіналу 1448×1086). Завдяки
 * цьому текст і QR лишаються чіткими (векторний контент + GPU-трансформ), а
 * сцена отримує реальну глибину й драматичне світло фото.
 *
 * Theme-invariant: екран — нічний кадр (`bg-device-frame` + білий текст),
 * незалежно від UI-теми, як і фізичний девайс. Зелене ambient-світло фото
 * збігається з брендовим primary — свідома синергія.
 *
 * Client-компонент: матриця залежить від виміряного розміру контейнера
 * (`ResizeObserver`), тож обраховується на клієнті.
 */

// Кути зеленого екрана у частках сторін фото (1448×1086), з ~3% запасом
// назовні — щоб перекрити зелень на скруглених кутах. Порядок: TL, TR, BL, BR.
const SCREEN_CORNERS = [
    [0.38345, 0.08778], // top-left
    [0.59044, 0.07166], // top-right
    [0.35286, 0.82092], // bottom-left
    [0.56483, 0.84653], // bottom-right
] as const;

// Дизайн-канвас екрана. Пропорція ≈ видимому чотирикутнику (0.37), тож QR
// лишається квадратним після проєкції.
const SCREEN_W = 300;
const SCREEN_H = 812;

const RAIL_BANKS: readonly BankCode[] = [
    'privatbank',
    'monobank',
    'abank',
    'pumb',
];

// --- Проєктивна геометрія (homography → matrix3d) ----------------------------

type Mat3 = number[]; // 9 елементів, row-major

function adjugate(m: Mat3): Mat3 {
    return [
        m[4] * m[8] - m[5] * m[7],
        m[2] * m[7] - m[1] * m[8],
        m[1] * m[5] - m[2] * m[4],
        m[5] * m[6] - m[3] * m[8],
        m[0] * m[8] - m[2] * m[6],
        m[2] * m[3] - m[0] * m[5],
        m[3] * m[7] - m[4] * m[6],
        m[1] * m[6] - m[0] * m[7],
        m[0] * m[4] - m[1] * m[3],
    ];
}

function multmm(a: Mat3, b: Mat3): Mat3 {
    const r: Mat3 = new Array(9);
    for (let i = 0; i < 3; i += 1) {
        for (let j = 0; j < 3; j += 1) {
            let s = 0;
            for (let k = 0; k < 3; k += 1) s += a[3 * i + k] * b[3 * k + j];
            r[3 * i + j] = s;
        }
    }
    return r;
}

function multmv(m: Mat3, v: number[]): number[] {
    return [
        m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
        m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
        m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
    ];
}

// Базис чотирьох точок → матриця, що відображає одиничний базис у ці точки.
function basisToPoints(p: number[]): Mat3 {
    const m: Mat3 = [p[0], p[2], p[4], p[1], p[3], p[5], 1, 1, 1];
    const v = multmv(adjugate(m), [p[6], p[7], 1]);
    return multmm(m, [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]]);
}

// Гомографія source-чотирикутника → dest-чотирикутника (по 8 чисел кожен).
function projection(src: number[], dst: number[]): Mat3 {
    return multmm(basisToPoints(dst), adjugate(basisToPoints(src)));
}

/** matrix3d-рядок, що проєктує прямокутник SCREEN_W×SCREEN_H на екран фото. */
function buildScreenMatrix(boxW: number, boxH: number): string {
    const src = [0, 0, SCREEN_W, 0, 0, SCREEN_H, SCREEN_W, SCREEN_H];
    const dst = SCREEN_CORNERS.flatMap(([fx, fy]) => [fx * boxW, fy * boxH]);
    const t = projection(src, dst);
    for (let i = 0; i < 9; i += 1) t[i] /= t[8];
    // column-major 4×4 з 3×3 гомографії (Z-вісь — тотожна).
    const m = [
        t[0], t[3], 0, t[6],
        t[1], t[4], 0, t[7],
        0, 0, 1, 0,
        t[2], t[5], 0, t[8],
    ];
    return `matrix3d(${m.map((n) => n.toFixed(6)).join(',')})`;
}

// --- Компонент ---------------------------------------------------------------

export function HeroDevice() {
    const frameRef = useRef<HTMLDivElement>(null);
    const [matrix, setMatrix] = useState<string | null>(null);

    useEffect(() => {
        const el = frameRef.current;
        if (!el) return;

        const recompute = () => {
            const { width, height } = el.getBoundingClientRect();
            if (width > 0 && height > 0) {
                setMatrix(buildScreenMatrix(width, height));
            }
        };

        recompute();
        const ro = new ResizeObserver(recompute);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    return (
        <div className="relative right-0 w-full lg:absolute lg:max-w-3/5">
            {/* Вікно. На мобільному — портретний кадр 3:4, що наближає телефон
                майже на весь екран і клипає поля; з sm — повне фото 4:3. Маска-
                фейд живе тут, бо краї мають танути на видимих межах вікна (на
                мобільному верх+низ, з sm — лише низ). */}
            <div className="relative aspect-3/4 overflow-hidden mask-t-from-90% mask-b-from-90% sm:aspect-4/3 sm:mask-t-from-70% sm:mask-b-from-70%">
                {/* Кадр = повне фото 4:3 (накладка екрана відкалібрована саме
                    під нього, тож зум робимо через збільшення кадру, не crop).
                    На мобільному absolute, збільшений ×2.1 і відцентрований на
                    телефон; з sm повертається у звичайний потік. Лишається
                    позиціонованим завжди — next/image fill цього вимагає. */}
                <div
                    ref={frameRef}
                    className="absolute top-1/2 left-1/2 aspect-4/3 w-[210%] -translate-x-[47%] -translate-y-[46%] sm:relative sm:top-0 sm:left-0 sm:w-full sm:translate-x-0 sm:translate-y-0"
                >
                    <Image
                        src="/landing/phone-hero.webp"
                        alt="iPhone із платіжною сторінкою Finly: сума й QR-код для оплати у будь-якому банку"
                        fill
                        priority
                        sizes="(max-width: 1024px) 100vw, 60vw"
                        className="object-cover"
                    />

                    {/* Проєкція живого екрана на зелений chroma-key. */}
                    <div
                        aria-hidden
                        style={{
                            width: SCREEN_W,
                            height: SCREEN_H,
                            transform: matrix ?? undefined,
                            transformOrigin: '0 0',
                        }}
                        className={`absolute top-0 left-0 transition-opacity duration-700 ease-out ${
                            matrix ? 'opacity-100' : 'opacity-0'
                        }`}
                    >
                        <ScreenContent />
                    </div>
                </div>
            </div>

            {/* Floating-картки — AR-шар над фото (sm+, щоб не тіснити mobile). */}
            <div className="animate-fadeIn absolute top-[5%] -right-2 z-20 hidden rotate-3 sm:block">
                <div className="animate-floatBob border-border bg-card flex items-center gap-2 rounded-xl border px-3 py-2 shadow-xl">
                    <UiBankLogo bank="monobank" className="size-7" />
                    <div className="leading-tight">
                        <p className="text-muted-foreground text-xs">
                            Надійшов платіж
                        </p>
                        <p className="text-success text-xs font-semibold tabular-nums">
                            +1 500,00 грн
                        </p>
                    </div>
                </div>
            </div>

            <div className="animate-fadeIn absolute bottom-[6%] -left-2 z-20 hidden -rotate-2 sm:block">
                <div className="animate-floatBob border-border bg-card flex items-center gap-2.5 rounded-xl border px-3 py-2.5 shadow-xl">
                    <span className="bg-success text-success-foreground flex size-7 shrink-0 items-center justify-center rounded-full">
                        <Check className="size-4" strokeWidth={3} />
                    </span>
                    <div className="leading-tight">
                        <p className="text-foreground text-xs font-semibold">
                            Оплачено
                        </p>
                        <p className="text-muted-foreground text-xs">
                            за 12 секунд, без реквізитів
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

/**
 * Вміст екрана у власному px-просторі SCREEN_W×SCREEN_H. Theme-invariant нічний
 * кадр: `bg-device-frame` + білий текст (як `fill-white` у QR і `--device-frame`
 * — фізичний девайс не залежить від UI-теми).
 */
function ScreenContent() {
    return (
        <div className="bg-device-frame relative flex h-full w-full flex-col justify-between overflow-hidden rounded-[12px] px-6 pt-[88px] pb-[68px]">
            {/* Зелений radial зверху — підхоплює світло фото. */}
            <div
                aria-hidden
                className="from-primary/25 absolute inset-x-0 top-0 h-1/2 bg-linear-to-b to-transparent"
            />

            {/* Сума — якір цінності. */}
            <div className="relative text-center">
                <p className="text-[13px] font-medium tracking-[0.2em] text-white/55 uppercase">
                    До сплати
                </p>
                <p className="mt-2 text-[42px] leading-none font-bold tracking-tight tabular-nums text-white">
                    1 500,00
                    <span className="ml-1.5 text-2xl font-semibold text-white/50">
                        грн
                    </span>
                </p>
            </div>

            {/* QR — центральний герой. Білий тайл + scan-промінь. */}
            <div className="relative mx-auto">
                <div className="relative overflow-hidden rounded-3xl bg-white p-4 shadow-2xl">
                    <DecorativeQr className="aspect-square w-[196px]" />
                    <div
                        aria-hidden
                        className="qr-scan-beam pointer-events-none absolute inset-x-0 top-0 h-1/5"
                    />
                </div>
                <p className="mt-4 flex items-center justify-center gap-1.5 text-[15px] text-white/65">
                    <ScanLine className="size-4" />
                    Наведіть камеру банку
                </p>
            </div>

            {/* Рейка банків — сигнал «будь-який банк». */}
            <div className="relative text-center">
                <p className="text-[12px] font-medium tracking-[0.12em] text-white/45 uppercase">
                    Будь-який банк
                </p>
                <div className="mt-3 flex items-center justify-center gap-2.5">
                    {RAIL_BANKS.map((bank) => (
                        <UiBankLogo
                            key={bank}
                            bank={bank}
                            className="size-9 border-white/10"
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}
