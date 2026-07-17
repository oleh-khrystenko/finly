import { loadGuideSlugsSafe, loadGuidesTreeSafe } from './loadGuides';

/**
 * Build-safe враппери мусять деградувати до порожнього результату, а не кидати:
 * `next build` виконує static generation з недоступним API (CI без сервера,
 * web-образ збирається ізольовано, `API_INTERNAL_URL` може бути не заданий).
 * Тут відсутність env змушує apiBase() кинути — перевіряємо, що враппер це
 * ковтає і повертає порожнечу, лишаючи наповнення на ISR у рантаймі.
 */
describe('guide build-safe loaders', () => {
    const original = process.env.API_INTERNAL_URL;

    afterEach(() => {
        process.env.API_INTERNAL_URL = original;
        jest.restoreAllMocks();
    });

    it('loadGuideSlugsSafe degrades to [] when the API is unreachable', async () => {
        delete process.env.API_INTERNAL_URL;
        const errorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        await expect(loadGuideSlugsSafe()).resolves.toEqual([]);
        expect(errorSpy).toHaveBeenCalled();
    });

    it('loadGuidesTreeSafe degrades to [] when the API is unreachable', async () => {
        delete process.env.API_INTERNAL_URL;
        const errorSpy = jest
            .spyOn(console, 'error')
            .mockImplementation(() => {});

        await expect(loadGuidesTreeSafe()).resolves.toEqual([]);
        expect(errorSpy).toHaveBeenCalled();
    });
});
