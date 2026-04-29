import { defineRouting } from 'next-intl/routing';
import { LANG } from '@neatslip/types';

export const routing = defineRouting({
    locales: Object.values(LANG),

    defaultLocale: LANG.EN,
});
