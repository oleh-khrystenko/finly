import { DeletionReminderEmail } from '../src/modules/email/templates/deletion-reminder';

export default function Preview() {
    return (
        <DeletionReminderEmail
            signInUrl="http://localhost:3000/auth/signin"
            formattedDate="23 квітня 2026 р."
        />
    );
}
