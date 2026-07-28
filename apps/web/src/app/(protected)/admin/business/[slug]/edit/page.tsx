import { AdminPayeeEdit } from '@/features/admin-payees';

export default async function EditPayeePage({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = await params;
    return <AdminPayeeEdit slug={slug} />;
}
