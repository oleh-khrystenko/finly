import { Check, ScanLine } from 'lucide-react';
import { type BankCode } from '@finly/types';

import UiBankLogo from '@/shared/ui/UiBankLogo';

import { DecorativeQr } from './DecorativeQr';

/**
 * Hero-сцена: iPhone-mockup, де домінує брендований QR — підпис продукту.
 * Це рекламний кадр, не копія pay-сторінки: екран показує миттєвий результат
 * (сума → QR → будь-який банк), а збоку «вилітають» дві плаваючі картки, що
 * розповідають шлях платежу «до → після» (скан → гроші надійшли → оплачено).
 *
 * Фрейм через theme-invariant `bg-device-frame` — фізичний девайс має один
 * колір незалежно від UI-теми. QR-плитка завжди біла (як справжній QR —
 * сканованість), модулі — фірмовим primary. Home indicator адаптивний.
 *
 * Arbitrary-radius (`rounded-[2.75rem]`/`rounded-[2.25rem]`) свідомий —
 * Tailwind-токени дають "tablet"-look; реальний iPhone має ~55/44px радіуси.
 */

// Рейка довіри: справжні лого-ассети (`/banks/*.webp`), що й на бойовій сторінці.
const RAIL_BANKS: readonly BankCode[] = [
    'privatbank',
    'monobank',
    'abank',
    'pumb',
];

export function PhoneMockup() {
    return (
        <div className="relative mx-auto w-full max-w-[300px]">
            {/* Ambient primary-glow — глибина без glassmorphism. */}
            <div
                aria-hidden
                className="from-primary/35 absolute -inset-10 -z-10 rounded-full bg-gradient-to-tr to-transparent opacity-60 blur-3xl"
            />

            {/* Плаваюча картка-пуш «гроші надійшли» — верхній правий кут. */}
            <div className="animate-fadeIn absolute -top-3 -right-4 z-20 rotate-3 sm:-right-8">
                <div className="animate-floatBob border-border bg-card flex items-center gap-2 rounded-xl border px-3 py-2 shadow-xl">
                    <UiBankLogo bank="monobank" className="size-7" />
                    <div className="leading-tight">
                        <p className="text-muted-foreground text-[10px]">
                            Надійшов платіж
                        </p>
                        <p className="text-success text-xs font-semibold tabular-nums">
                            +1 500,00 грн
                        </p>
                    </div>
                </div>
            </div>

            {/* Плаваюча картка-результат «оплачено» — нижній лівий кут. */}
            <div className="animate-fadeIn absolute -bottom-4 -left-4 z-20 -rotate-2 sm:-left-8">
                <div className="animate-floatBob border-border bg-card flex items-center gap-2.5 rounded-xl border px-3 py-2.5 shadow-xl">
                    <span className="bg-success text-success-foreground flex size-7 shrink-0 items-center justify-center rounded-full">
                        <Check className="size-4" strokeWidth={3} />
                    </span>
                    <div className="leading-tight">
                        <p className="text-foreground text-xs font-semibold">
                            Оплачено
                        </p>
                        <p className="text-muted-foreground text-[10px]">
                            за 12 секунд, без реквізитів
                        </p>
                    </div>
                </div>
            </div>

            {/* Frame (outer bezel). */}
            <div className="bg-device-frame relative aspect-[9/19.5] rounded-[2.75rem] p-1.5 shadow-2xl">
                {/* Screen */}
                <div className="bg-background relative h-full w-full overflow-hidden rounded-[2.25rem]">
                    {/* Dynamic Island. */}
                    <div
                        aria-hidden
                        className="bg-device-frame absolute top-2.5 left-1/2 z-10 h-7 w-[36%] -translate-x-1/2 rounded-full"
                    />
                    {/* Home indicator. */}
                    <div
                        aria-hidden
                        className="bg-foreground/40 absolute bottom-2 left-1/2 z-10 h-1 w-[35%] -translate-x-1/2 rounded-full"
                    />

                    {/* Subtle radial-акцент під QR на самому екрані. */}
                    <div
                        aria-hidden
                        className="from-primary/10 absolute inset-x-0 top-1/4 -z-0 h-1/2 bg-gradient-to-b to-transparent"
                    />

                    {/* Content — три групи: сума (верх), QR (центр), банки (низ). */}
                    <div className="relative flex h-full flex-col justify-between px-5 pt-14 pb-8">
                        {/* Сума — якір цінності. */}
                        <div className="text-center">
                            <p className="text-muted-foreground text-[10px] font-medium tracking-[0.18em] uppercase">
                                До сплати
                            </p>
                            <p className="text-foreground mt-1 text-3xl leading-none font-bold tracking-tight tabular-nums">
                                1 500,00
                                <span className="text-muted-foreground ml-1 text-lg font-semibold">
                                    грн
                                </span>
                            </p>
                        </div>

                        {/* QR — центральний герой. Біла плитка + scan-промінь. */}
                        <div className="mx-auto">
                            <div className="ring-border relative overflow-hidden rounded-2xl bg-white p-3 shadow-lg ring-1">
                                <DecorativeQr className="aspect-square w-40" />
                                {/* Scan-промінь поверх QR. */}
                                <div
                                    aria-hidden
                                    className="qr-scan-beam pointer-events-none absolute inset-x-0 top-0 h-1/5"
                                />
                            </div>
                            <p className="text-muted-foreground mt-3 flex items-center justify-center gap-1.5 text-[11px]">
                                <ScanLine className="size-3.5" />
                                Наведіть камеру банку
                            </p>
                        </div>

                        {/* Рейка банків — сигнал «будь-який банк». */}
                        <div className="text-center">
                            <p className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
                                Будь-який банк
                            </p>
                            <div className="mt-2 flex items-center justify-center gap-2">
                                {RAIL_BANKS.map((bank) => (
                                    <UiBankLogo
                                        key={bank}
                                        bank={bank}
                                        className="size-8"
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
