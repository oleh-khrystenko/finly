import { useTranslations } from 'next-intl';
import { FlaskConical } from 'lucide-react';

export function DemoBanner() {
    const t = useTranslations('billing_page.demo_banner');

    return (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-5">
            <div className="flex items-start gap-3">
                <FlaskConical className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
                <div>
                    <p className="text-foreground font-semibold">{t('title')}</p>
                    <p className="text-muted-foreground mt-1 text-sm">
                        {t('description')}
                    </p>
                    <code className="mt-3 block rounded bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
                        {t('test_card')}
                    </code>
                </div>
            </div>
        </div>
    );
}
