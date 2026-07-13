/**
 * Help-center content model. Canonical source of truth (Sprint 16): the same
 * data renders the public help pages on web and grounds the AI help assistant
 * on api. No icons here (presentation concern, lives on web).
 */
export interface HelpCategory {
    id: string;
    title: string;
    description: string;
}

/**
 * Article author (E-E-A-T, Sprint 24). A named practitioner is a strong trust
 * signal for money/tax topics. One author at launch, but the model supports
 * several. Used for the visible byline and the Person node in structured data.
 */
export interface HelpAuthor {
    id: string;
    /** Full name, as shown in the byline and schema. */
    name: string;
    /** Professional role, e.g. "Бухгалтер-аудитор, засновниця EasyFin". */
    role: string;
    /** Short bio, one or two sentences. */
    bio: string;
    /** Web-served static portrait path, e.g. "/partners/tetiana-priadko.webp". */
    photo: string;
    /** Organization the author works for (Person.worksFor in schema). */
    worksFor?: { name: string; url: string };
    /**
     * External profiles that corroborate the author's identity (Person.sameAs).
     * The stronger the external proof, the stronger the E-E-A-T signal.
     */
    sameAs?: string[];
}

export interface HelpArticle {
    slug: string;
    title: string;
    description: string;
    categoryId: string;
    order: number;
    /** References HelpAuthor.id. Drives the byline and Article.author schema. */
    authorId: string;
    /** ISO date (YYYY-MM-DD) of first publication. */
    datePublished: string;
    /**
     * ISO date (YYYY-MM-DD) of the last meaningful content change. Maintained
     * by hand: bump only on a real edit, otherwise the freshness signal lies.
     */
    dateModified: string;
    /** Markdown. Rendered on the page and embedded into the AI knowledge base. */
    body: string;
    /** Explicit related slugs; falls back to category siblings. */
    related?: string[];
}
