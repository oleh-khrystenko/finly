'use client';

import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiPageHeading from '@/shared/ui/UiPageHeading';
import { BusinessWizardForm } from '@/features/business-wizard';

export default function BusinessNewPage() {
    return (
        <UiPageContainer className="space-y-8 py-12 md:py-16">
            <UiPageHeading>Створення бізнесу</UiPageHeading>
            <BusinessWizardForm />
        </UiPageContainer>
    );
}
