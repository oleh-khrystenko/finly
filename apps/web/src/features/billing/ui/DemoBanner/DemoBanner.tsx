import { FlaskConical } from 'lucide-react';

export function DemoBanner() {
    return (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-5">
            <div className="flex items-start gap-3">
                <FlaskConical className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
                <div>
                    <p className="text-foreground font-semibold">
                        Демо Stripe в тестовому режимі
                    </p>
                    <p className="text-muted-foreground mt-1 text-sm">
                        Це демо живої інтеграції зі Stripe. Реальні кошти не
                        списуються.
                    </p>
                    <code className="mt-3 block rounded bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
                        Тестова картка: 4242 4242 4242 4242 · Будь-яка майбутня
                        дата · Будь-який CVC
                    </code>
                </div>
            </div>
        </div>
    );
}
