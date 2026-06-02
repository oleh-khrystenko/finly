import { ShieldCheck } from 'lucide-react';

/**
 * Compliance-band бренду — пояснення моделі НБУ-QR + формати 003/002.
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
                            Finly генерує платіжні QR-коди за стандартом НБУ
                            (постанова №97). Гроші проходять напряму між банком
                            клієнта і вашим IBAN-ом. Finly не зберігає платежі,
                            не утримує комісій з обороту і не отримує доступу до
                            ваших коштів.
                        </p>
                        <p className="text-muted-foreground">
                            <span className="text-foreground font-medium">
                                Формат 003
                            </span>{' '}
                            (чинний з 01.11.2025) — основний.{' '}
                            <span className="text-foreground font-medium">
                                Формат 002
                            </span>{' '}
                            — fallback для банків, які ще не оновились.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
