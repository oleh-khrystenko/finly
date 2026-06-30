import { ArrowRight } from 'lucide-react';

import {
    BrandSignature,
    ComplianceNote,
    Copyright,
    LegalNav,
} from '@/entities/brand';
import UiButton from '@/shared/ui/UiButton';
import { ENV } from '@/shared/config/env';

/**
 * Футер публічного payment-host-а (`pay.finly.com.ua`).
 *
 * Перевикористовує спільні brand-блоки (`ComplianceNote`, `BrandSignature`,
 * `LegalNav`, `Copyright`) з ІДЕНТИЧНИМИ стилями landing-футера. Структура
 * дзеркалить landing (compliance-band → 3 колонки → copyright-strip); єдина
 * відмінність — middle-колонка: замість landing-Product тут growth-CTA.
 *
 * `LegalNav` отримує `baseUrl` — на pay-host шлях-лінки `/privacy`,`/terms`
 * middleware (`proxy.ts`) трактує як business-slug → 404; тому абсолютні
 * external-лінки на marketing-origin, у новій вкладці (не вбити незавершений
 * платіж).
 */
export function PublicFooter() {
    const base = ENV.NEXT_PUBLIC_BASE_URL;

    return (
        <footer className="bg-card border-border border-t">
            <ComplianceNote />

            {/* Main footer columns */}
            <div className="container mx-auto px-6 py-12 md:py-16">
                <div className="grid gap-10 md:grid-cols-3 md:gap-12">
                    <BrandSignature />

                    {/* Growth CTA column (public-only) */}
                    <div>
                        <h3 className="text-foreground text-sm font-semibold tracking-wide">
                            Приймаєте платежі?
                        </h3>
                        <p className="text-muted-foreground mt-2 max-w-xs text-sm leading-relaxed">
                            Згенеруйте платіжний QR за стандартом НБУ. Спробуйте
                            без реєстрації.
                        </p>
                        <UiButton
                            as="a"
                            href={`${base}/#try-now`}
                            target="_blank"
                            rel="noopener noreferrer"
                            variant="filled"
                            size="md"
                            IconRight={<ArrowRight />}
                            className="mt-4"
                        >
                            Спробувати
                        </UiButton>
                    </div>

                    <LegalNav baseUrl={base} showContact />
                </div>
            </div>

            <Copyright />
        </footer>
    );
}
