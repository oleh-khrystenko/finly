import { z } from 'zod';

import { nameSchema } from '../validation/common';

// --- Enums ---

export const BRIEF_STATUS = {
    NEW: 'new',
    IN_REVIEW: 'in_review',
    RESPONDED: 'responded',
    REJECTED: 'rejected',
    ARCHIVED: 'archived',
} as const;

export type BriefStatus = (typeof BRIEF_STATUS)[keyof typeof BRIEF_STATUS];

export const BRIEF_BUDGET = {
    UNDER_2500: 'under_2500',
    FROM_2500_TO_5000: '2500_5000',
    FROM_5000_TO_10000: '5000_10000',
    OVER_10000: 'over_10000',
} as const;

export type BriefBudget = (typeof BRIEF_BUDGET)[keyof typeof BRIEF_BUDGET];

export const BRIEF_DEADLINE = {
    ASAP: 'asap',
    ONE_TO_THREE_MONTHS: '1_3_months',
    FLEXIBLE: 'flexible',
} as const;

export type BriefDeadline =
    (typeof BRIEF_DEADLINE)[keyof typeof BRIEF_DEADLINE];

// --- Submission schema (shared between frontend & backend) ---

export const SubmitBriefSchema = z.object({
    name: nameSchema,
    email: z.string().trim().email().max(254),
    description: z.string().trim().min(10).max(5000),
    budget: z.enum([
        BRIEF_BUDGET.UNDER_2500,
        BRIEF_BUDGET.FROM_2500_TO_5000,
        BRIEF_BUDGET.FROM_5000_TO_10000,
        BRIEF_BUDGET.OVER_10000,
    ]),
    deadline: z
        .enum([
            BRIEF_DEADLINE.ASAP,
            BRIEF_DEADLINE.ONE_TO_THREE_MONTHS,
            BRIEF_DEADLINE.FLEXIBLE,
        ])
        .optional(),
    source: z.string().max(253).optional(),
    lang: z.string().min(2).max(5),
    captchaToken: z.string().min(1),
});

export type SubmitBrief = z.infer<typeof SubmitBriefSchema>;

// --- Human-readable labels (for notification emails, admin UI) ---

export const BRIEF_BUDGET_LABEL: Record<BriefBudget, string> = {
    [BRIEF_BUDGET.UNDER_2500]: '< $2,500 (Consulting only)',
    [BRIEF_BUDGET.FROM_2500_TO_5000]: '$2,500 – $5,000',
    [BRIEF_BUDGET.FROM_5000_TO_10000]: '$5,000 – $10,000',
    [BRIEF_BUDGET.OVER_10000]: '$10,000+',
};

export const BRIEF_DEADLINE_LABEL: Record<BriefDeadline, string> = {
    [BRIEF_DEADLINE.ASAP]: 'ASAP',
    [BRIEF_DEADLINE.ONE_TO_THREE_MONTHS]: '1–3 months',
    [BRIEF_DEADLINE.FLEXIBLE]: 'Flexible',
};
