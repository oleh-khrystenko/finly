import { AdminPayeeDetail } from '@/features/admin-payees';

export default async function PayeeDetailPage({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;
    return <AdminPayeeDetail slug={slug} />;
}
