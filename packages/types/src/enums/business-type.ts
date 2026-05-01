export const BUSINESS_TYPES = ['fop'] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number];

export const BUSINESS_TYPE_LABEL: Record<BusinessType, string> = {
    fop: 'ФОП',
};
