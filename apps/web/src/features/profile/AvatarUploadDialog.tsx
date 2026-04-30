'use client';

import {
    type ChangeEvent,
    type DragEvent,
    useEffect,
    useRef,
    useState,
} from 'react';
import { toast } from 'sonner';
import Cropper, { type Area } from 'react-easy-crop';
import { AxiosError } from 'axios';
import { AVATAR, RESPONSE_CODE } from '@neatslip/types';

import {
    UiModal,
    UiModalContent,
    UiModalHeader,
    UiModalTitle,
} from '@/shared/ui/UiModal';
import UiButton from '@/shared/ui/UiButton';
import UiSpinner from '@/shared/ui/UiSpinner';
import { composeClasses } from '@/shared/lib';
import {
    commitAvatarUpload,
    requestAvatarUploadUrl,
    uploadToR2,
} from '@/shared/api';
import { useAuthStore } from '@/entities/user';

import { useAvatarUploadDialogStore } from './avatarUploadDialogStore';
import { useAvatarDeleteConfirmDialogStore } from './avatarDeleteConfirmDialogStore';
import { cropImage } from './lib/cropImage';

type Phase = 'idle' | 'crop';

const ACCEPT_MIME = AVATAR.ALLOWED_MIME_TYPES.join(',');

const UPLOAD_ERROR_MESSAGES: Record<string, string> = {
    avatar_upload_failed: 'Не вдалося завантажити фото. Спробуйте пізніше',
    avatar_file_key_invalid:
        'Сесія завантаження закінчилась. Спробуйте ще раз',
    avatar_upload_not_found:
        'Не вдалося знайти завантажене фото. Спробуйте ще раз',
    avatar_upload_invalid:
        'Цей файл не може бути використаний як фото. Спробуйте інше зображення',
};

function mapUploadErrorMessage(code?: string): string {
    switch (code) {
        case RESPONSE_CODE.AVATAR_FILE_KEY_INVALID:
            return UPLOAD_ERROR_MESSAGES.avatar_file_key_invalid;
        case RESPONSE_CODE.AVATAR_UPLOAD_NOT_FOUND:
            return UPLOAD_ERROR_MESSAGES.avatar_upload_not_found;
        case RESPONSE_CODE.AVATAR_UPLOAD_INVALID:
            return UPLOAD_ERROR_MESSAGES.avatar_upload_invalid;
        default:
            return UPLOAD_ERROR_MESSAGES.avatar_upload_failed;
    }
}

function extractApiErrorCode(err: unknown): string | undefined {
    if (!(err instanceof AxiosError)) return undefined;
    const data = err.response?.data as
        | { error?: { code?: string } }
        | undefined;
    return data?.error?.code;
}

export default function AvatarUploadDialog() {
    const isOpen = useAvatarUploadDialogStore((s) => s.isOpen);
    const close = useAvatarUploadDialogStore((s) => s.close);
    const openDeleteConfirm = useAvatarDeleteConfirmDialogStore((s) => s.open);

    const user = useAuthStore((s) => s.user);
    const setUser = useAuthStore((s) => s.setUser);

    const [phase, setPhase] = useState<Phase>('idle');
    const [imageSrc, setImageSrc] = useState<string | null>(null);
    const [crop, setCrop] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [cropAreaPixels, setCropAreaPixels] = useState<Area | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Revoke the current object URL when it is replaced or the component
    // unmounts. Prevents leaks — every `createObjectURL` must pair with a
    // `revokeObjectURL` call or the browser retains the blob indefinitely.
    useEffect(() => {
        return () => {
            if (imageSrc) URL.revokeObjectURL(imageSrc);
        };
    }, [imageSrc]);

    const resetAll = () => {
        if (imageSrc) URL.revokeObjectURL(imageSrc);
        setImageSrc(null);
        setPhase('idle');
        setCrop({ x: 0, y: 0 });
        setZoom(1);
        setCropAreaPixels(null);
        setSubmitting(false);
        setDragOver(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleOpenChange = (open: boolean) => {
        if (open) return;
        if (submitting) return; // Protect in-flight upload.
        resetAll();
        close();
    };

    const processFile = async (file: File): Promise<void> => {
        if (file.size > AVATAR.MAX_FILE_SIZE) {
            toast.error(
                'Файл занадто великий. Максимальний розмір — 5 МБ',
            );
            return;
        }

        const mimeOk = (
            AVATAR.ALLOWED_MIME_TYPES as readonly string[]
        ).includes(file.type);

        if (!mimeOk) {
            toast.error(
                'Непідтримуваний формат. Використовуйте JPEG, PNG або WebP',
            );
            return;
        }

        if (imageSrc) URL.revokeObjectURL(imageSrc);

        const url = URL.createObjectURL(file);
        setImageSrc(url);
        setCrop({ x: 0, y: 0 });
        setZoom(1);
        setCropAreaPixels(null);
        setPhase('crop');
    };

    const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) void processFile(file);
    };

    const handleDrop = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) void processFile(file);
    };

    const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setDragOver(true);
    };

    const handleDragLeave = () => setDragOver(false);

    const cancelCrop = () => {
        if (submitting) return;
        if (imageSrc) URL.revokeObjectURL(imageSrc);
        setImageSrc(null);
        setPhase('idle');
        setCropAreaPixels(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleSave = async () => {
        if (!imageSrc || !cropAreaPixels || submitting || !user) return;
        setSubmitting(true);

        try {
            const blob = await cropImage(imageSrc, cropAreaPixels);
            const { uploadUrl, fileKey } = await requestAvatarUploadUrl();
            await uploadToR2(uploadUrl, blob);
            const { avatar } = await commitAvatarUpload(fileKey);

            // Response-driven auth state — avoid an extra `getMe()` round-trip
            // and the replication-lag race that comes with it.
            setUser({
                ...user,
                profile: { ...user.profile, avatar },
            });
            toast.success('Фото оновлено');
            resetAll();
            close();
        } catch (err) {
            const code = extractApiErrorCode(err);
            toast.error(mapUploadErrorMessage(code));
            setSubmitting(false);
        }
    };

    /**
     * Sequential, not nested — we close this modal before opening the
     * confirm dialog, so exactly one overlay is active at a time
     * (overlays.md Rule 7). If the user cancels the destructive action,
     * they return to the profile page and can re-open the avatar flow
     * explicitly — cancel is not "return to upload".
     */
    const handleRequestDelete = () => {
        if (submitting) return;
        resetAll();
        close();
        openDeleteConfirm();
    };

    const hasExistingAvatar = !!user?.profile.avatar;

    return (
        <UiModal open={isOpen} onOpenChange={handleOpenChange}>
            <UiModalContent>
                <UiModalHeader>
                    <UiModalTitle>Фото профілю</UiModalTitle>
                </UiModalHeader>
                <div className="px-4 pb-6">
                    {phase === 'idle' && (
                        <div className="space-y-4">
                            <div
                                onDrop={handleDrop}
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                className={composeClasses(
                                    'flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors',
                                    dragOver
                                        ? 'border-primary bg-primary/5'
                                        : 'border-border',
                                )}
                            >
                                <p className="text-muted-foreground text-sm">
                                    Перетягніть фото сюди або
                                </p>
                                <UiButton
                                    type="button"
                                    variant="outline"
                                    size="md"
                                    onClick={() =>
                                        fileInputRef.current?.click()
                                    }
                                >
                                    Оберіть файл
                                </UiButton>
                                <p className="text-muted-foreground text-xs">
                                    JPEG, PNG або WebP. Максимум 5 МБ
                                </p>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept={ACCEPT_MIME}
                                    onChange={handleFileInputChange}
                                    className="sr-only"
                                />
                            </div>

                            {hasExistingAvatar && (
                                <div className="flex justify-end">
                                    <UiButton
                                        type="button"
                                        variant="destructive-outline"
                                        size="md"
                                        onClick={handleRequestDelete}
                                        disabled={submitting}
                                    >
                                        Видалити фото
                                    </UiButton>
                                </div>
                            )}
                        </div>
                    )}

                    {phase === 'crop' && imageSrc && (
                        <div className="space-y-4">
                            <div className="bg-muted relative h-80 w-full overflow-hidden rounded-lg">
                                <Cropper
                                    image={imageSrc}
                                    crop={crop}
                                    zoom={zoom}
                                    aspect={1}
                                    cropShape="round"
                                    showGrid={false}
                                    onCropChange={setCrop}
                                    onZoomChange={setZoom}
                                    onCropComplete={(_, area) =>
                                        setCropAreaPixels(area)
                                    }
                                />
                            </div>

                            <div>
                                <label className="text-muted-foreground mb-1.5 block text-sm">
                                    Масштаб
                                </label>
                                <input
                                    type="range"
                                    min={1}
                                    max={3}
                                    step={0.01}
                                    value={zoom}
                                    onChange={(e) =>
                                        setZoom(Number(e.target.value))
                                    }
                                    disabled={submitting}
                                    className="accent-primary w-full"
                                />
                            </div>

                            <div className="flex justify-end gap-3">
                                <UiButton
                                    type="button"
                                    variant="text"
                                    size="md"
                                    onClick={cancelCrop}
                                    disabled={submitting}
                                >
                                    Скасувати
                                </UiButton>
                                <UiButton
                                    type="button"
                                    variant="filled"
                                    size="md"
                                    onClick={handleSave}
                                    disabled={submitting || !cropAreaPixels}
                                >
                                    {submitting ? (
                                        <UiSpinner size="sm" />
                                    ) : (
                                        'Зберегти'
                                    )}
                                </UiButton>
                            </div>
                        </div>
                    )}
                </div>
            </UiModalContent>
        </UiModal>
    );
}
