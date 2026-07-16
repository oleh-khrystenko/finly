'use client';

import { type ChangeEvent, useRef, useState } from 'react';
import { toast } from 'sonner';
import Image from 'next/image';
import { ImagePlus, Trash2 } from 'lucide-react';
import { GUIDE_IMAGE, type GuideBlockImage } from '@finly/types';

import UiButton from '@/shared/ui/UiButton';
import UiInput from '@/shared/ui/UiInput';
import {
    commitGuideImage,
    requestGuideImageUploadUrl,
    uploadToR2,
} from '@/shared/api';

import { prepareGuideImage } from './lib/prepareGuideImage';

const ACCEPT_MIME = GUIDE_IMAGE.ALLOWED_MIME_TYPES.join(',');

interface GuideImageFieldProps {
    value: GuideBlockImage | undefined;
    onChange: (image: GuideBlockImage | undefined) => void;
    /**
     * Report the in-flight upload up to the editor: `onChange` is bound to a
     * fixed block index in a closure, so reordering/removing a block during the
     * network window would land the image in the wrong block. The editor locks
     * block reorder/remove while any upload is active.
     */
    onUploadingChange: (uploading: boolean) => void;
    altError?: string;
    captionError?: string;
}

export function GuideImageField({
    value,
    onChange,
    onUploadingChange,
    altError,
    captionError,
}: GuideImageFieldProps) {
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (fileInputRef.current) fileInputRef.current.value = '';
        if (!file) return;

        const mimeOk = (
            GUIDE_IMAGE.ALLOWED_MIME_TYPES as readonly string[]
        ).includes(file.type);
        if (!mimeOk) {
            toast.error('Непідтримуваний формат. Використовуйте JPEG, PNG або WebP');
            return;
        }

        setUploading(true);
        onUploadingChange(true);
        try {
            const prepared = await prepareGuideImage(file);
            if (prepared.blob.size > GUIDE_IMAGE.MAX_FILE_SIZE) {
                toast.error('Зображення завелике. Спробуйте менше');
                return;
            }
            const { uploadUrl, fileKey } = await requestGuideImageUploadUrl();
            await uploadToR2(uploadUrl, prepared.blob, GUIDE_IMAGE.OUTPUT_FORMAT);
            const { url } = await commitGuideImage(fileKey);
            onChange({
                src: url,
                alt: value?.alt ?? '',
                width: prepared.width,
                height: prepared.height,
                caption: value?.caption,
            });
        } catch {
            toast.error('Не вдалося завантажити зображення. Спробуйте ще раз');
        } finally {
            setUploading(false);
            onUploadingChange(false);
        }
    };

    if (!value) {
        return (
            <div>
                <UiButton
                    type="button"
                    variant="outline"
                    size="sm"
                    IconLeft={<ImagePlus className="size-4" />}
                    loading={uploading}
                    onClick={() => fileInputRef.current?.click()}
                >
                    Додати зображення
                </UiButton>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPT_MIME}
                    onChange={handleFile}
                    className="sr-only"
                />
            </div>
        );
    }

    return (
        <div className="border-border bg-muted/30 space-y-3 rounded-lg border p-3">
            <div className="flex items-start gap-3">
                <span className="border-border relative h-16 w-24 shrink-0 overflow-hidden rounded-md border">
                    <Image
                        src={value.src}
                        alt={value.alt || 'Превʼю зображення'}
                        fill
                        sizes="96px"
                        className="object-cover"
                    />
                </span>
                <UiButton
                    type="button"
                    variant="destructive-outline"
                    size="sm"
                    IconLeft={<Trash2 className="size-4" />}
                    onClick={() => onChange(undefined)}
                >
                    Прибрати
                </UiButton>
            </div>

            <UiInput
                value={value.alt}
                onChange={(e) => onChange({ ...value, alt: e.target.value })}
                placeholder="Опис зображення (alt)"
                label="Опис (alt)"
                error={altError}
                size="md"
            />
            <UiInput
                value={value.caption ?? ''}
                onChange={(e) =>
                    onChange({
                        ...value,
                        caption: e.target.value || undefined,
                    })
                }
                placeholder="Підпис під зображенням (необовʼязково)"
                label="Підпис"
                error={captionError}
                size="md"
            />
        </div>
    );
}
