import { AdminPayeeAccountEdit } from '@/features/admin-payees';

export default async function PayeeAccountEditPage({
    params,
}: {
    params: Promise<{ slug: string; accountSlug: string }>;
}) {
    const { slug, accountSlug } = await params;
    return <AdminPayeeAccountEdit slug={slug} accountSlug={accountSlug} />;
}
