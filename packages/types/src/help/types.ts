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

export interface HelpArticle {
    slug: string;
    title: string;
    description: string;
    categoryId: string;
    order: number;
    /** Markdown. Rendered on the page and embedded into the AI knowledge base. */
    body: string;
    /** Explicit related slugs; falls back to category siblings. */
    related?: string[];
}
