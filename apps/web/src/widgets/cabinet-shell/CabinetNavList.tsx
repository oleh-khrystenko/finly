'use client';

import UiButton from '@/shared/ui/UiButton';
import { composeClasses } from '@/shared/lib';
import type { ResolvedNavItem } from './useCabinetNav';
import {
    navRowClass,
    navRowActiveClass,
    navRowHoverClass,
    navIconClass,
    navBadgeClass,
} from './styles';

interface CabinetNavListProps {
    items: ResolvedNavItem[];
    /** Викликається при переході — закриває drawer на мобільному. */
    onNavigate?: () => void;
}

export function CabinetNavList({ items, onNavigate }: CabinetNavListProps) {
    return (
        <ul className="flex flex-col gap-1">
            {items.map((item) =>
                item.comingSoon ? (
                    <li key={item.key}>
                        <UiButton
                            type="button"
                            variant="text"
                            size="sm"
                            disabled
                            className={navRowClass}
                        >
                            <span className={navIconClass}>{item.icon}</span>
                            <span>{item.label}</span>
                            {item.badge && (
                                <span className={navBadgeClass}>
                                    {item.badge}
                                </span>
                            )}
                        </UiButton>
                    </li>
                ) : (
                    <li key={item.key}>
                        <UiButton
                            as="link"
                            href={item.href ?? '#'}
                            variant="text"
                            size="sm"
                            linkPending={false}
                            onClick={onNavigate}
                            aria-current={item.isActive ? 'page' : undefined}
                            className={composeClasses(
                                navRowClass,
                                item.isActive
                                    ? navRowActiveClass
                                    : navRowHoverClass
                            )}
                        >
                            <span className={navIconClass}>{item.icon}</span>
                            <span>{item.label}</span>
                            {item.badge && (
                                <span className={navBadgeClass}>
                                    {item.badge}
                                </span>
                            )}
                        </UiButton>
                    </li>
                )
            )}
        </ul>
    );
}
