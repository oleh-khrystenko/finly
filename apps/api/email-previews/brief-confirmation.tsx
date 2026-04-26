import { resolveTranslations } from '../src/modules/email/i18n/resolve';
import { BriefConfirmationEmail } from '../src/modules/email/templates/brief-confirmation';

const t = resolveTranslations('en');

export default function Preview() {
    return (
        <BriefConfirmationEmail
            name="John Doe"
            translations={t.briefConfirmation}
            lang="en"
        />
    );
}
