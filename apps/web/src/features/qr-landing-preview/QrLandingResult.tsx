'use client';

import { toast } from 'sonner';

import { useQrLandingDraftStore } from '@/entities/qr-landing-draft';
import UiButton from '@/shared/ui/UiButton';
import UiQrImage from '@/shared/ui/UiQrImage';

import type { QrLandingFormInstance } from './QrLandingBlock';
import { truncateLink } from './lib/truncateLink';

const EMPTY_FORM_VALUES = {
    receiverName: '',
    iban: '',
    taxId: '',
    purpose: 'Поповнення рахунку',
} as const;

interface QrLandingResultProps {
    form: QrLandingFormInstance;
}

/**
 * Sprint 8 §8.3 — result-pane (sibling до `QrLandingForm`).
 *
 * **Sprint 9 §Скоуп.Frontend (1):** CTA "Зберегти у кабінет" вимкнено.
 * Поточний Sprint 8 `useClaimLandingDraft` робив `POST /businesses/me` з body,
 * що містить `requisites.iban` (старий shape). Sprint 9 видалив `requisites`-
 * wrapper з `CreateBusinessSchema` — старий claim-payload reject-нувся б на
 * 400 без recovery-path-у. Sprint 10 повертає CTA з новою архітектурою (2
 * sequential POST: Business → Account + form-recovery patern). До Sprint 10
 * deploy лендінг показує тільки preview-QR без claim-action — це degradation,
 * що абсорбується відсутністю production traffic.
 *
 * **Empty-state vs Filled-state**: rendering розгалужено за `result === null`.
 * Empty показує decorative placeholder + microcopy "Ваш QR з'явиться тут".
 * Filled — реальний QR + truncated link + copy CTA + warning.
 *
 * **`form` prop замість read-only callback**: clear-action скидає і store, і
 * RHF-state в одному місці. Без form-handle clear лишав би `<input>`-и
 * з frozen `defaultValues` (RHF uncontrolled). Sprint plan §8.3 explicit:
 * "→ `clearAll()` + `form.reset()`".
 *
 * **`navigator.clipboard` без feature-detection**: усі сучасні browsers
 * у secure contexts (HTTPS / localhost) підтримують Clipboard API.
 * Fail-degrade на toast.error при API-throw (security restrictions,
 * відмова дозволу).
 */
export function QrLandingResult({ form }: QrLandingResultProps) {
    const result = useQrLandingDraftStore((s) => s.result);
    const clearAll = useQrLandingDraftStore((s) => s.clearAll);

    if (!result) {
        return (
            <div
                className="border-border bg-muted/20 flex aspect-square w-full max-w-sm flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-8 text-center"
                aria-label="Превʼю QR-коду — порожньо"
            >
                <div
                    aria-hidden
                    className="border-muted-foreground/30 grid grid-cols-3 grid-rows-3 gap-1 opacity-40"
                >
                    {Array.from({ length: 9 }).map((_, i) => (
                        <div
                            key={i}
                            className="bg-muted-foreground/30 h-6 w-6 rounded"
                        />
                    ))}
                </div>
                <p className="text-muted-foreground text-sm">
                    Ваш QR-код зʼявиться тут після введення даних
                </p>
            </div>
        );
    }

    const handleCopyLink = async (): Promise<void> => {
        try {
            await navigator.clipboard.writeText(result.link);
            toast.success('Посилання скопійовано');
        } catch {
            toast.error('Не вдалося скопіювати. Скопіюйте вручну');
        }
    };

    const handleClear = (): void => {
        clearAll();
        form.reset(EMPTY_FORM_VALUES);
        toast.success('Дані очищено');
    };

    return (
        <div className="flex flex-col gap-4">
            <UiQrImage
                src={`data:image/png;base64,${result.qrPngBase64}`}
                alt="Платіжний QR-код за стандартом НБУ"
                className="border-border bg-card w-full max-w-sm rounded-xl border p-4"
            />

            <div className="border-border bg-muted/20 rounded-md border px-3 py-2">
                <p className="text-muted-foreground mb-1 text-xs">
                    Універсальне посилання
                </p>
                <code className="text-foreground block break-all font-mono text-sm">
                    {truncateLink(result.link)}
                </code>
            </div>

            <div className="flex flex-wrap gap-2">
                <UiButton
                    type="button"
                    variant="outline"
                    size="md"
                    onClick={handleCopyLink}
                >
                    Скопіювати посилання
                </UiButton>
                <UiButton
                    type="button"
                    variant="text"
                    size="md"
                    onClick={handleClear}
                >
                    Очистити
                </UiButton>
            </div>

            <div
                role="note"
                className="border-border bg-muted/30 text-muted-foreground rounded-md border px-3 py-2 text-sm"
            >
                Ці дані не зберігаються на нашому сервері.
            </div>
        </div>
    );
}
