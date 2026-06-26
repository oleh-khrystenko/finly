import { FlaskConical } from 'lucide-react';

export function DemoBanner() {
    return (
        <div className="border-warning/30 bg-warning/10 rounded-lg border p-5">
            <div className="flex items-start gap-3">
                <FlaskConical className="text-warning mt-0.5 h-5 w-5 shrink-0" />
                <div>
                    <p className="text-foreground font-semibold">
                        Демо monobank у тестовому режимі
                    </p>
                    <p className="text-muted-foreground mt-1 text-sm">
                        Це демо живої інтеграції з monobank. Реальні кошти не
                        списуються. На сторінці оплати monobank підійде будь-яка
                        картка.
                    </p>
                    <code className="bg-muted text-muted-foreground mt-3 block rounded px-3 py-2 font-mono text-sm">
                        Приклад: 4242 4242 4242 4242 · будь-яка майбутня дата ·
                        будь-який CVC
                    </code>
                </div>
            </div>
        </div>
    );
}
