import { BriefNotificationEmail } from '../src/modules/email/templates/brief-notification';

export default function Preview() {
    return (
        <BriefNotificationEmail
            name="John Doe"
            email="john@example.com"
            description="We need a modern web application for our logistics company. The app should include real-time tracking, fleet management dashboard, and customer portal with shipment status updates."
            budget="2500_5000"
            budgetLabel="$2,500 – $5,000"
            deadline="1_3_months"
            deadlineLabel="1–3 months"
            source="google"
        />
    );
}
