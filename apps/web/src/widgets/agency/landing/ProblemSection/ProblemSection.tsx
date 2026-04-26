import { useTranslations } from 'next-intl';
import { Layers, Code2, Rocket, LucideIcon } from 'lucide-react';

const features: { key: string; icon: LucideIcon }[] = [
    { key: 'architecture', icon: Layers },
    { key: 'typed', icon: Code2 },
    { key: 'scale', icon: Rocket },
];

const ProblemSection = () => {
    const t = useTranslations('landing_page.problem');

    return (
        <section id="problem" className="scroll-mt-16 border-t border-border py-24">
            <div className="container px-6">
                <div className="max-w-2xl">
                    <span className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                        {t('label')}
                    </span>
                    <h2 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">
                        {t('heading')}
                    </h2>
                    <div className="mt-8 max-w-xl space-y-4 text-lg leading-relaxed text-muted-foreground">
                        <p>{t('paragraph_1')}</p>
                        <p>{t('paragraph_2')}</p>
                    </div>
                </div>

                <div className="mt-16 grid gap-4 md:grid-cols-3 md:gap-8">
                    {features.map(({ key, icon: Icon }) => (
                        <div
                            key={key}
                            className="rounded-lg border border-border bg-card p-6"
                        >
                            <Icon className="size-8 text-foreground" />
                            <h3 className="mt-4 text-lg font-semibold">
                                {t(`feature_${key}_title`)}
                            </h3>
                            <p className="mt-2 leading-relaxed text-muted-foreground">
                                {t(`feature_${key}_description`)}
                            </p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
};

export default ProblemSection;
