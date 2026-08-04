/**
 * Базовий шлях API з боку браузера. Не конфігурація середовища: і в dev, і в
 * проді браузер б'є той самий origin, а до контейнера API запит доводить
 * rewrite web-сервера — саме тому сесійна cookie лишається same-origin.
 * Server-side виклики ходять у контейнер API напряму через `API_INTERNAL_URL`
 * (див. `next.config.ts`), тож ця константа їх не стосується.
 */
export const API_BASE_URL = '/api';
