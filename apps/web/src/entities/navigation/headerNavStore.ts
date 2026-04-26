import { create } from 'zustand';

interface NavItem {
    href: string;
    label: string;
}

interface CtaConfig {
    label: string;
    onClick?: () => void;
}

interface HeaderNavState {
    navItems: NavItem[];
    cta: CtaConfig | null;
    activeSection: string | null;
    setNav: (navItems: NavItem[], cta?: CtaConfig) => void;
    clearNav: () => void;
    setActiveSection: (id: string | null) => void;
}

export const useHeaderNavStore = create<HeaderNavState>((set) => ({
    navItems: [],
    cta: null,
    activeSection: null,
    setNav: (navItems, cta) => set({ navItems, cta: cta ?? null }),
    clearNav: () => set({ navItems: [], cta: null, activeSection: null }),
    setActiveSection: (id) => set({ activeSection: id }),
}));
