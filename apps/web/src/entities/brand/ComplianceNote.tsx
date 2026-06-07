import { ShieldCheck } from 'lucide-react';

/**
 * Compliance-band бренду — пояснення моделі НБУ-QR (Finly не платіжний посередник).
 * Витягнуто з `widgets/landing-footer` без зміни стилів, щоб шарити між
 * landing-футером (cabinet) і public-футером (`pay.finly.com.ua`).
 */
export function ComplianceNote() {
    return (
        <div className="border-border border-b">
            <div className="container mx-auto px-6 py-10 md:py-12">
                <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-[auto_1fr] md:gap-8">
                    <div className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-xl">
                        <ShieldCheck className="size-6" />
                    </div>
                    <div className="space-y-3 text-sm leading-relaxed">
                        <p className="text-muted-foreground">
                            Finly створює платіжні QR-коди та посилання за
                            стандартом НБУ, затвердженим постановою №97. Платник
                            сплачує у своєму банку, а кошти надходять прямо на ваш
                            банківський рахунок.
                        </p>
                        <p className="text-muted-foreground">
                            Finly лише готує платіж, але не проводить його: ми не
                            зберігаємо платежі, не утримуємо комісій з обороту і
                            не маємо доступу до ваших коштів.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
