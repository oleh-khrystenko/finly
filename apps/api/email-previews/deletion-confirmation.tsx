import { resolveTranslations } from '../src/modules/email/i18n/resolve';
import { DeletionConfirmationEmail } from '../src/modules/email/templates/deletion-confirmation';

const t = resolveTranslations('en');

export default function Preview() {
    return (
        <DeletionConfirmationEmail
            signInUrl="http://localhost:3000/auth/signin"
            translations={{
                ...t.deletionConfirmation,
                instruction: t.deletionConfirmation.instruction(2),
            }}
            formattedDate="April 23, 2026"
            lang="en"
        />
    );
}
