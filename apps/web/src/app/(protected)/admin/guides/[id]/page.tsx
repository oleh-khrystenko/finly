import { GuideEditor } from '@/features/admin-guides';

export default async function EditGuidePage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    return <GuideEditor mode="edit" guideId={id} />;
}
