'use client';

import { useState } from 'react';
import { AxiosError } from 'axios';
import { toast } from 'sonner';
import { useRouter, useSearchParams } from 'next/navigation';
import {
    CreateBusinessSchema,
    businessPaymentPurposeTemplateSchema,
} from '@finly/types';
import { createBusiness, getApiMessage } from '@/shared/api';
import { paymentPurposeTemplateFieldConfig } from '@/entities/business';
import { mapValidationCode } from '@/shared/lib';
import UiTextarea from '@/shared/ui/UiTextarea';
import UiButton from '@/shared/ui/UiButton';
import {
    buildCreateRequestFromDraft,
    useBusinessWizardStore,
} from './businessWizardStore';

export default function Step4Purpose() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const fromLanding = searchParams.get('from') === 'landing';
    const formData = useBusinessWizardStore((s) => s.formData);
    const patch = useBusinessWizardStore((s) => s.patchFormData);
    const setStep = useBusinessWizardStore((s) => s.setStep);
    const prevStep = useBusinessWizardStore((s) => s.prevStep);
    const reset = useBusinessWizardStore((s) => s.reset);

    const [purpose, setPurpose] = useState<string>(
        formData.paymentPurposeTemplate ?? ''
    );
    const [purposeError, setPurposeError] = useState<string | undefined>();
    const [submitting, setSubmitting] = useState(false);

    const purposeFieldConfig = paymentPurposeTemplateFieldConfig(
        formData.type ?? 'individual'
    );

    const purposeParse =
        businessPaymentPurposeTemplateSchema.safeParse(purpose);
    const canSubmit = purposeParse.success;

    const onPurposeBlur = () => {
        if (!purposeParse.success) {
            setPurposeError(
                mapValidationCode(purposeParse.error.issues[0]?.message)
            );
        } else {
            setPurposeError(undefined);
        }
    };

    const onSubmit = async () => {
        if (!canSubmit) return;

        // Sprint 3 §3.7 + Sprint 7 §7.7 — фінальна валідація через
        // `CreateBusinessSchema` перед submit. Захист від stale sessionStorage
        // / drift у store. Sprint 7 додав discriminated-union dispatch:
        // `buildCreateRequestFromDraft` маппить flat draft у потрібний
        // variant per `type`, відсікаючи stale taxation-поля для
        // individual/organization (інакше `.strict()` reject-нув би).
        let request;
        try {
            request = buildCreateRequestFromDraft({
                ...formData,
                paymentPurposeTemplate: purpose,
            });
        } catch {
            toast.error(
                'Дані форми застаріли. Будь ласка, заповніть кроки заново.'
            );
            setStep('type-name');
            return;
        }
        const parsed = CreateBusinessSchema.safeParse(request);
        if (!parsed.success) {
            toast.error(
                'Дані форми застаріли. Будь ласка, заповніть кроки заново.'
            );
            setStep('type-name');
            return;
        }

        setSubmitting(true);
        patch({ paymentPurposeTemplate: purpose });
        try {
            const created = await createBusiness(parsed.data);
            reset();
            // Sprint 10 §10.2 — recovery після failure POST1 anon-claim.
            // Wizard зберіг business; передаємо естафету на account-create-
            // форму з тим самим landing-draft (IBAN читається з
            // `qrLandingDraftStore.formData.iban`). Draft не чистимо — це
            // зробить account-create на повний success.
            if (fromLanding) {
                router.replace(
                    `/business/${created.slug}/account/new?from=landing`
                );
            } else {
                router.replace(`/business/${created.slug}`);
            }
        } catch (err) {
            const code =
                err instanceof AxiosError
                    ? (
                          err.response?.data as
                              | { error?: { code?: string } }
                              | undefined
                      )?.error?.code
                    : undefined;
            toast.error(getApiMessage(code ?? 'unknown', 'businesses'));
            setSubmitting(false);
        }
    };

    return (
        <div className="space-y-6">
            <UiTextarea
                label={purposeFieldConfig.label}
                placeholder={purposeFieldConfig.placeholder}
                description={purposeFieldConfig.description}
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                onBlur={onPurposeBlur}
                error={purposeError}
                autoGrow
                maxRows={4}
            />

            <div className="flex justify-between">
                <UiButton
                    type="button"
                    variant="outline"
                    size="md"
                    disabled={submitting}
                    onClick={() => prevStep()}
                >
                    Назад
                </UiButton>
                <UiButton
                    type="button"
                    variant="filled"
                    size="md"
                    disabled={!canSubmit}
                    loading={submitting}
                    onClick={onSubmit}
                >
                    Створити
                </UiButton>
            </div>
        </div>
    );
}
