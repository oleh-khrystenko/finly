import { Mail } from 'lucide-react';

import UiButton from '@/shared/ui/UiButton';

const LEGAL_LINKS = [
    { href: '/privacy', label: 'Політика конфіденційності' },
    { href: '/terms', label: 'Умови використання' },
] as const;

interface LegalNavProps {
    /**
     * Marketing-origin для АБСОЛЮТНИХ лінків. Потрібен на public payment-host-і
     * (`pay.finly.com.ua`): там `/privacy` middleware трактує як business-slug
     * → 404, тож шлях треба робити absolute external. Без пропа — internal
     * Next.js `Link` (cabinet/landing), стилі ідентичні.
     */
    baseUrl?: string;
    /** Показати контактний email-рядок (landing-футер). */
    showContact?: boolean;
}

/**
 * Юридична навігація футера — heading + privacy/terms (+ опційно контакт).
 * Витягнуто з legal-колонки `widgets/landing-footer` без зміни стилів.
 */
export function LegalNav({ baseUrl, showContact = false }: LegalNavProps) {
    return (
        <nav aria-labelledby="footer-legal">
            <h3
                id="footer-legal"
                className="text-foreground text-sm font-semibold tracking-wide"
            >
                Юридичне
            </h3>
            <ul className="mt-2 flex flex-col items-start gap-1">
                {LEGAL_LINKS.map(({ href, label }) => (
                    <li key={href}>
                        {baseUrl ? (
                            <UiButton
                                as="a"
                                href={`${baseUrl}${href}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                variant="link"
                                size="sm"
                            >
                                {label}
                            </UiButton>
                        ) : (
                            <UiButton
                                as="link"
                                href={href}
                                variant="link"
                                size="sm"
                            >
                                {label}
                            </UiButton>
                        )}
                    </li>
                ))}
                {showContact && (
                    <li>
                        <UiButton
                            as="a"
                            href="mailto:support@finly.com.ua"
                            variant="link"
                            size="sm"
                            IconLeft={<Mail />}
                        >
                            support@finly.com.ua
                        </UiButton>
                    </li>
                )}
            </ul>
        </nav>
    );
}
