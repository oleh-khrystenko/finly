'use client';

import { useState, useEffect } from 'react';
import { LogOut, User, CreditCard, Menu, Briefcase } from 'lucide-react';
import ChangeTheme from '@/features/change-theme';
import { Logo } from '@/entities/brand';
import UiButton from '@/shared/ui/UiButton';
import UiHeaderShell from '@/shared/ui/UiHeaderShell';
import UiDropdownMenu from '@/shared/ui/UiDropdownMenu';
import { UiAvatar } from '@/shared/ui/UiAvatar';
import { useAuthStore } from '@/entities/user';
import { getFullName } from '@finly/types';
import { useHeaderNavStore } from '@/entities/navigation';
import { useMobileMenuSheetStore } from './mobileMenuSheetStore';
import { useUserMenu } from './useUserMenu';
import { useActiveSection } from './useActiveSection';

function useScrolled(threshold: number) {
    const [isScrolled, setIsScrolled] = useState(false);

    useEffect(() => {
        const handleScroll = () => {
            setIsScrolled(window.scrollY > threshold);
        };

        handleScroll();
        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => window.removeEventListener('scroll', handleScroll);
    }, [threshold]);

    return isScrolled;
}

const Header = () => {
    const user = useAuthStore((s) => s.user);
    const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
    const isLoading = useAuthStore((s) => s.isLoading);
    const navItems = useHeaderNavStore((s) => s.navItems);
    const cta = useHeaderNavStore((s) => s.cta);
    const openMobileMenu = useMobileMenuSheetStore((s) => s.open);

    const hasNav = navItems.length > 0;
    const activeSection = useHeaderNavStore((s) => s.activeSection);
    useActiveSection();
    const isScrolled = useScrolled(32);
    const showGlass = !hasNav || isScrolled;
    const [canAnimate, setCanAnimate] = useState(false);

    const { visibleItems, handleSelect, initials } = useUserMenu({
            // Sprint 3 рішення E2: Dashboard → Бізнеси (`/business`).
            // `Briefcase` як іконка бізнес-сегмента (заміна LayoutDashboard).
            businesses: <Briefcase />,
            profile: <User />,
            billing: <CreditCard />,
            logout: <LogOut />,
        });

    useEffect(() => {
        const id = requestAnimationFrame(() => setCanAnimate(true));
        return () => cancelAnimationFrame(id);
    }, []);

    return (
        <div className="sticky top-0 z-50">
            <div
                className={`pointer-events-none absolute inset-0 ${
                    canAnimate
                        ? 'liquid-glass border-b-liquid-glass-border border-b transition-opacity duration-700 ease-out'
                        : ''
                } ${showGlass ? 'opacity-100' : 'opacity-0'}`}
                aria-hidden="true"
            />
            <UiHeaderShell className="relative z-10 gap-6">
                {/* Logo — on landing: smooth scroll to top, elsewhere: navigate home */}
                {hasNav ? (
                    <UiButton
                        as="button"
                        variant="text"
                        size="md"
                        aria-label="Go to home page"
                        className="p-0"
                        onClick={() => {
                            window.scrollTo({
                                top: 0,
                                behavior: 'smooth',
                            });
                            history.replaceState(
                                null,
                                '',
                                window.location.pathname
                            );
                        }}
                    >
                        <Logo />
                    </UiButton>
                ) : (
                    <UiButton
                        as="link"
                        href="/"
                        variant="text"
                        size="md"
                        aria-label="Go to home page"
                        className="p-0"
                    >
                        <Logo />
                    </UiButton>
                )}

                {/* Desktop nav */}
                {hasNav && (
                    <nav className="hidden items-center gap-8 lg:flex">
                        {navItems.map(({ href, label }) => {
                            const isActive =
                                activeSection === href.replace('#', '');
                            return (
                                <a
                                    key={href}
                                    href={href}
                                    className={`text-sm transition-colors ${
                                        isActive
                                            ? 'text-foreground font-medium'
                                            : 'text-muted-foreground hover:text-foreground'
                                    }`}
                                >
                                    {label}
                                </a>
                            );
                        })}
                    </nav>
                )}

                {/* Desktop right side */}
                <div className="hidden items-center gap-2 lg:flex">
                    <ChangeTheme />

                    {isLoading ? (
                        <div className="bg-secondary h-8 w-20 animate-pulse rounded-lg" />
                    ) : isAuthenticated && user ? (
                        <UiDropdownMenu
                            items={visibleItems}
                            onSelect={(value) => handleSelect(value)}
                            size="sm"
                            header={
                                <div className="flex items-center gap-2.5">
                                    <UiAvatar
                                        size="sm"
                                        src={user.profile.avatar}
                                        alt={
                                            getFullName(
                                                user.profile.firstName,
                                                user.profile.lastName
                                            ) ?? ''
                                        }
                                        fallback={initials}
                                    />
                                    <div className="flex flex-col">
                                        <span className="text-foreground text-sm font-medium">
                                            {getFullName(
                                                user.profile.firstName,
                                                user.profile.lastName
                                            )}
                                        </span>
                                        <span className="text-muted-foreground text-xs">
                                            {user.email}
                                        </span>
                                    </div>
                                </div>
                            }
                            trigger={
                                <button
                                    type="button"
                                    className="cursor-pointer rounded-full transition-opacity hover:opacity-80"
                                >
                                    <UiAvatar
                                        size="sm"
                                        src={user.profile.avatar}
                                        alt={
                                            getFullName(
                                                user.profile.firstName,
                                                user.profile.lastName
                                            ) ?? ''
                                        }
                                        fallback={initials}
                                        priority
                                    />
                                </button>
                            }
                        />
                    ) : (
                        <UiButton
                            as="link"
                            href="/auth/signin"
                            variant="text"
                            size="sm"
                        >
                            Увійти
                        </UiButton>
                    )}

                    {cta && (
                        <UiButton
                            variant="filled"
                            size="sm"
                            className="ml-2"
                            onClick={cta.onClick}
                        >
                            {cta.label}
                        </UiButton>
                    )}
                </div>

                {/* Mobile hamburger */}
                <div className="lg:hidden">
                    <UiButton
                        variant="icon"
                        size="md"
                        aria-label="Відкрити меню"
                        IconLeft={<Menu />}
                        onClick={openMobileMenu}
                    />
                </div>
            </UiHeaderShell>
        </div>
    );
};

export default Header;
