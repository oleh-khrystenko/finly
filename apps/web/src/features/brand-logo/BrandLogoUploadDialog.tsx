'use client';

import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
    BRAND_COMMIT_OUTCOME,
    BRAND_DISPLAY_NAME_MAX_LENGTH,
    BRAND_LOGO,
} from '@finly/types';

import {
    UiModal,
    UiModalContent,
    UiModalHeader,
    UiModalTitle,
} from '@/shared/ui/UiModal';
import UiButton from '@/shared/ui/UiButton';
import UiInput from '@/shared/ui/UiInput';
import UiQrImage from '@/shared/ui/UiQrImage';
import UiSpinner from '@/shared/ui/UiSpinner';
import {
    commitBrandLogo,
    extractApiErrorCode,
    getApiMessage,
    previewBrandLogo,
    requestBrandLogoUploadUrl,
    uploadBrandLogoToR2,
} from '@/shared/api';

import { useBrandLogoDialogStore } from './brandLogoDialogStore';

type Phase = 'pick' | 'preview';

const ACCEPT_MIME = BRAND_LOGO.ALLOWED_MIME_TYPES.join(',');
const MAX_MB = Math.round(BRAND_LOGO.MAX_FILE_SIZE / (1024 * 1024));
const PREVIEW_DEBOUNCE_MS = 400;
// Фізична стеля інпута: буфер над контрактним лімітом, щоб перевищення (ввід чи
// вставка) було видно через лічильник і помилку, а не «мертву» клавіатуру на межі.
const NAME_INPUT_HARD_CAP = BRAND_DISPLAY_NAME_MAX_LENGTH + 5;

function normalizeName(value: string): string | null {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
}

export default function BrandLogoUploadDialog() {
    const isOpen = useBrandLogoDialogStore((s) => s.isOpen);
    const close = useBrandLogoDialogStore((s) => s.close);
    const businessSlug = useBrandLogoDialogStore((s) => s.businessSlug);
    const subscribePriceLabel = useBrandLogoDialogStore(
        (s) => s.subscribePriceLabel
    );
    const onSubscribe = useBrandLogoDialogStore((s) => s.onSubscribe);
    const onApplied = useBrandLogoDialogStore((s) => s.onApplied);

    const [phase, setPhase] = useState<Phase>('pick');
    const [fileKey, setFileKey] = useState<string | null>(null);
    const [displayName, setDisplayName] = useState('');
    const [pagePng, setPagePng] = useState<string | null>(null);
    const [nbuPng, setNbuPng] = useState<string | null>(null);
    const [busy, setBusy] = useState(false); // upload / preview in-flight
    const [saving, setSaving] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [paywall, setPaywall] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);
    // Остання назва, для якої вже отримано прев'ю — щоб debounce-ефект не
    // дублював початковий рендер після завантаження файлу.
    const lastPreviewedName = useRef<string | null>(null);

    const resetAll = () => {
        setPhase('pick');
        setFileKey(null);
        setDisplayName('');
        setPagePng(null);
        setNbuPng(null);
        setBusy(false);
        setSaving(false);
        setErrorMessage(null);
        setPaywall(false);
        lastPreviewedName.current = null;
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleOpenChange = (open: boolean) => {
        if (open) return;
        if (busy || saving) return; // protect in-flight work
        resetAll();
        close();
    };

    const runPreview = async (key: string, name: string | null) => {
        if (!businessSlug) return;
        setBusy(true);
        setErrorMessage(null);
        try {
            const result = await previewBrandLogo(businessSlug, key, name);
            setPagePng(result.pagePngBase64);
            setNbuPng(result.nbuPngBase64);
            lastPreviewedName.current = name;
        } catch (err) {
            setPagePng(null);
            setNbuPng(null);
            setErrorMessage(getApiMessage(extractApiErrorCode(err), 'storage'));
        } finally {
            setBusy(false);
        }
    };

    const processFile = async (file: File): Promise<void> => {
        if (!businessSlug) return;
        if (file.size > BRAND_LOGO.MAX_FILE_SIZE) {
            toast.error(`Файл завеликий. Максимальний розмір ${MAX_MB} МБ`);
            return;
        }
        const mimeOk = (
            BRAND_LOGO.ALLOWED_MIME_TYPES as readonly string[]
        ).includes(file.type);
        if (!mimeOk) {
            toast.error(
                'Непідтримуваний формат. Використовуйте PNG, JPEG або WebP'
            );
            return;
        }

        setPhase('preview');
        setBusy(true);
        setErrorMessage(null);
        try {
            const { uploadUrl, fileKey: key } = await requestBrandLogoUploadUrl(
                businessSlug,
                file.type
            );
            await uploadBrandLogoToR2(uploadUrl, file);
            setFileKey(key);
            await runPreview(key, normalizeName(displayName));
        } catch (err) {
            setBusy(false);
            setPhase('pick');
            toast.error(getApiMessage(extractApiErrorCode(err), 'storage'));
        }
    };

    const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) void processFile(file);
    };

    // Live-прев'ю при зміні назви (debounce). Пропускаємо, поки назва збігається
    // з уже відрендереною (зокрема початковий рендер після завантаження).
    useEffect(() => {
        if (phase !== 'preview' || !fileKey || busy) return;
        if (displayName.length > BRAND_DISPLAY_NAME_MAX_LENGTH) return;
        const name = normalizeName(displayName);
        if (name === lastPreviewedName.current) return;
        const handle = setTimeout(() => {
            void runPreview(fileKey, name);
        }, PREVIEW_DEBOUNCE_MS);
        return () => clearTimeout(handle);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [displayName, phase, fileKey]);

    const handleSave = async () => {
        if (!businessSlug || !fileKey || saving || busy || errorMessage) return;
        if (displayName.length > BRAND_DISPLAY_NAME_MAX_LENGTH) return;
        setSaving(true);
        try {
            const result = await commitBrandLogo(
                businessSlug,
                fileKey,
                normalizeName(displayName)
            );
            onApplied?.(result.brand);
            if (result.outcome === BRAND_COMMIT_OUTCOME.ACTIVE) {
                toast.success('Бренд оновлено');
                resetAll();
                close();
            } else {
                // Free: лого збережено у pending, показуємо пейвол інлайн.
                setPaywall(true);
            }
        } catch (err) {
            toast.error(getApiMessage(extractApiErrorCode(err), 'storage'));
        } finally {
            setSaving(false);
        }
    };

    const handlePickAnother = () => {
        if (busy || saving) return;
        setFileKey(null);
        setPagePng(null);
        setNbuPng(null);
        setErrorMessage(null);
        lastPreviewedName.current = null;
        setPhase('pick');
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const nameLength = displayName.length;
    const nameOverflow = nameLength > BRAND_DISPLAY_NAME_MAX_LENGTH;

    return (
        <UiModal open={isOpen} onOpenChange={handleOpenChange}>
            <UiModalContent>
                <UiModalHeader>
                    <UiModalTitle>Логотип бренду</UiModalTitle>
                </UiModalHeader>
                <div className="space-y-4 px-4 pb-6">
                    {paywall ? (
                        <PaywallView
                            subscribePriceLabel={subscribePriceLabel ?? ''}
                            onSubscribe={onSubscribe}
                        />
                    ) : phase === 'pick' ? (
                        <div className="space-y-4">
                            <p className="text-muted-foreground text-sm">
                                Логотип показується в обох QR-кодах і на
                                платіжних сторінках. Він єдиний для всіх
                                реквізитів і рахунків цього отримувача.
                            </p>
                            <div className="border-border flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center">
                                <UiButton
                                    type="button"
                                    variant="outline"
                                    size="md"
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    Оберіть файл
                                </UiButton>
                                <p className="text-muted-foreground text-sm">
                                    PNG, JPEG або WebP, до {MAX_MB} МБ. Квадрат
                                    або горизонтальний (не вертикальний).
                                </p>
                                <p className="text-muted-foreground text-sm">
                                    Найкраще працює логотип на прозорому або
                                    білому тлі.
                                </p>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept={ACCEPT_MIME}
                                    onChange={handleFileInputChange}
                                    className="sr-only"
                                />
                            </div>
                            {errorMessage && (
                                <p className="text-destructive text-sm">
                                    {errorMessage}
                                </p>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <PreviewTile
                                    label="Сторінковий QR"
                                    src={pagePng}
                                    busy={busy}
                                />
                                <PreviewTile
                                    label="QR для оплати в банку"
                                    src={nbuPng}
                                    busy={busy}
                                    emptyHint="Зʼявиться, коли додасте перші реквізити"
                                />
                            </div>

                            {errorMessage && (
                                <p className="text-destructive text-sm">
                                    {errorMessage}
                                </p>
                            )}

                            <div>
                                <UiInput
                                    label="Назва поряд з логотипом (необовʼязково)"
                                    value={displayName}
                                    maxLength={NAME_INPUT_HARD_CAP}
                                    onChange={(e) =>
                                        setDisplayName(e.target.value)
                                    }
                                    placeholder="Наприклад, назва кавʼярні"
                                    error={
                                        nameOverflow
                                            ? `Не більше ${BRAND_DISPLAY_NAME_MAX_LENGTH} символів`
                                            : undefined
                                    }
                                />
                                <div className="mt-1 flex items-center justify-between">
                                    <span className="text-muted-foreground text-sm">
                                        Косметичний підпис, не впливає на платіж.
                                    </span>
                                    <span
                                        className={
                                            nameOverflow
                                                ? 'text-destructive text-sm'
                                                : 'text-muted-foreground text-sm'
                                        }
                                        aria-live="polite"
                                    >
                                        {nameLength} /{' '}
                                        {BRAND_DISPLAY_NAME_MAX_LENGTH}
                                    </span>
                                </div>
                            </div>

                            <div className="flex justify-between gap-3">
                                <UiButton
                                    type="button"
                                    variant="text"
                                    size="md"
                                    onClick={handlePickAnother}
                                    disabled={busy || saving}
                                >
                                    Обрати інший файл
                                </UiButton>
                                <UiButton
                                    type="button"
                                    variant="filled"
                                    size="md"
                                    onClick={handleSave}
                                    disabled={
                                        busy ||
                                        !!errorMessage ||
                                        !fileKey ||
                                        nameOverflow
                                    }
                                    loading={saving}
                                >
                                    Зберегти
                                </UiButton>
                            </div>
                        </div>
                    )}
                </div>
            </UiModalContent>
        </UiModal>
    );
}

function PreviewTile({
    label,
    src,
    busy,
    emptyHint,
}: {
    label: string;
    src: string | null;
    busy: boolean;
    emptyHint?: string;
}) {
    return (
        <div className="space-y-2">
            <p className="text-muted-foreground text-sm">{label}</p>
            <div className="bg-muted/50 flex min-h-40 items-center justify-center rounded-lg p-3">
                {busy ? (
                    <UiSpinner size="md" />
                ) : src ? (
                    <UiQrImage
                        src={`data:image/png;base64,${src}`}
                        alt={label}
                        className="max-w-44"
                    />
                ) : (
                    <p className="text-muted-foreground px-2 text-center text-sm">
                        {emptyHint ?? 'Прев’ю недоступне'}
                    </p>
                )}
            </div>
        </div>
    );
}

function PaywallView({
    subscribePriceLabel,
    onSubscribe,
}: {
    subscribePriceLabel: string;
    onSubscribe?: () => void;
}) {
    return (
        <div className="space-y-4">
            <p className="text-foreground text-base">
                Логотип збережено. Кастомний бренд доступний на тарифі «Бренд», і
                логотип застосується автоматично після оплати.
            </p>
            <UiButton
                type="button"
                variant="filled"
                size="md"
                onClick={onSubscribe}
                className="w-full"
            >
                {subscribePriceLabel}
            </UiButton>
        </div>
    );
}
