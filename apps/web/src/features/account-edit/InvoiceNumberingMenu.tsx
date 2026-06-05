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
    onSave: (preset: SlugPreset) => Promise<void>;
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
 * **`null` без окремого пункту:** `account.invoiceSlugPresetDefault === null`
 * (не налаштована нумерація) резолвиться на `DEFAULT_PRESET` у
 * `CreateInvoiceForm`, тож показуємо його як активний "Послідовний" замість
 * дубльованого "За замовчуванням" з тим самим результатом. Меню задає лише
 * явні пресети — `null` лишається тільки початковим станом, не вибором.
 */

interface PresetOption {
    value: SlugPreset;
    label: string;
    example: string;
}

/** Дзеркалить `?? 'simple'`-резолв `null`-нумерації у `CreateInvoiceForm`. */
const DEFAULT_PRESET: SlugPreset = 'simple';

const OPTIONS: PresetOption[] = [
    { value: 'simple', label: 'Послідовний', example: '001' },
    { value: 'with-month', label: 'Рік і місяць', example: 'рік-місяць-001' },
    { value: 'with-year', label: 'Рік', example: 'рік-001' },
    {
        value: 'with-purpose',
        label: 'За призначенням',
        example: 'призначення-001',
    },
];

export default function InvoiceNumberingMenu({ value, onSave }: Props) {
    const openWarning = useSlugPresetWarningStore((s) => s.open);
    const activeValue: SlugPreset = value ?? DEFAULT_PRESET;
    const current =
        OPTIONS.find((o) => o.value === activeValue) ?? OPTIONS[0];

    const items: UiDropdownMenuItem[] = OPTIONS.map((o) => {
        const isActive = o.value === activeValue;
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
        const selected = OPTIONS.find((o) => o.value === formValue);
        if (!selected || selected.value === activeValue) return;
        const next = selected.value;

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
            // Mobile-first: базово (sm) — компактний попап, що влазить у 375px;
            // від xs: (430px) виростає до md (більші падінги, шрифт, іконка).
            size="sm"
            itemClassName="xs:px-4 xs:py-2 xs:text-base xs:[&_svg]:size-5"
            badgeClassName="xs:text-sm"
            header={
                <p className="text-muted-foreground text-sm font-medium whitespace-nowrap xs:text-base">
                    Формат номера
                </p>
            }
            trigger={
                // Тригер-селектор: показує приклад поточного формату навіть
                // коли меню закрите (приклад конкретніший за назву пресету).
                // Слово "Формат" робить голий приклад читабельним; повна назва
                // пресету — в aria-label.
                <UiButton
                    type="button"
                    variant="outline"
                    size="md"
                    aria-label={`Формат номера: ${current.label}. Змінити`}
                    IconLeft={<Settings2 />}
                >
                    <span className="text-muted-foreground font-normal">
                        Формат
                    </span>
                    {' '}
                    <span className="text-foreground font-semibold">
                        {current.example}
                    </span>
                </UiButton>
            }
        />
    );
}
