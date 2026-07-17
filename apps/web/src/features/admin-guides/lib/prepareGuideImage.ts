import { GUIDE_IMAGE } from '@finly/types';

export interface PreparedGuideImage {
    blob: Blob;
    width: number;
    height: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.addEventListener('load', () => resolve(image));
        image.addEventListener('error', () =>
            reject(new Error('Failed to load image'))
        );
        image.src = src;
    });
}

/**
 * Prepare a picked file for a guide image block: downscale so the longest edge
 * fits `MAX_DIMENSION`, re-encode to WebP, and report the real output pixel
 * size. Dimensions travel with the block so the public page reserves space and
 * never jumps while the image loads.
 */
export async function prepareGuideImage(
    file: File
): Promise<PreparedGuideImage> {
    const url = URL.createObjectURL(file);
    try {
        const image = await loadImage(url);
        const naturalW = image.naturalWidth;
        const naturalH = image.naturalHeight;
        const longest = Math.max(naturalW, naturalH);
        const scale =
            longest > GUIDE_IMAGE.MAX_DIMENSION
                ? GUIDE_IMAGE.MAX_DIMENSION / longest
                : 1;
        const width = Math.round(naturalW * scale);
        const height = Math.round(naturalH * scale);

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error('Canvas 2D context is not available');
        }
        ctx.drawImage(image, 0, 0, width, height);

        const blob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
                (result) => {
                    if (!result) {
                        reject(new Error('Canvas toBlob returned null'));
                        return;
                    }
                    resolve(result);
                },
                GUIDE_IMAGE.OUTPUT_FORMAT,
                GUIDE_IMAGE.OUTPUT_QUALITY
            );
        });

        return { blob, width, height };
    } finally {
        URL.revokeObjectURL(url);
    }
}
