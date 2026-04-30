import { MAGIC_LINK_PURPOSE } from '@neatslip/types';

import { MagicLinkEmail } from '../src/modules/email/templates/magic-link';

export default function Preview() {
    return (
        <MagicLinkEmail
            purpose={MAGIC_LINK_PURPOSE.DELETE_ACCOUNT}
            link="http://localhost:3000/auth/verify?token=preview"
        />
    );
}
