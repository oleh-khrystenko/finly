import { Plus } from 'lucide-react';

import type { GuideFaqItem } from '@/entities/guide';

/**
 * FAQ block after the article body. Native <details>, no client JS — same
 * pattern as the landing FAQ. The FAQPage structured data is emitted by the
 * page route (single JSON-LD @graph), this component only renders the visible
 * part from the same `faq` source, so markup and UI cannot drift.
 */
export function GuideFaq({ faq }: { faq: GuideFaqItem[] }) {
    if (!faq.length) return null;

    return (
        <section className="mt-10" aria-labelledby="faq-heading">
            <h2
                id="faq-heading"
                className="text-foreground text-xl font-semibold tracking-tight md:text-2xl"
            >
                Часті запитання
            </h2>
            <div className="divide-border/70 mt-2 divide-y">
                {faq.map((item, index) => (
                    <details key={index} className="group py-4">
                        <summary className="text-foreground flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                            {item.question}
                            <Plus
                                aria-hidden
                                className="text-muted-foreground size-5 shrink-0 transition-transform group-open:rotate-45"
                            />
                        </summary>
                        <p className="text-muted-foreground mt-3 text-base leading-relaxed">
                            {item.answer}
                        </p>
                    </details>
                ))}
            </div>
        </section>
    );
}
