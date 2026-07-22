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
const CabinetDrawer = dynamic(
    () => import('@/widgets/cabinet-shell/CabinetDrawer')
);
const BrandLogoUploadDialog = dynamic(
    () => import('@/features/brand-logo/BrandLogoUploadDialog')
);
const BrandPickerDialog = dynamic(
    () => import('@/features/billing/BrandPickerDialog')
);
const BrandProrationConfirmDialog = dynamic(
    () => import('@/features/billing/BrandProrationConfirmDialog')
);
const BrandDetachConfirmDialog = dynamic(
    () => import('@/features/billing/BrandDetachConfirmDialog')
);
const BrandDecreaseConfirmDialog = dynamic(
    () => import('@/features/billing/BrandDecreaseConfirmDialog')
);
const DeleteGuideConfirmDialog = dynamic(
    () => import('@/features/admin-guides/DeleteGuideConfirmDialog')
);
const RejectPublicityDialog = dynamic(
    () => import('@/features/admin-payees/RejectPublicityDialog')
);
const DeleteAdminPayeeConfirmDialog = dynamic(
    () => import('@/features/admin-payees/DeleteAdminPayeeConfirmDialog')
);
const DeleteAdminPayeeAccountConfirmDialog = dynamic(
    () => import('@/features/admin-payees/DeleteAdminPayeeAccountConfirmDialog')
);

export function Overlays() {
    return (
        <>
            <DeleteAccountDialog />
            <AvatarUploadDialog />
            <AvatarDeleteConfirmDialog />
            <TermsReacceptDialog />
            <CancelSubscriptionDialog />
            <DeleteBusinessConfirmDialog />
            <DeleteInvoiceConfirmDialog />
            <DeleteAccountConfirmDialog />
            <ResetBusinessSlugConfirmDialog />
            <ResetAccountSlugConfirmDialog />
            <ResetInvoiceSlugConfirmDialog />
            <SlugPresetWarningDialog />
            <MobileMenuSheet />
            <CabinetDrawer />
            <BrandLogoUploadDialog />
            <BrandPickerDialog />
            <BrandProrationConfirmDialog />
            <BrandDetachConfirmDialog />
            <BrandDecreaseConfirmDialog />
            <DeleteGuideConfirmDialog />
            <RejectPublicityDialog />
            <DeleteAdminPayeeConfirmDialog />
            <DeleteAdminPayeeAccountConfirmDialog />
        </>
    );
}
