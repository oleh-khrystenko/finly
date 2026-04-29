import { MAGIC_LINK_PURPOSE } from '@neatslip/types';

import { resolveTranslations } from '../src/modules/email/i18n/resolve';
import { MagicLinkEmail } from '../src/modules/email/templates/magic-link';

const t = resolveTranslations('en');

export default function Preview() {
    return (
        <MagicLinkEmail
            link="http://localhost:3000/auth/verify?token=preview"
            translations={t.magicLink[MAGIC_LINK_PURPOSE.DELETE_ACCOUNT]}
            lang="en"
        />
    );
}
