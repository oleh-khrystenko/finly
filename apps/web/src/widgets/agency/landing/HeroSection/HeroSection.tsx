import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import UiButton from '@/shared/ui/UiButton';
import ambientGlow from '../../../../../public/images/ambient-glow.png';
import StartBriefButton from '../StartBriefButton';

const HeroSection = () => {
    const t = useTranslations('landing_page.hero');
    const tBrand = useTranslations('brand');

    return (
        <section className="relative -mt-16 flex min-h-svh items-center overflow-hidden pt-28 pb-20 md:pt-36 md:pb-28">
            <div className="relative container px-6">
                <div className="mx-auto max-w-3xl text-center">
                    <div className="relative">
                        <p className="text-primary text-sm font-medium tracking-widest uppercase">
                            {tBrand('slogan')}
                        </p>

                        {/* Ambient glow — pre-baked image for consistent cross-browser rendering */}
                        <Image
                            src={ambientGlow}
                            alt=""
                            aria-hidden="true"
                            priority
                            quality={100}
                            className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-50 dark:opacity-100"
                            sizes="1088px"
                        />
                    </div>

                    <h1 className="mt-6 text-3xl font-bold tracking-tight min-[412px]:text-4xl md:text-5xl lg:text-6xl">
                        {t('heading_line1')}
                        <br />
                        {t('heading_line2')}
                    </h1>

                    <p className="text-muted-foreground mx-auto mt-6 max-w-3xl text-lg leading-relaxed md:text-xl">
                        {t('description')}
                    </p>

                    <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
                        <StartBriefButton
                            variant="filled"
                            size="lg"
                            className="w-full font-semibold sm:w-auto"
                            IconRight={<ArrowRight />}
                        >
                            {t('cta_primary')}
                        </StartBriefButton>
                        <UiButton
                            as="link"
                            href="/billing"
                            variant="outline"
                            size="lg"
                            className="w-full sm:w-auto"
                        >
                            {t('cta_secondary')}
                        </UiButton>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default HeroSection;
