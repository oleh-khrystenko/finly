'use client';

import { FC } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Globe } from 'lucide-react';
import { UA, US } from 'country-flag-icons/react/3x2';
import { LANG } from '@cyanship/types';
import { ChangeLangProps } from './types';
import UiButton from '@/shared/ui/UiButton';
import UiDropdownMenu from '@/shared/ui/UiDropdownMenu';
import type { UiDropdownMenuItem } from '@/shared/ui/UiDropdownMenu';
import { updatePreferredLang } from '@/shared/api';
import { useAuthStore } from '@/entities/user';

const LANG_ITEMS: UiDropdownMenuItem[] = [
    {
        value: LANG.EN,
        label: 'English',
        icon: <US title="United States" className="h-4 w-5 rounded-sm" />,
    },
    {
        value: LANG.UK,
        label: 'Українська',
        icon: <UA title="Ukraine" className="h-4 w-5 rounded-sm" />,
    },
];

const ChangeLang: FC<ChangeLangProps> = ({
    trigger: customTrigger,
    align = 'end',
}) => {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const activeLocale = useLocale();
    const t = useTranslations('components.change_lang');
    const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

    const handleChangeLang = (value: string) => {
        if (value === activeLocale) return;

        const allSearchParams = searchParams.toString();
        const newPath = pathname.replace(`/${activeLocale}`, '');
        const newUrl = `/${value}${newPath}${allSearchParams ? `?${allSearchParams}` : ''}`;
        router.replace(newUrl);

        if (isAuthenticated) {
            void updatePreferredLang(value);
        }
    };

    const defaultTrigger = (
        <UiButton
            variant="icon"
            size="sm"
            aria-label={t('label')}
            className="size-9"
            IconLeft={<Globe />}
        />
    );

    return (
        <UiDropdownMenu
            items={LANG_ITEMS}
            onSelect={handleChangeLang}
            activeValue={activeLocale}
            align={align}
            size="sm"
            trigger={customTrigger ?? defaultTrigger}
        />
    );
};

export default ChangeLang;
