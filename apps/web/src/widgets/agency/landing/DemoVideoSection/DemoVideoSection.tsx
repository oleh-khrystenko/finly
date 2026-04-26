import { useTranslations } from 'next-intl';
import { KeyRound, CreditCard, Sparkles, Activity, LucideIcon } from 'lucide-react';
import { DEMO_VIDEO, DEMO_VIDEO_ENABLED } from '@/shared/config/env';
import DemoVideoPlayer from './DemoVideoPlayer';

const highlights: { key: string; icon: LucideIcon }[] = [
    { key: 'auth', icon: KeyRound },
    { key: 'billing', icon: CreditCard },
    { key: 'ai', icon: Sparkles },
    { key: 'dashboard', icon: Activity },
];

const DemoVideoSection = () => {
    const t = useTranslations('landing_page.demo_video');

    if (!DEMO_VIDEO_ENABLED || !DEMO_VIDEO) return null;

    return (
        <section id="demo" className="scroll-mt-16 border-t border-border py-24">
            <div className="container px-6">
                <div className="max-w-2xl">
                    <span className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                        {t('label')}
                    </span>
                    <h2 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">
                        {t('heading')}
                    </h2>
                </div>

                <div className="mt-8 grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
                    <div>
                        <p className="max-w-xl text-lg leading-relaxed text-muted-foreground">
                            {t('description')}
                        </p>

                        <ul className="mt-10 space-y-4">
                            {highlights.map(({ key, icon: Icon }) => (
                                <li key={key} className="flex items-center gap-4">
                                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary">
                                        <Icon className="size-4 text-muted-foreground" />
                                    </div>
                                    <span className="text-sm text-muted-foreground">
                                        {t(`highlight_${key}`)}
                                    </span>
                                </li>
                            ))}
                        </ul>

                        <p className="mt-8 text-sm font-medium text-foreground">
                            {t('note')}
                        </p>
                    </div>

                    <DemoVideoPlayer
                        title={t('heading')}
                        src={DEMO_VIDEO.src}
                        poster={DEMO_VIDEO.poster}
                        playLabel={t('play_button')}
                    />
                </div>
            </div>
        </section>
    );
};

export default DemoVideoSection;
