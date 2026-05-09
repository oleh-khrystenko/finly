'use client';

import { Camera } from 'lucide-react';
import type { UserProfile } from '@finly/types';
import { getFullName, getInitials } from '@finly/types';

import { UiAvatarButton } from '@/shared/ui/UiAvatarButton';

interface AvatarEditButtonProps {
    user: UserProfile;
    editable: boolean;
    ariaLabel: string;
    onPress: () => void;
}

/**
 * Clickable avatar for the profile page. Composes `UiAvatarButton` (the shared
 * primitive) with a camera overlay that appears on hover / keyboard focus.
 * Initials come from the shared `getInitials` utility used elsewhere in the
 * app (header, dashboard) — same fallback across surfaces.
 */
export default function AvatarEditButton({
    user,
    editable,
    ariaLabel,
    onPress,
}: AvatarEditButtonProps) {
    const fullName = getFullName(user.profile.firstName, user.profile.lastName);
    const initials = getInitials(fullName, user.email);

    return (
        <UiAvatarButton
            src={user.profile.avatar}
            fallback={initials}
            size="2xl"
            aria-label={ariaLabel}
            onClick={onPress}
            disabled={!editable}
            overlay={<Camera className="size-6" aria-hidden="true" />}
        />
    );
}
