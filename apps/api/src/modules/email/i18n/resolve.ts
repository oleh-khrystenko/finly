import { type Lang, DEFAULT_LANG } from '@cyanship/types';

import type { EmailTranslations } from './types';
import { en } from './en';
import { uk } from './uk';

const translationMap: Record<Lang, EmailTranslations> = { uk, en };

export function resolveTranslations(lang: string): EmailTranslations {
    return translationMap[lang as Lang] ?? translationMap[DEFAULT_LANG];
}
