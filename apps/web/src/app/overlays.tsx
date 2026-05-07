'use client';

import dynamic from 'next/dynamic';

const DeleteAccountDialog = dynamic(
    () => import('@/features/profile/DeleteAccountDialog'),
);
const AvatarUploadDialog = dynamic(
    () => import('@/features/profile/AvatarUploadDialog'),
);
const AvatarDeleteConfirmDialog = dynamic(
    () => import('@/features/profile/AvatarDeleteConfirmDialog'),
);
const TermsReacceptDialog = dynamic(
    () => import('@/features/auth/TermsReacceptDialog'),
);
const BillingResetDialog = dynamic(
    () => import('@/features/billing/BillingResetDialog'),
);
const DeleteBusinessConfirmDialog = dynamic(
    () => import('@/features/business-edit/DeleteBusinessConfirmDialog'),
);
const DeleteInvoiceConfirmDialog = dynamic(
    () => import('@/features/invoice-edit/DeleteInvoiceConfirmDialog'),
);
const SlugPresetWarningDialog = dynamic(
    () => import('@/entities/invoice/SlugPresetWarningDialog'),
);
const MobileMenuSheet = dynamic(
    () => import('@/widgets/header/MobileMenuSheet'),
);

export function Overlays() {
    return (
        <>
            <DeleteAccountDialog />
            <AvatarUploadDialog />
            <AvatarDeleteConfirmDialog />
            <TermsReacceptDialog />
            <BillingResetDialog />
            <DeleteBusinessConfirmDialog />
            <DeleteInvoiceConfirmDialog />
            <SlugPresetWarningDialog />
            <MobileMenuSheet />
        </>
    );
}
