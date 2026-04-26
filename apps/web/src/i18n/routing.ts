import { defineRouting } from 'next-intl/routing';
import { LANG } from '@cyanship/types';

export const routing = defineRouting({
    locales: Object.values(LANG),

    defaultLocale: LANG.EN,
});
