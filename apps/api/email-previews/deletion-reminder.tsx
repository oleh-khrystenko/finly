import { resolveTranslations } from '../src/modules/email/i18n/resolve';
import { DeletionReminderEmail } from '../src/modules/email/templates/deletion-reminder';

const t = resolveTranslations('en');

export default function Preview() {
    return (
        <DeletionReminderEmail
            signInUrl="http://localhost:3000/auth/signin"
            translations={t.deletionReminder}
            formattedDate="April 23, 2026"
            lang="en"
        />
    );
}
