'use client';

import { useLocale, useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { LogOut, User, CreditCard, LogIn, Globe, LayoutDashboard, Bot } from 'lucide-react';
import ChangeLang from '@/features/change-lang';
import ChangeTheme, { THEME_ICONS } from '@/features/change-theme';
import type { Theme } from '@/shared/types/settings';
import { THEME } from '@/shared/types/settings';
import { Logo } from '@/entities/brand';
import UiButton from '@/shared/ui/UiButton';
import { UiAvatar } from '@/shared/ui/UiAvatar';
import {
    UiSheet,
    UiSheetContent,
    UiSheetHeader,
    UiSheetTitle,
} from '@/shared/ui/UiSheet';
import { useAuthStore } from '@/entities/user';
import { getFullName } from '@cyanship/types';
import { useHeaderNavStore } from '@/entities/navigation';
import { useMobileMenuSheetStore } from './mobileMenuSheetStore';
import { useUserMenu } from './useUserMenu';

const menuItemBase =
    '-mx-2 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors';
const menuItemStyles = `${menuItemBase} text-muted-foreground hover:bg-muted/50 hover:text-foreground`;

export default function MobileMenuSheet() {
    const t = useTranslations('components.header');
    const tTheme = useTranslations('components.change_theme');
    const locale = useLocale();
    const pathname = usePathname();
    const { theme } = useTheme();

    const user = useAuthStore((s) => s.user);
    const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
    const isLoading = useAuthStore((s) => s.isLoading);
    const navItems = useHeaderNavStore((s) => s.navItems);
    const cta = useHeaderNavStore((s) => s.cta);
    const isOpen = useMobileMenuSheetStore((s) => s.isOpen);
    const close = useMobileMenuSheetStore((s) => s.close);

    const isSigninPage = pathname.endsWith('/auth/signin');
    const hasNav = navItems.length > 0;
    const activeSection = useHeaderNavStore((s) => s.activeSection);

    const { visibleItems, handleSelect, initials } = useUserMenu({
        dashboard: <LayoutDashboard />,
        aiChat: <Bot />,
        profile: <User />,
        billing: <CreditCard />,
        logout: <LogOut />,
    });

    const ThemeIcon = THEME_ICONS[(theme as Theme) ?? THEME.SYSTEM];
    const themeLabel = tTheme((theme as Theme) ?? 'system');

    return (
        <UiSheet open={isOpen} onOpenChange={(open) => !open && close()}>
            <UiSheetContent side="right">
                <UiSheetHeader className="pt-3">
                    <UiSheetTitle className="text-left">
                        <Logo />
                    </UiSheetTitle>
                </UiSheetHeader>

                <div className="flex flex-col gap-6 px-5 pb-6">
                    {/* Navigation */}
                    {hasNav && (
                        <nav className="flex flex-col gap-1">
                            {navItems.map(({ href, label }) => {
                                const isActive =
                                    activeSection ===
                                    href.replace('#', '');
                                return (
                                    <a
                                        key={href}
                                        href={href}
                                        className={`${menuItemBase} ${
                                            isActive
                                                ? 'text-foreground bg-muted/50'
                                                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                                        }`}
                                        onClick={close}
                                    >
                                        {label}
                                    </a>
                                );
                            })}
                        </nav>
                    )}

                    {hasNav && <div className="bg-border h-px" />}

                    {/* User & preferences */}
                    {isLoading ? (
                        <div className="flex items-center gap-3">
                            <div className="bg-secondary size-10 shrink-0 animate-pulse rounded-full" />
                            <div className="flex flex-1 flex-col gap-1.5">
                                <div className="bg-secondary h-3.5 w-24 animate-pulse rounded" />
                                <div className="bg-secondary h-3 w-32 animate-pulse rounded" />
                            </div>
                        </div>
                    ) : isAuthenticated && user ? (
                        <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-3 pb-3">
                                <UiAvatar
                                    size="md"
                                    src={user.profile.avatar}
                                    alt={getFullName(user.profile.firstName, user.profile.lastName) ?? ''}
                                    fallback={initials}
                                />
                                <div className="flex min-w-0 flex-col">
                                    <span className="truncate text-sm font-medium">
                                        {getFullName(user.profile.firstName, user.profile.lastName)}
                                    </span>
                                    <span className="text-muted-foreground truncate text-xs">
                                        {user.email}
                                    </span>
                                </div>
                            </div>

                            {visibleItems
                                .filter((item) => item.value !== 'logout')
                                .map((item) => (
                                    <button
                                        key={item.value}
                                        type="button"
                                        className={menuItemStyles}
                                        onClick={() =>
                                            handleSelect(item.value, close)
                                        }
                                    >
                                        <span className="flex size-4 shrink-0 items-center justify-center [&>svg]:size-4">
                                            {item.icon}
                                        </span>
                                        <span>{item.label}</span>
                                        {item.badge != null && (
                                            <span className="bg-muted text-muted-foreground ml-auto rounded-full px-2 py-0.5 text-xs leading-none">
                                                {item.badge}
                                            </span>
                                        )}
                                    </button>
                                ))}

                            <div className="bg-border mx-1 my-2 h-px" />

                            <ChangeLang
                                align="start"
                                trigger={
                                    <button
                                        type="button"
                                        className={menuItemStyles}
                                    >
                                        <span className="flex size-4 shrink-0 items-center justify-center [&>svg]:size-4">
                                            <Globe />
                                        </span>
                                        <span>{t('language')}</span>
                                        <span className="text-muted-foreground ml-auto text-xs">
                                            {locale.toUpperCase()}
                                        </span>
                                    </button>
                                }
                            />
                            <ChangeTheme
                                align="start"
                                trigger={
                                    <button
                                        type="button"
                                        className={menuItemStyles}
                                    >
                                        <span className="flex size-4 shrink-0 items-center justify-center [&>svg]:size-4">
                                            <ThemeIcon />
                                        </span>
                                        <span>{t('theme')}</span>
                                        <span className="text-muted-foreground ml-auto text-xs">
                                            {themeLabel}
                                        </span>
                                    </button>
                                }
                            />

                            <div className="bg-border mx-1 my-2 h-px" />

                            <button
                                type="button"
                                className="text-destructive hover:bg-destructive/10 -mx-2 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors"
                                onClick={() => handleSelect('logout', close)}
                            >
                                <span className="flex size-4 shrink-0 items-center justify-center [&>svg]:size-4">
                                    <LogOut />
                                </span>
                                <span>{t('logout')}</span>
                            </button>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-1">
                            <span className="text-muted-foreground px-1 text-xs font-medium tracking-wider uppercase">
                                {t('settings')}
                            </span>
                            <ChangeLang
                                align="start"
                                trigger={
                                    <button
                                        type="button"
                                        className={menuItemStyles}
                                    >
                                        <span className="flex size-4 shrink-0 items-center justify-center [&>svg]:size-4">
                                            <Globe />
                                        </span>
                                        <span>{t('language')}</span>
                                        <span className="text-muted-foreground ml-auto text-xs">
                                            {locale.toUpperCase()}
                                        </span>
                                    </button>
                                }
                            />
                            <ChangeTheme
                                align="start"
                                trigger={
                                    <button
                                        type="button"
                                        className={menuItemStyles}
                                    >
                                        <span className="flex size-4 shrink-0 items-center justify-center [&>svg]:size-4">
                                            <ThemeIcon />
                                        </span>
                                        <span>{t('theme')}</span>
                                        <span className="text-muted-foreground ml-auto text-xs">
                                            {themeLabel}
                                        </span>
                                    </button>
                                }
                            />

                            {!isSigninPage && (
                                <>
                                    <div className="bg-border mx-1 my-2 h-px" />
                                    <UiButton
                                        as="link"
                                        href={`/${locale}/auth/signin`}
                                        variant="text"
                                        size="md"
                                        IconLeft={<LogIn />}
                                        className="justify-start"
                                        onClick={close}
                                    >
                                        {t('signin')}
                                    </UiButton>
                                </>
                            )}
                        </div>
                    )}

                    {/* CTA */}
                    {cta && (
                        <UiButton
                            variant="filled"
                            size="md"
                            className="w-full"
                            onClick={() => {
                                close();
                                cta.onClick?.();
                            }}
                        >
                            {cta.label}
                        </UiButton>
                    )}
                </div>
            </UiSheetContent>
        </UiSheet>
    );
}
