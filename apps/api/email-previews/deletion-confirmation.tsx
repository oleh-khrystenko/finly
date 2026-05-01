import { DeletionConfirmationEmail } from '../src/modules/email/templates/deletion-confirmation';

export default function Preview() {
    return (
        <DeletionConfirmationEmail
            signInUrl="http://localhost:3000/auth/signin"
            formattedDate="23 квітня 2026 р."
            graceDays={2}
        />
    );
}
