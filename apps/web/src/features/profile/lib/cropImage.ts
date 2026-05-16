import type { Area } from 'react-easy-crop';
import { AVATAR } from '@finly/types';

/**
 * Load an image into an `HTMLImageElement` and resolve once it's fully decoded.
 *
 * No `crossOrigin` attribute: the source is always an object URL (`blob:`)
 * produced by `URL.createObjectURL` from a user-selected file. Object URLs
 * don't taint the canvas, so we can later call `canvas.toBlob` without
 * `SecurityError`. Setting `crossOrigin` would be required only for remote URLs.
 */
function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.addEventListener('load', () => resolve(image));
        image.addEventListener('error', () =>
            reject(new Error('Failed to load image for crop'))
        );
        image.src = src;
    });
}

/**
 * Crop an image to the square avatar output — `AVATAR.OUTPUT_SIZE²`, WebP,
 * `AVATAR.OUTPUT_QUALITY`.
 *
 * The crop area (from react-easy-crop's `onCropComplete` callback) is in the
 * image's natural pixel space, so `drawImage` can simultaneously crop and
 * resize in a single pass.
 */
export async function cropImage(
    imageSrc: string,
    cropArea: Area
): Promise<Blob> {
    const image = await loadImage(imageSrc);

    const canvas = document.createElement('canvas');
    canvas.width = AVATAR.OUTPUT_SIZE;
    canvas.height = AVATAR.OUTPUT_SIZE;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error('Canvas 2D context is not available');
    }

    ctx.drawImage(
        image,
        cropArea.x,
        cropArea.y,
        cropArea.width,
        cropArea.height,
        0,
        0,
        AVATAR.OUTPUT_SIZE,
        AVATAR.OUTPUT_SIZE
    );

    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (!blob) {
                    reject(new Error('Canvas toBlob returned null'));
                    return;
                }
                resolve(blob);
            },
            AVATAR.OUTPUT_FORMAT,
            AVATAR.OUTPUT_QUALITY
        );
    });
}
