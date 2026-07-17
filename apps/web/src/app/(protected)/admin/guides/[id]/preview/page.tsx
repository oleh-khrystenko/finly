import { GuidePreview } from '@/widgets/guide-preview';

export default async function GuidePreviewPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    return <GuidePreview guideId={id} />;
}
