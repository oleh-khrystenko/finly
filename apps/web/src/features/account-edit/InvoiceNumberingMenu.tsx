'use client';

import { Check, Settings2 } from 'lucide-react';
import type { SlugPreset } from '@finly/types';
import UiButton from '@/shared/ui/UiButton';
import UiDropdownMenu from '@/shared/ui/UiDropdownMenu';
import type { UiDropdownMenuItem } from '@/shared/ui/UiDropdownMenu';
import { composeClasses } from '@/shared/lib';
import { useSlugPresetWarningStore } from '@/entities/invoice';

interface Props {
    value: SlugPreset | null;
    onSave: (preset: SlugPreset | null) => Promise<void>;
}

/**
 * Sprint 15 §UI — демоут "Налаштування інвойсів" у підрядний gear-control у
 * хедері картки "Інвойси". Замість окремої важкої картки на один дропдаун —
 * шестерня поряд з "Виставити інвойс", що відкриває меню вибору формату
 * нумерації. Список лишається єдиним головним фокусом, конфіг — тертіарний.
 *
 * **Instant-apply:** вибір пресету одразу PATCH-ить рахунок (без save-кнопки) —
 * це преференс "постав і забудь", не форма. `with-purpose` спершу тригерить
 * privacy-warning (`useSlugPresetWarningStore`); confirm → apply, cancel → no-op.
 *
 * **Семантика `null`** ("За замовчуванням") = використати глобальний дефолт
 * системи (`simple`).
 */

interface PresetOption {
    value: SlugPreset | 'null';
    label: string;
    example: string;
}

const OPTIONS: PresetOption[] = [
    { value: 'null', label: 'За замовчуванням', example: 'inv-001' },
    { value: 'simple', label: 'Простий номер', example: 'inv-001' },
    { value: 'with-month', label: 'З місяцем', example: '2026-05-001' },
    { value: 'with-year', label: 'З роком', example: '2026-001' },
    { value: 'with-purpose', label: 'З призначенням', example: 'oplata-…' },
];

function toFormValue(preset: SlugPreset | null): string {
    return preset ?? 'null';
}

function fromFormValue(formValue: string): SlugPreset | null {
    return formValue === 'null' ? null : (formValue as SlugPreset);
}

export default function InvoiceNumberingMenu({ value, onSave }: Props) {
    const openWarning = useSlugPresetWarningStore((s) => s.open);
    const activeValue = toFormValue(value);
    const current =
        OPTIONS.find((o) => o.value === activeValue) ?? OPTIONS[0];

    const items: UiDropdownMenuItem[] = OPTIONS.map((o) => {
        const isActive = activeValue === o.value;
        return {
            value: o.value,
            // Активний пресет — у primary + bold, щоб обраний пункт читався
            // одразу (бейдж-pill сам по собі не виділяв вибір).
            label: (
                <span className={isActive ? 'text-primary font-medium' : undefined}>
                    {o.label}
                </span>
            ),
            badge: o.example,
            // Check у primary на активному; прозорий placeholder на решті
            // тримає вирівнювання лейблів (icon-слот завжди присутній).
            icon: (
                <Check
                    className={composeClasses(
                        'text-primary',
                        !isActive && 'opacity-0'
                    )}
                />
            ),
        };
    });

    const handleSelect = (formValue: string) => {
        const next = fromFormValue(formValue);
        if (next === value) return;

        const apply = () => {
            // Помилку вже показує toast у parent-handler-і; ковтаємо rejection,
            // щоб не лишити unhandled promise (instant-apply без await-UI).
            void onSave(next).catch(() => undefined);
        };

        if (next === 'with-purpose') {
            openWarning(apply, () => undefined);
            return;
        }
        apply();
    };

    return (
        <UiDropdownMenu
            items={items}
            onSelect={handleSelect}
            activeValue={activeValue}
            align="end"
            size="md"
            header={
                <p className="text-muted-foreground text-base font-medium whitespace-nowrap">
                    Нумерація нових інвойсів
                </p>
            }
            trigger={
                // Тригер-селектор: показує поточний формат нумерації навіть
                // коли меню закрите. Desktop — повна назва пресету, mobile —
                // компактний приклад (щоб не переповнити хедер на 360px).
                <UiButton
                    type="button"
                    variant="outline"
                    size="md"
                    aria-label={`Нумерація нових інвойсів: ${current.label}. Змінити`}
                    // Шестерня лише на desktop — на mobile звільняє місце в
                    // хедері (заголовок + тригер + CTA у 360px).
                    IconLeft={<Settings2 className="hidden sm:block" />}
                >
                    <span className="hidden sm:inline">{current.label}</span>
                    <span className="sm:hidden">{current.example}</span>
                </UiButton>
            }
        />
    );
}
