import Image from 'next/image';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { GuideBlock } from '@/entities/guide';

/**
 * Universal article body: an ordered list of blocks. Rendering rule (mirrors
 * the admin constructor): a block renders only when it has text; the image
 * renders only when present. Headings are h2 — the article h1 lives in
 * GuideArticleView, so the outline stays valid whatever blocks the admin sends.
 */

/** Blocks with non-empty text, paired with a stable anchor id for the TOC. */
export function getVisibleBlocks(blocks: GuideBlock[]) {
    return blocks
        .filter((block) => block.text.trim() !== '')
        .map((block, index) => ({ block, anchorId: `block-${index + 1}` }));
}

export function GuideBlocks({ blocks }: { blocks: GuideBlock[] }) {
    return (
        <div className="mt-6 space-y-10">
            {getVisibleBlocks(blocks).map(({ block, anchorId }) => (
                <GuideBlockView
                    key={anchorId}
                    block={block}
                    anchorId={anchorId}
                />
            ))}
        </div>
    );
}

// Tables come from remark-gfm; on narrow screens they scroll inside their own
// container instead of stretching the page (docs/conventions/responsive.md).
const MARKDOWN_COMPONENTS = {
    table: (props: React.ComponentProps<'table'>) => (
        <div className="overflow-x-auto">
            <table {...props} />
        </div>
    ),
};

function GuideBlockView({
    block,
    anchorId,
}: {
    block: GuideBlock;
    anchorId: string;
}) {
    return (
        <section>
            {block.heading && (
                <h2
                    id={anchorId}
                    className="text-foreground scroll-mt-20 text-xl font-semibold tracking-tight md:text-2xl"
                >
                    {block.heading}
                </h2>
            )}

            <div
                className={`prose-help text-foreground/90 ${block.heading ? 'mt-3' : ''}`}
            >
                <Markdown
                    remarkPlugins={[remarkGfm]}
                    components={MARKDOWN_COMPONENTS}
                >
                    {block.text}
                </Markdown>
            </div>

            {block.image && (
                <figure className="mt-6">
                    <span className="border-border bg-muted/30 block overflow-hidden rounded-2xl border">
                        <Image
                            src={block.image.src}
                            alt={block.image.alt}
                            width={block.image.width}
                            height={block.image.height}
                            sizes="(max-width: 768px) 100vw, 42rem"
                            className="h-auto w-full"
                        />
                    </span>
                    {block.image.caption && (
                        <figcaption className="text-muted-foreground mt-2.5 text-center text-sm leading-relaxed">
                            {block.image.caption}
                        </figcaption>
                    )}
                </figure>
            )}
        </section>
    );
}
