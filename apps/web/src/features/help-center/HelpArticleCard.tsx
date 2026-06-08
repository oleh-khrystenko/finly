import { ArrowRight } from 'lucide-react';

import UiLink from '@/shared/ui/UiLink';
import type { HelpArticle } from '@/entities/help-article';

export function HelpArticleCard({ article }: { article: HelpArticle }) {
    return (
        <UiLink
            as="link"
            href={`/help/${article.slug}`}
            variant="unstyled"
            className="group border-border bg-card hover:border-primary/40 hover:bg-muted/30 block h-full rounded-xl border p-5 transition-colors"
        >
            <div className="flex items-start justify-between gap-3">
                <h3 className="text-foreground font-medium">{article.title}</h3>
                <ArrowRight className="text-muted-foreground group-hover:text-primary mt-0.5 size-4 shrink-0 transition-colors" />
            </div>
            <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
                {article.description}
            </p>
        </UiLink>
    );
}
