'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { isOnboardingComplete, LandingDraftSchema } from '@finly/types';

import { useAuthStore } from '@/entities/user';
import { useQrLandingDraftStore } from '@/entities/qr-landing-draft';
import UiButton from '@/shared/ui/UiButton';
import UiQrImage from '@/shared/ui/UiQrImage';

import type { QrLandingFormInstance } from './QrLandingBlock';
import { runClaimChain } from './runClaimChain';
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
 * Sprint 8 §8.3 / Sprint 10 §10.2 — result-pane (sibling до `QrLandingForm`).
 *
 * **Anon vs Logged-in CTA-семантика**:
 *  - Anon: `setIntent('claim-pending')` → `router.push('/auth/signin')`. Atomic
 *    `setIntent('claim-pending')` генерує `claimIdempotencyKey` через
 *    `crypto.randomUUID()`. Sprint 10 signin-page прокине draft + key +
 *    termsVersion у `sendMagicLink` — backend виконає claim після verify.
 *  - Logged-in + complete profile: 2-step claim chain через спільний
 *    `runClaimChain`-helper (той самий, що `useClaimLandingDraft` для
 *    post-magic-link-flow).
 *  - Logged-in + incomplete profile: redirect на `/profile?mode=new` зі
 *    збереженим intent — `useClaimLandingDraft` у protected-layout продовжить
 *    claim після PATCH `/users/me`.
 */
export function QrLandingResult({ form }: QrLandingResultProps) {
    const result = useQrLandingDraftStore((s) => s.result);
    const formData = useQrLandingDraftStore((s) => s.formData);
    const setIntent = useQrLandingDraftStore((s) => s.setIntent);
    const setFormData = useQrLandingDraftStore((s) => s.setFormData);
    const clearAll = useQrLandingDraftStore((s) => s.clearAll);
    const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
    const profile = useAuthStore((s) => s.user?.profile);
    const router = useRouter();
    const [isClaiming, setIsClaiming] = useState(false);

    if (!result) {
        return (
            <div className="mx-auto w-full max-w-md">
                <div
                    className="border-border bg-muted/20 flex aspect-square w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-8 text-center"
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

        const parsed = LandingDraftSchema.safeParse(formData);
        if (!parsed.success) {
            toast.error(
                'Не вдалося відновити чернетку. Створіть отримувача вручну з кабінету'
            );
            return;
        }

        // Stamp idempotency-key через ту саму atomic setIntent-транзицію,
        // що anon-CTA — той самий lifecycle-pattern на обох code-paths.
        setIntent('claim-pending');
        const idempotencyKey =
            useQrLandingDraftStore.getState().claimIdempotencyKey;
        if (!idempotencyKey) {
            toast.error('Не вдалося ініціалізувати збереження. Спробуйте ще раз');
            return;
        }

        setIsClaiming(true);
        try {
            await runClaimChain(parsed.data, idempotencyKey, {
                setIntent,
                setFormData,
                clearAll,
                router,
                onSuccessFormReset: () => form.reset(EMPTY_FORM_VALUES),
            });
        } finally {
            setIsClaiming(false);
        }
    };

    const handleClear = (): void => {
        clearAll();
        form.reset(EMPTY_FORM_VALUES);
        toast.success('Дані очищено');
    };

    return (
        <div className="mx-auto flex w-full max-w-md flex-col gap-4">
            <UiQrImage
                src={`data:image/png;base64,${result.qrPngBase64}`}
                alt="Платіжний QR-код за стандартом НБУ"
                className="border-border bg-card w-full rounded-xl border"
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
                Ці дані не зберігаються на нашому сервері. Збережіть отримувача
                в кабінет, щоб повернутися до нього пізніше.
            </div>

            <UiButton
                type="button"
                variant="filled"
                size="lg"
                className="w-full"
                onClick={handleClaim}
                disabled={isClaiming}
            >
                {isClaiming ? 'Зберігаємо...' : 'Зберегти у кабінет'}
            </UiButton>
        </div>
    );
}
