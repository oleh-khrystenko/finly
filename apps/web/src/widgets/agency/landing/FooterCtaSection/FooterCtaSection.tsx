import { useTranslations } from 'next-intl';
import {
    ArrowRight,
    Send,
    Clock,
    FileText,
    CheckCircle2,
    LucideIcon,
} from 'lucide-react';
import StartBriefButton from '../StartBriefButton';

const steps: { key: number; icon: LucideIcon; primary?: boolean }[] = [
    { key: 1, icon: Send, primary: true },
    { key: 2, icon: Clock },
    { key: 3, icon: FileText },
    { key: 4, icon: CheckCircle2 },
];

const FooterCtaSection = () => {
    const t = useTranslations('landing_page.footer_cta');

    return (
        <section
            id="footer-cta"
            className="scroll-mt-16 border-t border-border py-24"
        >
            <div className="container px-6">
                <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
                    {/* Text + CTA */}
                    <div>
                        <span className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                            {t('label')}
                        </span>
                        <h2 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">
                            {t('heading')}
                        </h2>
                        <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
                            {t('description')}
                        </p>
                        <StartBriefButton
                            variant="filled"
                            size="lg"
                            className="mt-8 w-full font-semibold sm:w-auto"
                            IconRight={<ArrowRight />}
                        >
                            {t('cta')}
                        </StartBriefButton>
                    </div>

                    {/* Steps */}
                    <div className="flex justify-center lg:justify-end">
                        <div className="w-full max-w-sm space-y-3">
                            {steps.map(({ key, icon: Icon, primary }) => (
                                <div
                                    key={key}
                                    className="group relative flex items-center gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:border-muted-foreground/30"
                                >
                                    <div
                                        className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${
                                            primary
                                                ? 'bg-primary'
                                                : 'border border-border bg-secondary'
                                        }`}
                                    >
                                        <Icon
                                            className={`size-4 ${
                                                primary
                                                    ? 'text-primary-foreground'
                                                    : 'text-muted-foreground'
                                            }`}
                                        />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium text-foreground">
                                            {t(`step_${key}_title`)}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {t(`step_${key}_sub`)}
                                        </p>
                                    </div>
                                    <span className="font-mono text-xs text-muted-foreground/60">
                                        {String(key).padStart(2, '0')}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default FooterCtaSection;
