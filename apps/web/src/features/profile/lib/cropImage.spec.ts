import { AVATAR } from '@neatslip/types';

import { cropImage } from './cropImage';

/**
 * jsdom doesn't back canvas with a real rendering engine, so we stub
 * `getContext`, `toBlob`, and the `Image` load lifecycle to exercise the
 * pure logic of `cropImage` (dimensions, format, quality pass-through,
 * crop-area mapping) without depending on pixel output.
 */
describe('cropImage', () => {
    const originalSrcDescriptor = Object.getOwnPropertyDescriptor(
        HTMLImageElement.prototype,
        'src'
    );
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    const originalToBlob = HTMLCanvasElement.prototype.toBlob;

    let drawImageSpy: jest.Mock;
    let toBlobSpy: jest.Mock;

    beforeEach(() => {
        // Auto-dispatch `load` on every <img>.src assignment — the utility
        // resolves when the image has loaded; without this stub the Promise
        // never settles under jsdom.
        Object.defineProperty(HTMLImageElement.prototype, 'src', {
            configurable: true,
            set(this: HTMLImageElement, value: string) {
                (this as unknown as { _src: string })._src = value;
                queueMicrotask(() => this.dispatchEvent(new Event('load')));
            },
            get(this: HTMLImageElement) {
                return (this as unknown as { _src: string })._src ?? '';
            },
        });

        drawImageSpy = jest.fn();
        toBlobSpy = jest.fn(
            (cb: BlobCallback, type?: string, _quality?: number) => {
                cb(new Blob(['fake-webp'], { type: type ?? 'image/webp' }));
            }
        );

        HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
            drawImage: drawImageSpy,
        })) as unknown as typeof HTMLCanvasElement.prototype.getContext;

        HTMLCanvasElement.prototype.toBlob =
            toBlobSpy as unknown as typeof HTMLCanvasElement.prototype.toBlob;
    });

    afterEach(() => {
        if (originalSrcDescriptor) {
            Object.defineProperty(
                HTMLImageElement.prototype,
                'src',
                originalSrcDescriptor
            );
        }
        HTMLCanvasElement.prototype.getContext = originalGetContext;
        HTMLCanvasElement.prototype.toBlob = originalToBlob;
    });

    it('sizes the canvas to AVATAR.OUTPUT_SIZE and encodes with OUTPUT_FORMAT + OUTPUT_QUALITY', async () => {
        const createElementSpy = jest.spyOn(document, 'createElement');
        const area = { x: 10, y: 20, width: 200, height: 200 };

        const blob = await cropImage('blob:mock-url', area);

        expect(blob.type).toBe(AVATAR.OUTPUT_FORMAT);
        expect(toBlobSpy).toHaveBeenCalledWith(
            expect.any(Function),
            AVATAR.OUTPUT_FORMAT,
            AVATAR.OUTPUT_QUALITY
        );

        const canvasEl = createElementSpy.mock.results.find(
            (r) =>
                r.value instanceof HTMLElement &&
                (r.value as HTMLElement).tagName === 'CANVAS'
        )?.value as HTMLCanvasElement | undefined;
        expect(canvasEl).toBeDefined();
        expect(canvasEl?.width).toBe(AVATAR.OUTPUT_SIZE);
        expect(canvasEl?.height).toBe(AVATAR.OUTPUT_SIZE);

        createElementSpy.mockRestore();
    });

    it('maps the crop area into the AVATAR.OUTPUT_SIZE square via drawImage', async () => {
        const area = { x: 10, y: 20, width: 200, height: 200 };

        await cropImage('blob:mock-url', area);

        expect(drawImageSpy).toHaveBeenCalledWith(
            expect.any(HTMLImageElement),
            10,
            20,
            200,
            200,
            0,
            0,
            AVATAR.OUTPUT_SIZE,
            AVATAR.OUTPUT_SIZE
        );
    });

    it('rejects when toBlob returns null (browser lacks WebP encoding)', async () => {
        toBlobSpy.mockImplementationOnce((cb: BlobCallback) => cb(null));

        await expect(
            cropImage('blob:mock-url', {
                x: 0,
                y: 0,
                width: 10,
                height: 10,
            })
        ).rejects.toThrow(/null/);
    });

    it('rejects when the image fails to load', async () => {
        // Override the src setter installed in beforeEach to dispatch `error`.
        Object.defineProperty(HTMLImageElement.prototype, 'src', {
            configurable: true,
            set(this: HTMLImageElement, value: string) {
                (this as unknown as { _src: string })._src = value;
                queueMicrotask(() => this.dispatchEvent(new Event('error')));
            },
            get(this: HTMLImageElement) {
                return (this as unknown as { _src: string })._src ?? '';
            },
        });

        await expect(
            cropImage('blob:broken', {
                x: 0,
                y: 0,
                width: 10,
                height: 10,
            })
        ).rejects.toThrow(/Failed to load image/);
    });
});
