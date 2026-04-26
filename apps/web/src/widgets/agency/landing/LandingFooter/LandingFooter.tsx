import { useTranslations } from 'next-intl';
import { Mail } from 'lucide-react';
import { Logo } from '@/entities/brand';
import { GitHubIcon, LinkedInIcon } from '@/shared/icons';
import UiLink from '@/shared/ui/UiLink';
import { DEMO_VIDEO_ENABLED } from '@/shared/config/env';

const allNavLinks = [
    { key: 'pricing', href: '#pricing' },
    { key: 'demo', href: '#demo', enabled: DEMO_VIDEO_ENABLED },
    { key: 'proof', href: '#dogfooding' },
] as const;

const navLinks = allNavLinks.filter((item) => !('enabled' in item) || item.enabled);

const legalLinks = [
    { key: 'terms', href: '/terms' },
    { key: 'privacy', href: '/privacy' },
] as const;

const socialLinks = [
    {
        key: 'linkedin',
        href: 'https://www.linkedin.com/in/oleh-khrystenko',
        icon: LinkedInIcon,
    },
    {
        key: 'github',
        href: 'https://github.com/oleh-khrystenko',
        icon: GitHubIcon,
    },
] as const;

const LandingFooter = () => {
    const t = useTranslations('landing_page.footer');
    const tBrand = useTranslations('brand');

    return (
        <footer className="border-border bg-card border-t">
            <div className="container px-6">
                {/* Top: Logo + slogan + columns */}
                <div className="grid gap-12 py-16 md:grid-cols-2 lg:grid-cols-12">
                    {/* Brand */}
                    <div className="lg:col-span-5">
                        <Logo />
                        <p className="text-muted-foreground mt-4 max-w-xs text-sm leading-relaxed">
                            {tBrand('slogan')}
                        </p>
                    </div>

                    {/* 3 columns */}
                    <div className="grid grid-cols-2 gap-x-8 gap-y-10 lg:grid-cols-3 lg:col-span-7">
                        {/* Product */}
                        <div>
                            <h4 className="text-foreground text-sm font-semibold tracking-wider uppercase">
                                {t('col_product')}
                            </h4>
                            <ul className="mt-4 space-y-3">
                                {navLinks.map(({ key, href }) => (
                                    <li key={key}>
                                        <UiLink
                                            href={href}
                                            variant="muted"
                                            className="text-sm"
                                        >
                                            {t(`nav_${key}`)}
                                        </UiLink>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* Legal */}
                        <div>
                            <h4 className="text-foreground text-sm font-semibold tracking-wider uppercase">
                                {t('col_legal')}
                            </h4>
                            <ul className="mt-4 space-y-3">
                                {legalLinks.map(({ key, href }) => (
                                    <li key={key}>
                                        <UiLink
                                            href={href}
                                            variant="muted"
                                            className="text-sm"
                                        >
                                            {t(`legal_${key}`)}
                                        </UiLink>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* Connect */}
                        <div className="col-span-2 sm:col-span-1">
                            <h4 className="text-foreground text-sm font-semibold tracking-wider uppercase">
                                {t('col_connect')}
                            </h4>
                            <UiLink
                                href="mailto:oleg@cyanship.com"
                                variant="muted"
                                className="mt-4 inline-flex items-center gap-1.5 text-sm"
                            >
                                <Mail className="size-3.5" />
                                {t('email')}
                            </UiLink>
                            <div className="mt-4 flex items-center gap-3">
                                {socialLinks.map(
                                    ({ key, href, icon: Icon }) => (
                                        <UiLink
                                            key={key}
                                            href={href}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            aria-label={t(`social_${key}`)}
                                            variant="muted"
                                        >
                                            <Icon className="size-4" />
                                        </UiLink>
                                    )
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Divider */}
                <div className="border-border border-t py-8">
                    <p className="text-muted-foreground text-center text-sm">
                        {t('copyright', {
                            year: new Date().getFullYear(),
                        })}
                    </p>
                </div>
            </div>
        </footer>
    );
};

export default LandingFooter;
