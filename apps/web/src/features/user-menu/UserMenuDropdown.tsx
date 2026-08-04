'use client';

import { getFullName, type UserProfile } from '@finly/types';
import UiButton from '@/shared/ui/UiButton';
import UiDropdownMenu from '@/shared/ui/UiDropdownMenu';
import type { UiDropdownMenuItem } from '@/shared/ui/UiDropdownMenu/types';
import { UiAvatar } from '@/shared/ui/UiAvatar';

interface Props {
    user: UserProfile;
    initials: string;
    items: UiDropdownMenuItem[];
    onSelect: (value: string) => void;
}

/**
 * Sprint 30 — аватар з меню користувача. Спільний для кабінетної шапки і шапки
 * публічного pay-хоста: після переїзду сесії на батьківський домен обидві
 * показують одне й те саме, і розходження між ними було б видиме користувачу.
 */
export default function UserMenuDropdown({
    user,
    initials,
    items,
    onSelect,
}: Props) {
    const fullName =
        getFullName(user.profile.firstName, user.profile.lastName) ?? '';

    return (
        <UiDropdownMenu
            items={items}
            onSelect={onSelect}
            size="sm"
            header={
                <div className="flex items-center gap-2.5">
                    <UiAvatar
                        size="sm"
                        src={user.profile.avatar}
                        alt={fullName}
                        fallback={initials}
                    />
                    <div className="flex flex-col">
                        <span className="text-foreground text-sm font-medium">
                            {fullName}
                        </span>
                        <span className="text-muted-foreground text-xs">
                            {user.email}
                        </span>
                    </div>
                </div>
            }
            trigger={
                <UiButton
                    variant="icon"
                    size="sm"
                    aria-label="Меню користувача"
                    className="rounded-full transition-opacity hover:opacity-80"
                >
                    <UiAvatar
                        size="sm"
                        src={user.profile.avatar}
                        alt={fullName}
                        fallback={initials}
                        priority
                    />
                </UiButton>
            }
        />
    );
}
