'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AxiosError } from 'axios';
import { toast } from 'sonner';
import {
    isOnboardingComplete,
    QrPreviewInputSchema,
} from '@finly/types';

import { useAuthStore } from '@/entities/user';
import { useQrLandingDraftStore } from '@/entities/qr-landing-draft';
import { getApiMessage } from '@/shared/api/mapApiCode';
import UiButton from '@/shared/ui/UiButton';
import UiQrImage from '@/shared/ui/UiQrImage';

import { claimLandingDraftAsBusiness } from './api';
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
 * **Empty-state vs Filled-state**: rendering розгалужено за `result === null`.
 * Empty показує decorative placeholder + microcopy "Ваш QR з'явиться тут".
 * Filled — реальний QR + truncated link + copy CTA + warning + claim CTA.
 *
 * **Anon vs Logged-in CTA-семантика**:
 *  - Anon (`isAuthenticated === false`): `setIntent('claim-pending')` +
 *    `router.push('/auth/signin')`. Після auth `useClaimLandingDraft`
 *    (§8.4) зчитує intent і автоматично створює бізнес.
 *  - Logged-in + complete profile: прямий виклик `claimLandingDraftAsBusiness()`.
 *  - Logged-in + incomplete profile: backend `OnboardingInterceptor` поверне
 *    403; перенаправляємо на `/profile?mode=new` зі збереженим intent —
 *    hook §8.4 продовжить claim після PATCH `/users/me`.
 *
 * **`form` prop замість read-only callback**: clear-action скидає і store, і
 * RHF-state в одному місці. Без form-handle clear лишав би `<input>`-и
 * з frozen `defaultValues` (RHF uncontrolled). Sprint plan §8.3 explicit:
 * "→ `clearAll()` + `form.reset()`".
 *
 * **`navigator.clipboard` без feature-detection**: усі сучасні browsers
 * у secure contexts (HTTPS / localhost) підтримують Clipboard API.
 * Fail-degrade на toast.error при API-throw (security restrictions,
 * відмова дозволу). Sprint 8 не implement-ить fallback через
 * `<input>` + execCommand (deprecated).
 */
export function QrLandingResult({ form }: QrLandingResultProps) {
    const result = useQrLandingDraftStore((s) => s.result);
    const formData = useQrLandingDraftStore((s) => s.formData);
    const setIntent = useQrLandingDraftStore((s) => s.setIntent);
    const clearAll = useQrLandingDraftStore((s) => s.clearAll);
    const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
    const profile = useAuthStore((s) => s.user?.profile);
    const router = useRouter();
    const [isClaiming, setIsClaiming] = useState(false);

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

    const handleClaim = async (): Promise<void> => {
        if (!isAuthenticated) {
            setIntent('claim-pending');
            router.push('/auth/signin');
            return;
        }

        if (profile && !isOnboardingComplete(profile)) {
            setIntent('claim-pending');
            router.push('/profile?mode=new');
            return;
        }

        const parsed = QrPreviewInputSchema.safeParse(formData);
        if (!parsed.success) {
            toast.error(
                'Не вдалося відновити чернетку. Створіть бізнес вручну з кабінету'
            );
            return;
        }

        setIsClaiming(true);
        try {
            const { slug } = await claimLandingDraftAsBusiness(parsed.data);
            clearAll();
            form.reset(EMPTY_FORM_VALUES);
            toast.success('Бізнес створено');
            router.replace(`/business/${slug}?completed-from=landing`);
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
            setIsClaiming(false);
        }
    };

    const handleClear = (): void => {
        clearAll();
        // form.reset з explicit empty-defaults — без аргумента RHF reset-ить
        // до initial defaultValues, які містять persisted snapshot з mount-у
        // Block-у. Нам потрібен явний "очистити до порожнього" для UX.
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
                Ці дані не зберігаються на нашому сервері. Збережіть бізнес у
                кабінет, щоб повернутися до нього пізніше.
            </div>

            <UiButton
                type="button"
                variant="filled"
                size="lg"
                onClick={handleClaim}
                disabled={isClaiming}
            >
                {isClaiming ? 'Зберігаємо...' : 'Зберегти у кабінет'}
            </UiButton>
        </div>
    );
}
