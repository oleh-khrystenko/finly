import { create } from 'zustand';
import type { BusinessBrand } from '@finly/types';

/**
 * Sprint 21 — стан модалки завантаження логотипа бренду. In-slice (overlays.md
 * Rule 2). Бренд єдиний на рівні бізнесу, тож payload несе `businessSlug` і
 * колбек `onApplied` (оновити локальний стан сторінки без re-fetch — дзеркало
 * callback-патерну `resetBusinessSlugConfirmStore`).
 */
interface BrandLogoDialogPayload {
    businessSlug: string;
    /** Платний рівень (≥ brand): Save активує одразу, інакше pending + пейвол. */
    isPaid: boolean;
    subscribePriceLabel: string;
    onSubscribe: () => void;
    onApplied: (brand: BusinessBrand | null) => void;
}

interface BrandLogoDialogState extends Partial<BrandLogoDialogPayload> {
    isOpen: boolean;
    open: (payload: BrandLogoDialogPayload) => void;
    close: () => void;
}

export const useBrandLogoDialogStore = create<BrandLogoDialogState>((set) => ({
    isOpen: false,
    businessSlug: undefined,
    isPaid: undefined,
    subscribePriceLabel: undefined,
    onSubscribe: undefined,
    onApplied: undefined,
    open: (payload) => set({ isOpen: true, ...payload }),
    close: () => set({ isOpen: false }),
}));
