import { Check, ScanLine } from 'lucide-react';

import { DecorativeQr } from './DecorativeQr';

/**
 * Стилізований телефон-frame з демо-сценарієм платежу. Показує одночасно
 * QR (що сканує клієнт) і фрагмент банк-app-у з готовою формою — візуальний
 * proof claim-у "один тап". Без external image-asset-ів — все CSS+SVG.
 */
export function PhoneMockup() {
    return (
        <div className="relative mx-auto w-full max-w-sm">
            {/* Glow під телефоном — фірменний primary accent */}
            <div
                aria-hidden
                className="from-primary/30 absolute -inset-8 -z-10 rounded-full bg-gradient-to-tr to-transparent opacity-60 blur-3xl"
            />

            <div className="border-border bg-background relative rounded-3xl border-8 p-1 shadow-2xl">
                {/* Notch */}
                <div
                    aria-hidden
                    className="bg-foreground/90 absolute top-2 left-1/2 z-10 h-5 w-24 -translate-x-1/2 rounded-b-2xl"
                />

                <div className="bg-card flex flex-col gap-4 overflow-hidden rounded-2xl p-5 pt-10">
                    {/* QR panel */}
                    <div className="bg-background border-border flex flex-col items-center gap-3 rounded-2xl border p-5">
                        <div className="text-muted-foreground flex items-center gap-2 text-xs">
                            <ScanLine className="size-3.5" />
                            <span>Скануйте з банк-додатку</span>
                        </div>
                        <DecorativeQr className="aspect-square w-40 sm:w-44" />
                        <p className="text-muted-foreground text-center text-xs">
                            ФОП «Іваненко О. М.»
                        </p>
                    </div>

                    {/* Bank-app row */}
                    <div className="bg-primary/8 border-primary/20 flex items-start gap-3 rounded-xl border p-3">
                        <div className="bg-primary/15 text-primary flex size-9 shrink-0 items-center justify-center rounded-lg">
                            <Check className="size-5" />
                        </div>
                        <div className="flex-1 text-xs">
                            <p className="text-foreground font-medium">
                                Готово до оплати
                            </p>
                            <p className="text-muted-foreground mt-0.5">
                                Banking-app відкрив форму з усіма реквізитами
                            </p>
                        </div>
                    </div>

                    {/* Pseudo-CTA */}
                    <div className="bg-primary text-primary-foreground flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium">
                        <Check className="size-4" />
                        Підтвердити платіж
                    </div>
                </div>
            </div>
        </div>
    );
}
