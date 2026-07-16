export const GUIDE_STATUSES = ['draft', 'published'] as const;

export type GuideStatus = (typeof GUIDE_STATUSES)[number];
