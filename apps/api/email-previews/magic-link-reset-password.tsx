import { MAGIC_LINK_PURPOSE } from '@finly/types';

import { MagicLinkEmail } from '../src/modules/email/templates/magic-link';

export default function Preview() {
    return (
        <MagicLinkEmail
            purpose={MAGIC_LINK_PURPOSE.RESET_PASSWORD}
            link="http://localhost:3000/auth/reset-password?token=preview"
        />
    );
}
