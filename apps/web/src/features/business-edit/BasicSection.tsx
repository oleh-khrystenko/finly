'use client';

import {
    BUSINESS_TYPE_LABEL,
    businessNameSchema,
    type Business,
} from '@finly/types';
import UiInput from '@/shared/ui/UiInput';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import EditableField from './EditableField';

interface Props {
    business: Business;
    onSave: (patch: Partial<Pick<Business, 'name'>>) => Promise<void>;
}

export default function BasicSection({ business, onSave }: Props) {
    return (
        <UiSectionCard title="Основне">
            <div className="space-y-4">
                <div>
                    <p className="text-muted-foreground text-xs font-medium">
                        Тип
                    </p>
                    <p className="text-foreground mt-1 text-sm">
                        {BUSINESS_TYPE_LABEL[business.type]}
                    </p>
                </div>
                <EditableField<string>
                    label="Назва"
                    value={business.name}
                    renderRead={(v) => v}
                    renderEdit={({ value, setValue, error }) => (
                        <UiInput
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            error={error}
                        />
                    )}
                    validate={(v) => {
                        const r = businessNameSchema.safeParse(v);
                        return r.success
                            ? null
                            : (r.error.issues[0]?.message ?? 'Невірне значення');
                    }}
                    onSave={(v) => onSave({ name: v })}
                />
            </div>
        </UiSectionCard>
    );
}
