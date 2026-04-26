import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import StartBriefButton from '../StartBriefButton';

const includeKeys = [
    'include_1',
    'include_2',
    'include_3',
    'include_4',
    'include_5',
] as const;

const faqKeys = [1, 2, 3, 4, 5, 6] as const;

const PricingSection = () => {
    const t = useTranslations('landing_page.pricing');

    return (
        <section
            id="pricing"
            className="scroll-mt-16 border-t border-border py-24"
        >
            <div className="container px-6">
                <div className="grid items-start gap-8 lg:grid-cols-2 lg:gap-12">
                    {/* Left column: heading + pricing card (sticky on desktop) */}
                    <div className="lg:sticky lg:top-24">
                        <span className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                            {t('label')}
                        </span>
                        <h2 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">
                            {t('heading')}
                        </h2>

                        <div className="mt-12 rounded-lg border-2 border-foreground bg-card p-6 md:p-8">
                            <p className="text-base font-medium text-foreground">
                                {t('package_label')}
                            </p>
                            <p className="mt-2 text-4xl font-bold">
                                {t('price')}
                            </p>
                            <p className="mt-2 text-muted-foreground">
                                {t('delivery')}
                            </p>

                            <p className="mb-4 mt-8 text-sm font-medium uppercase tracking-wide text-muted-foreground">
                                {t('includes_label')}
                            </p>
                            <ul className="space-y-3">
                                {includeKeys.map((key) => (
                                    <li
                                        key={key}
                                        className="flex items-start gap-3"
                                    >
                                        <Check className="mt-0.5 size-5 shrink-0 text-foreground" />
                                        <span className="text-foreground">
                                            {t(key)}
                                        </span>
                                    </li>
                                ))}
                            </ul>

                            <StartBriefButton
                                variant="filled"
                                size="lg"
                                className="mt-8 w-full justify-center"
                            >
                                {t('cta')}
                            </StartBriefButton>
                        </div>
                    </div>

                    {/* FAQ — lg:pt offsets label+heading height so FAQ aligns with the card */}
                    <div className="lg:pt-[7.5rem]">
                        <h3 className="mb-6 text-2xl font-bold tracking-tight">
                            {t('faq_heading')}
                        </h3>
                        <div className="space-y-6">
                            {faqKeys.map((n) => (
                                <div key={n}>
                                    <h4 className="font-medium text-foreground">
                                        {t(`faq_${n}_q`)}
                                    </h4>
                                    <p className="mt-2 max-w-md leading-relaxed text-muted-foreground">
                                        {t(`faq_${n}_a`)}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default PricingSection;
