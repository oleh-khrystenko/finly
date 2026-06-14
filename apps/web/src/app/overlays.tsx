'use client';

import dynamic from 'next/dynamic';

const DeleteAccountDialog = dynamic(
    () => import('@/features/profile/DeleteAccountDialog')
);
const AvatarUploadDialog = dynamic(
    () => import('@/features/profile/AvatarUploadDialog')
);
const AvatarDeleteConfirmDialog = dynamic(
    () => import('@/features/profile/AvatarDeleteConfirmDialog')
);
const TermsReacceptDialog = dynamic(
    () => import('@/features/auth/TermsReacceptDialog')
);
const CancelSubscriptionDialog = dynamic(
    () => import('@/features/billing/CancelSubscriptionDialog')
);
const ChangePlanDialog = dynamic(
    () => import('@/features/billing/ChangePlanDialog')
);
const DeleteBusinessConfirmDialog = dynamic(
    () => import('@/features/business-edit/DeleteBusinessConfirmDialog')
);
const DeleteInvoiceConfirmDialog = dynamic(
    () => import('@/features/invoice-edit/DeleteInvoiceConfirmDialog')
);
const DeleteAccountConfirmDialog = dynamic(
    () => import('@/features/account-edit/DeleteAccountConfirmDialog')
);
const ResetBusinessSlugConfirmDialog = dynamic(
    () => import('@/features/business-edit/ResetBusinessSlugConfirmDialog')
);
const ResetAccountSlugConfirmDialog = dynamic(
    () => import('@/features/account-edit/ResetAccountSlugConfirmDialog')
);
const ResetInvoiceSlugConfirmDialog = dynamic(
    () => import('@/features/invoice-edit/ResetInvoiceSlugConfirmDialog')
);
const SlugPresetWarningDialog = dynamic(
    () => import('@/entities/invoice/SlugPresetWarningDialog')
);
const MobileMenuSheet = dynamic(
    () => import('@/widgets/header/MobileMenuSheet')
);

export function Overlays() {
    return (
        <>
            <DeleteAccountDialog />
            <AvatarUploadDialog />
            <AvatarDeleteConfirmDialog />
            <TermsReacceptDialog />
            <CancelSubscriptionDialog />
            <ChangePlanDialog />
            <DeleteBusinessConfirmDialog />
            <DeleteInvoiceConfirmDialog />
            <DeleteAccountConfirmDialog />
            <ResetBusinessSlugConfirmDialog />
            <ResetAccountSlugConfirmDialog />
            <ResetInvoiceSlugConfirmDialog />
            <SlugPresetWarningDialog />
            <MobileMenuSheet />
        </>
    );
}
