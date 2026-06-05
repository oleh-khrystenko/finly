import { ArrowRight } from 'lucide-react';

import UiButton from '@/shared/ui/UiButton';

export function HelpCtaBanner() {
    return (
        <section className="border-border bg-muted/40 mt-12 rounded-xl border p-6 text-center md:p-8">
            <h2 className="text-foreground text-xl font-semibold tracking-tight">
                Готові спробувати Finly?
            </h2>
            <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm leading-relaxed">
                Створіть платіжний QR-код за стандартом НБУ безкоштовно, без
                диктування реквізитів у месенджері.
            </p>
            <UiButton
                as="link"
                href="/auth/signin"
                variant="filled"
                size="md"
                className="mt-5"
                IconRight={<ArrowRight className="size-4" />}
            >
                Почати безкоштовно
            </UiButton>
        </section>
    );
}
