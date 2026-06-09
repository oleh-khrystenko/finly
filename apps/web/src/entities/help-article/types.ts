import type { LucideIcon } from 'lucide-react';
import type { HelpCategory as HelpCategoryData } from '@finly/types';

export type { HelpArticle } from '@finly/types';

/**
 * Web view of a category: canonical data from `@finly/types` plus the lucide
 * icon (presentation concern that does not belong in the shared content).
 */
export interface HelpCategory extends HelpCategoryData {
    icon: LucideIcon;
}
