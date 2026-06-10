import { Check, ScanLine } from 'lucide-react';

import { DecorativeQr } from './DecorativeQr';

/**
 * iPhone 14/15 Pro-стиль mockup з демо-сценарієм платежу. Реальні пропорції
 * (aspect 9/19.5), Dynamic Island замість legacy-notch, тонкий bezel,
 * home indicator. Фрейм через theme-invariant токен `bg-device-frame` —
 * фізичний девайс має один колір (black/space-gray) незалежно від UI-теми;
 * адаптивний `bg-foreground` робив би у dark-темі "silver iPhone з білою
 * islandіою", що читається як артефакт. Home indicator адаптивний
 * (`bg-foreground/40`) — він елемент iOS-UI на екрані, не корпусу.
 *
 * Arbitrary-radius (`rounded-[2.75rem]` / `rounded-[2.25rem]`) свідомий —
 * Tailwind токени `rounded-3xl` (24px) дають "tablet"-look, а реальний iPhone
 * має ~55px зовнішнього і ~44px внутрішнього радіусу при тих пропорціях.
 * Без них фрейм виглядає як вікно, не як девайс.
 */
export function PhoneMockup() {
    return (
        <div className="relative mx-auto w-full max-w-[300px]">
            {/* Glow під телефоном — фірменний primary-accent */}
            <div
                aria-hidden
                className="from-primary/30 absolute -inset-8 -z-10 rounded-full bg-gradient-to-tr to-transparent opacity-60 blur-3xl"
            />

            {/* Frame (outer bezel). Тонкий 6px-кант — як на справжньому
             * iPhone, де bezel мінімальний. */}
            <div className="bg-device-frame relative aspect-[9/19.5] rounded-[2.75rem] p-1.5 shadow-2xl">
                {/* Screen */}
                <div className="bg-card relative h-full w-full overflow-hidden rounded-[2.25rem]">
                    {/* Dynamic Island — pill-shape, той самий колір що фрейм
                     * (зливається у візуальне "продовження" bezel-у). */}
                    <div
                        aria-hidden
                        className="bg-device-frame absolute top-2.5 left-1/2 z-10 h-7 w-[36%] -translate-x-1/2 rounded-full"
                    />

                    {/* Home indicator — тонка горизонтальна риска внизу
                     * екрану, як на справжньому iOS. */}
                    <div
                        aria-hidden
                        className="bg-foreground/40 absolute bottom-2 left-1/2 h-1 w-[35%] -translate-x-1/2 rounded-full"
                    />

                    {/* Screen content. `pt-14` — clearance для Dynamic Island
                     * (28px island + 10px top + 18px gap). `pb-7` — clearance
                     * для home indicator. */}
                    <div className="flex h-full flex-col gap-3 px-3 pt-14 pb-7">
                        {/* QR panel */}
                        <div className="border-border bg-background flex flex-col items-center gap-3 rounded-2xl border p-3">
                            <div className="text-muted-foreground flex items-center gap-1.5 text-[10px]">
                                <ScanLine className="size-3" />
                                <span>Скануйте з банк-додатку</span>
                            </div>
                            <DecorativeQr className="aspect-square w-32" />
                            <p className="text-muted-foreground text-center text-[10px]">
                                ФОП «Іваненко О. М.»
                            </p>
                        </div>

                        {/* Bank-app proof row */}
                        <div className="bg-primary/8 border-primary/20 flex items-start gap-2 rounded-xl border p-2.5">
                            <div className="bg-primary/15 text-primary flex size-7 shrink-0 items-center justify-center rounded-md">
                                <Check className="size-4" />
                            </div>
                            <div className="flex-1 text-[10px] leading-snug">
                                <p className="text-foreground font-medium">
                                    Готово до оплати
                                </p>
                                <p className="text-muted-foreground mt-0.5">
                                    Банк-додаток відкрив форму з реквізитами
                                </p>
                            </div>
                        </div>

                        {/* Primary CTA — прибита до низу через `mt-auto`,
                         * як на справжніх iOS payment-екранах. */}
                        <div className="bg-primary text-primary-foreground mt-auto flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-medium">
                            <Check className="size-3.5" />
                            Підтвердити платіж
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
