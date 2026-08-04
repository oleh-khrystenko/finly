import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { notFound } from 'next/navigation';
import { ImageResponse } from 'next/og';

import { getAllArticleSlugs, getArticleBySlug } from '@/entities/help-article';
import { OG_COLORS } from '@/shared/styles/ogColors';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Довідка Finly';

/** Pre-render one banner per article at build time (params are all static). */
export function generateStaticParams() {
    return getAllArticleSlugs().map((slug) => ({ slug }));
}

const FONT_DIR = join(process.cwd(), 'src/shared/fonts/ttf');

// satori не читає CSS-змінних теми — літерали живуть у shared/styles/ogColors.
const {
    background: BG,
    accent: ACCENT,
    title: TITLE,
    muted: MUTED,
} = OG_COLORS;

export default async function Image({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;
    const article = getArticleBySlug(slug);
    // Guard on-demand rendering for unknown slugs (dynamicParams defaults to
    // true), same as the page route. Avoids a runtime font read in standalone.
    if (!article) notFound();
    const title = article.title;

    const [regular, bold] = await Promise.all([
        readFile(join(FONT_DIR, 'mulish-400.ttf')),
        readFile(join(FONT_DIR, 'mulish-700.ttf')),
    ]);

    return new ImageResponse(
        <div
            style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                padding: '80px',
                backgroundColor: BG,
                backgroundImage: OG_COLORS.glow,
                fontFamily: 'Mulish',
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div
                    style={{
                        display: 'flex',
                        width: '44px',
                        height: '44px',
                        borderRadius: '12px',
                        background: ACCENT,
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: BG,
                        fontSize: '30px',
                        fontWeight: 700,
                    }}
                >
                    ₴
                </div>
                <span
                    style={{
                        fontSize: '26px',
                        fontWeight: 700,
                        color: ACCENT,
                        letterSpacing: '0.04em',
                    }}
                >
                    Довідка Finly
                </span>
            </div>

            <div
                style={{
                    display: 'flex',
                    fontSize: '68px',
                    fontWeight: 700,
                    lineHeight: 1.1,
                    color: TITLE,
                    maxWidth: '1000px',
                }}
            >
                {title}
            </div>

            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    fontSize: '28px',
                    color: MUTED,
                }}
            >
                Платіжні QR-коди і рахунки за стандартом НБУ · finly.com.ua
            </div>
        </div>,
        {
            ...size,
            fonts: [
                { name: 'Mulish', data: regular, weight: 400, style: 'normal' },
                { name: 'Mulish', data: bold, weight: 700, style: 'normal' },
            ],
        }
    );
}
