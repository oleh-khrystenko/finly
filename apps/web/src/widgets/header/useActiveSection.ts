import { useEffect } from 'react';
import { useHeaderNavStore } from '@/entities/navigation';

export function useActiveSection() {
    const navItems = useHeaderNavStore((s) => s.navItems);
    const setActiveSection = useHeaderNavStore((s) => s.setActiveSection);

    useEffect(() => {
        if (navItems.length === 0) return;

        const sectionIds = navItems.map((item) => item.href.replace('#', ''));
        const visibleIds = new Set<string>();

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((e) => {
                    if (e.isIntersecting) {
                        visibleIds.add(e.target.id);
                    } else {
                        visibleIds.delete(e.target.id);
                    }
                });

                if (visibleIds.size === 0) {
                    setActiveSection(null);
                } else {
                    const first = sectionIds.find((id) => visibleIds.has(id));
                    setActiveSection(first ?? null);
                }
            },
            { rootMargin: '-20% 0px -60% 0px' }
        );

        const elements = sectionIds
            .map((id) => document.getElementById(id))
            .filter(Boolean) as HTMLElement[];

        elements.forEach((el) => observer.observe(el));

        return () => observer.disconnect();
    }, [navItems, setActiveSection]);
}
