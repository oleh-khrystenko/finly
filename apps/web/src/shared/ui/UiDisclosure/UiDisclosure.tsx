'use client';

import { Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/react';
import { ChevronDown } from 'lucide-react';
import { composeClasses } from '@/shared/lib';
import type { UiDisclosureAlign, UiDisclosureProps } from './types';

const alignStyles: Record<UiDisclosureAlign, string> = {
    start: 'justify-start text-left',
    center: 'justify-center text-center',
};

/**
 * Розкривна секція «на вимогу» (Headless UI `Disclosure`). Тримає
 * другорядні дії й технічні fallback-и поза головним потоком, щоб не
 * перевантажувати екран. Keyboard + aria — з коробки Headless UI.
 *
 * Споживається public-payment вивіскою та cabinet QR-секцією — обидві
 * ховають запасні платіжні коди під цим тригером.
 */
const UiDisclosure = ({
    label,
    children,
    defaultOpen = false,
    align = 'start',
    className,
}: UiDisclosureProps) => (
    <Disclosure as="div" defaultOpen={defaultOpen} className={className}>
        <DisclosureButton
            className={composeClasses(
                'group text-muted-foreground hover:text-foreground focus-visible:ring-ring flex min-h-11 w-full cursor-pointer items-center gap-1.5 rounded-md text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2',
                alignStyles[align]
            )}
        >
            <ChevronDown
                className="size-4 shrink-0 transition-transform duration-200 group-data-open:rotate-180"
                aria-hidden="true"
            />
            {label}
        </DisclosureButton>
        <DisclosurePanel className="mt-3">{children}</DisclosurePanel>
    </Disclosure>
);

UiDisclosure.displayName = 'UiDisclosure';

export default UiDisclosure;
