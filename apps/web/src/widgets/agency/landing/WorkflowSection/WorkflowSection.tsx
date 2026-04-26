import { useTranslations } from 'next-intl';
import { MessageSquare, Video, GitBranch, LucideIcon } from 'lucide-react';

const steps: { key: string; icon: LucideIcon }[] = [
    { key: 'async', icon: MessageSquare },
    { key: 'video', icon: Video },
    { key: 'code', icon: GitBranch },
];

const WorkflowSection = () => {
    const t = useTranslations('landing_page.workflow');

    return (
        <section id="workflow" className="scroll-mt-16 border-t border-border py-24">
            <div className="container px-6">
                <div className="max-w-2xl">
                    <span className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                        {t('label')}
                    </span>
                    <h2 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">
                        {t('heading')}
                    </h2>
                    <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
                        {t('description')}
                    </p>
                </div>

                <div className="mt-16 grid gap-4 md:grid-cols-3 md:gap-6">
                    {steps.map(({ key, icon: Icon }) => (
                        <div
                            key={key}
                            className="rounded-lg border border-border bg-card p-6"
                        >
                            <div className="flex size-12 items-center justify-center rounded-lg border border-border bg-secondary">
                                <Icon className="size-6 text-foreground" />
                            </div>
                            <h3 className="mt-5 text-lg font-semibold">
                                {t(`step_${key}_title`)}
                            </h3>
                            <p className="mt-2 max-w-sm leading-relaxed text-muted-foreground">
                                {t(`step_${key}_description`)}
                            </p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
};

export default WorkflowSection;
