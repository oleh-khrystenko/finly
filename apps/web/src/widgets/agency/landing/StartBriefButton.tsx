'use client';

import { ComponentProps } from 'react';
import UiButton from '@/shared/ui/UiButton';
import { useBriefDialogStore } from '@/features/agency/brief';

type StartBriefButtonProps = Omit<
    ComponentProps<typeof UiButton> & { as?: 'button' },
    'as' | 'onClick' | 'href'
>;

const StartBriefButton = (props: StartBriefButtonProps) => {
    const openBrief = useBriefDialogStore((s) => s.open);

    return <UiButton onClick={() => openBrief()} {...props} />;
};

export default StartBriefButton;
