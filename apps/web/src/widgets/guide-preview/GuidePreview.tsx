'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, Eye } from 'lucide-react';
import type { Guide, PublicGuide } from '@finly/types';

import UiButton from '@/shared/ui/UiButton';
import UiSpinner from '@/shared/ui/UiSpinner';
import { GuideArticleView } from '@/features/guides';
import { adminGetGuide } from '@/shared/api';

function toPublic(guide: Guide): PublicGuide {
    return {
        slug: guide.slug,
        title: guide.title,
        description: guide.description,
        authorId: guide.authorId,
        pillarSlug: guide.pillarSlug,
        blocks: guide.blocks,
        faq: guide.faq,
        datePublished: guide.datePublished,
        dateModified: guide.dateModified,
    };
}

/**
 * Draft preview rendered with the exact public article component, so what the
 * admin sees is what a reader gets after publish. Cluster links (pillar,
 * related) are omitted here — this is a single-article content preview, not a
 * navigation preview.
 *
 * Lives in `widgets` (not `admin-guides`): it composes the `guides` feature's
 * public renderer, and a feature must not import another feature — a widget may.
 */
export function GuidePreview({ guideId }: { guideId: string }) {
    const [guide, setGuide] = useState<Guide | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let active = true;
        adminGetGuide(guideId)
            .then((loaded) => {
                if (active) setGuide(loaded);
            })
            .catch(() => {
                if (active) setFailed(true);
            });
        return () => {
            active = false;
        };
    }, [guideId]);

    if (failed) {
        return (
            <main className="mx-auto max-w-3xl px-4 py-14 text-center sm:px-6">
                <p className="text-muted-foreground text-sm">
                    Не вдалося завантажити превʼю.
                </p>
            </main>
        );
    }

    if (!guide) {
        return (
            <div className="flex justify-center py-24">
                <UiSpinner size="lg" />
            </div>
        );
    }

    return (
        <>
            <div className="border-border bg-muted/40 border-b">
                <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
                    <span className="text-muted-foreground flex items-center gap-2 text-sm">
                        <Eye className="size-4" aria-hidden />
                        Превʼю
                        {guide.status === 'draft' && ' чернетки'}
                    </span>
                    <UiButton
                        as="link"
                        href={`/admin/guides/${guide.id}`}
                        variant="text"
                        size="sm"
                        IconLeft={<ArrowLeft className="size-4" />}
                    >
                        До редактора
                    </UiButton>
                </div>
            </div>
            <GuideArticleView
                guide={toPublic(guide)}
                pillar={null}
                related={[]}
            />
        </>
    );
}
