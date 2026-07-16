import { List } from 'lucide-react';

import UiLink from '@/shared/ui/UiLink';
import type { GuideBlock } from '@/entities/guide';

import { getVisibleBlocks } from './GuideBlocks';

/** Show the TOC only when it actually aids navigation — a two-item list is noise. */
const MIN_TOC_ITEMS = 3;

/**
 * Table of contents derived automatically from block headings: the admin
 * constructor never edits it, it just falls out of the structure. Long guides
 * get scannable navigation (and heading anchors for deep links); short ones
 * stay clean.
 */
export function GuideToc({ blocks }: { blocks: GuideBlock[] }) {
    const items = getVisibleBlocks(blocks).filter(({ block }) => block.heading);
    if (items.length < MIN_TOC_ITEMS) return null;

    return (
        <nav
            aria-label="Зміст"
            className="border-border bg-muted/40 mt-6 rounded-xl border p-5"
        >
            <p className="text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-widest uppercase">
                <List className="size-3.5" aria-hidden />
                Зміст
            </p>
            <ol className="mt-3 space-y-1.5">
                {items.map(({ block, anchorId }) => (
                    <li key={anchorId}>
                        <UiLink
                            href={`#${anchorId}`}
                            variant="muted"
                            className="text-sm leading-relaxed"
                        >
                            {block.heading}
                        </UiLink>
                    </li>
                ))}
            </ol>
        </nav>
    );
}
