'use client';

import { toast } from 'sonner';
import type { QrPreviewInput } from '@finly/types';

import { useQrLandingDraftStore } from '@/entities/qr-landing-draft';
import { getApiMessage } from '@/shared/api/mapApiCode';
import { PublicApiError } from '@/shared/api/client';
import { getZodFieldError } from '@/shared/lib';
import UiButton from '@/shared/ui/UiButton';
import UiInput from '@/shared/ui/UiInput';
import UiTextarea from '@/shared/ui/UiTextarea';

import { fetchQrPreview } from './api';
import type { QrLandingFormInstance } from './QrLandingBlock';

interface QrLandingFormProps {
    form: QrLandingFormInstance;
}

/**
 * Sprint 8 §8.3 — input-секція форми. Презентаційний компонент: form-instance
 * приходить з parent-у (`QrLandingBlock`), persist + invalidate-логіка теж
 * там. Це дозволяє `QrLandingResult.handleClear` викликати `form.reset()`,
 * не дублюючи form-state і не ламаючи hydration-flow.
 *
 * **Read-only badge "Тип отримувача: Фіз особа"** робить implicit-залок
 * (sprint plan §НЕ-скоуп: anon-форма захардкожена на `'individual'`)
 * explicit для користувача.
 *
 * **Error-mapping під обмеження `publicPostJson`**: native-fetch не парсить
 * response body на non-2xx → `PublicApiError` несе тільки status. Тому
 * status-based mapping:
 *   - 429 → RATE_LIMIT_EXCEEDED → resolve через `errors.qr.rate_limit_exceeded`
 *     (placeholder-free копія, специфічна для anon QR-preview throttle 10/min;
 *     `errors.generic.rate_limit_exceeded` має `{minutes}`-placeholder, який
 *     без vars залишався б literal у toast)
 *   - 400 → PAYLOAD_TOO_LARGE (на `mode: 'onChange'` + `disabled={!isValid}`
 *     RHF блокує submit при field-помилках, тож 400 на submit — практично
 *     завжди overall-payload-size overflow з backend builder-а)
 *   - else → INTERNAL_ERROR (generic crash UA)
 *
 * Якщо у Sprint 9+ будуть нові backend-error-codes для anon-flow, треба
 * розширити `publicPostJson` парсингом body на non-2xx (additive change).
 */
export function QrLandingForm({ form }: QrLandingFormProps) {
    const setResult = useQrLandingDraftStore((s) => s.setResult);

    const {
        register,
        handleSubmit,
        formState: { errors, isValid, isSubmitting },
    } = form;

    const onSubmit = async (data: QrPreviewInput): Promise<void> => {
        try {
            const response = await fetchQrPreview(data);
            setResult(response);
        } catch (err) {
            let code: string;
            if (err instanceof PublicApiError) {
                if (err.status === 429) code = 'RATE_LIMIT_EXCEEDED';
                else if (err.status === 400) code = 'PAYLOAD_TOO_LARGE';
                else code = 'INTERNAL_ERROR';
            } else {
                // Zod parse у fetchQrPreview, network-faulures, JSON-parse
                // errors — все генерично. Користувач бачить "сталась помилка",
                // forma залишається з даними, ретрай можливий.
                code = 'INTERNAL_ERROR';
            }
            toast.error(getApiMessage(code, 'qr'));
        }
    };

    return (
        <form
            onSubmit={handleSubmit(onSubmit)}
            className="space-y-4"
            noValidate
            aria-label="Форма генерації платіжного QR-коду"
        >
            <div className="border-border bg-muted/40 rounded-md border px-3 py-2 text-sm">
                <span className="text-muted-foreground">Тип отримувача:</span>{' '}
                <span className="font-medium">Фіз особа</span>
            </div>

            <UiInput
                label="Отримувач"
                placeholder="Іваненко Олена Петрівна"
                autoComplete="name"
                {...register('receiverName')}
                error={getZodFieldError(errors.receiverName)}
            />

            <UiInput
                label="IBAN"
                placeholder="UA213223130000026007233566001"
                autoComplete="off"
                spellCheck={false}
                {...register('iban')}
                error={getZodFieldError(errors.iban)}
            />

            <UiInput
                label="РНОКПП"
                placeholder="1234567890"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={10}
                autoComplete="off"
                {...register('taxId')}
                error={getZodFieldError(errors.taxId)}
            />

            <UiTextarea
                label="Призначення платежу"
                placeholder="Поповнення рахунку"
                autoGrow
                maxRows={4}
                {...register('purpose')}
                error={getZodFieldError(errors.purpose)}
            />

            <div className="flex justify-end pt-2">
                <UiButton
                    type="submit"
                    variant="filled"
                    size="lg"
                    disabled={!isValid || isSubmitting}
                >
                    {isSubmitting ? 'Створюємо QR...' : 'Створити QR'}
                </UiButton>
            </div>
        </form>
    );
}
