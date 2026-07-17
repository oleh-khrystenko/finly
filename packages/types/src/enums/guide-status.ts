/**
 * Життєвий цикл гайда (Sprint 28 + backlog-таб):
 *  - `planned`   — запланована тема з чекліста майбутніх статей. Контент
 *                  необовʼязковий (може бути лише назва). Не публічна.
 *  - `draft`     — стаття в роботі: пишемо, але ще не показуємо читачам.
 *  - `published` — опублікована, видна на сайті і в пошуку.
 */
export const GUIDE_STATUSES = ['planned', 'draft', 'published'] as const;

export type GuideStatus = (typeof GUIDE_STATUSES)[number];
