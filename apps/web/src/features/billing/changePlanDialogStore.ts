import { create } from 'zustand';
import type { SubscriptionPlanItem } from '@finly/types';

interface ChangePlanDialogState {
    isOpen: boolean;
    plans: SubscriptionPlanItem[];
    currentPlanCode: string | null;
    open: (ctx: {
        plans: SubscriptionPlanItem[];
        currentPlanCode: string | null;
    }) => void;
    close: () => void;
}

export const useChangePlanDialogStore = create<ChangePlanDialogState>(
    (set) => ({
        isOpen: false,
        plans: [],
        currentPlanCode: null,
        open: ({ plans, currentPlanCode }) =>
            set({ isOpen: true, plans, currentPlanCode }),
        close: () => set({ isOpen: false }),
    })
);
