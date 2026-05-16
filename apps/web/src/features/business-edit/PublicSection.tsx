'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { type Business } from '@finly/types';
import UiButton from '@/shared/ui/UiButton';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSwitch from '@/shared/ui/UiSwitch';

interface Props {
    business: Business;
    /** Public payment-page origin (NEXT_PUBLIC_PAY_PUBLIC_URL чи аналог). */
    payPublicOrigin: string;
    onSave: (patch: Pick<Business, 'seoIndexEnabled'>) => Promise<void>;
}

export default function PublicSection({
    business,
    payPublicOrigin,
    onSave,
}: Props) {
    const [copying, setCopying] = useState(false);
    const [seoSaving, setSeoSaving] = useState(false);

    const publicUrl = `${payPublicOrigin.replace(/\/$/, '')}/${business.slug}`;

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(publicUrl);
            setCopying(true);
            setTimeout(() => setCopying(false), 1500);
        } catch {
            toast.error('Не вдалося скопіювати');
        }
    };

    const handleSeoToggle = async (next: boolean) => {
        setSeoSaving(true);
        try {
            await onSave({ seoIndexEnabled: next });
        } catch {
            toast.error('Не вдалося оновити SEO-налаштування');
        } finally {
            setSeoSaving(false);
        }
    };

    return (
        <UiSectionCard title="Публічна сторінка">
            <div className="space-y-4">
                <div>
                    <p className="text-muted-foreground text-xs font-medium">
                        Slug
                    </p>
                    <p className="text-foreground mt-1 font-mono text-sm">
                        {business.slug}
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                        У безкоштовному тарифі змінити не можна
                    </p>
                </div>
                <div>
                    <p className="text-muted-foreground text-xs font-medium">
                        Посилання на сторінку
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                        <code className="bg-muted text-foreground min-w-0 flex-1 truncate rounded-md px-2 py-1 text-xs">
                            {publicUrl}
                        </code>
                        <UiButton
                            type="button"
                            variant="icon-compact"
                            size="sm"
                            onClick={() => void handleCopy()}
                            aria-label="Копіювати посилання"
                            IconLeft={copying ? <Check /> : <Copy />}
                        />
                    </div>
                </div>
                <label
                    htmlFor="seo-toggle"
                    className="border-border flex cursor-pointer items-start justify-between gap-3 rounded-md border p-3"
                >
                    <div className="flex flex-1 flex-col gap-1">
                        <span className="text-foreground text-sm font-medium">
                            Показувати в Google
                        </span>
                        <span className="text-muted-foreground text-xs">
                            Дозволити індексацію публічної сторінки пошуковими
                            системами
                        </span>
                    </div>
                    <UiSwitch
                        id="seo-toggle"
                        checked={business.seoIndexEnabled}
                        disabled={seoSaving}
                        onChange={(next) => void handleSeoToggle(next)}
                    />
                </label>
            </div>
        </UiSectionCard>
    );
}
