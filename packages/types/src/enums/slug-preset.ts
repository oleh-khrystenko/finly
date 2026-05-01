export const SLUG_PRESETS = [
    'simple',
    'with-month',
    'with-year',
    'with-purpose',
] as const;

export type SlugPreset = (typeof SLUG_PRESETS)[number];
