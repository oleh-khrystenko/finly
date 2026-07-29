'use client';

import UiButton from '@/shared/ui/UiButton';
import { ENV } from '@/shared/config';
import { dismissTaxProfilePrompt } from '@/shared/api';
import { useAuthStore } from '@/entities/user';

const CABINET_URL = ENV.NEXT_PUBLIC_BASE_URL.replace(/\/$/, '');

/**
 * Sprint 30 — разова пропозиція заповнити власні податкові дані. Показується
 * залогіненому, у якого в профілі немає РНОКПП, і рівно доти, доки він її не
 * відхилить: відмова стемпиться на сервері, тож пропозиція не переслідує
 * людину при кожному заході на податкову сторінку.
 *
 * Свідомо не модалка: сторінка платіжна, і перекривати її діалогом означало б
 * ставити нашу пропозицію вище за дію, по яку людина прийшла.
 */
export default function TaxProfilePrompt() {
    const user = useAuthStore((s) => s.user);
    const setUser = useAuthStore((s) => s.setUser);

    if (!user || user.profile.taxId || user.taxProfilePromptDismissedAt) {
        return null;
    }

    const handleDismiss = () => {
        // Відмову проставляємо у профіль у пам'яті вкладки, а не локальним
        // прапорцем компонента: на pay-хості між сторінками оплати ходять
        // клієнтською навігацією (каталог → отримувач), профіль по дорозі не
        // перечитується, і локальний прапорець зникав би разом з компонентом —
        // людина, яка щойно сказала «ні», бачила б ту саму пропозицію на
        // наступній сторінці.
        //
        // Стемп на сервері — не умова показу тут: мережева помилка не має
        // повертати пропозицію назад. Наступний захід за провалу покаже її ще
        // раз (профіль прийде з сервера без дати) — прийнятніше, ніж зависла
        // плашка.
        setUser({ ...user, taxProfilePromptDismissedAt: new Date() });
        void dismissTaxProfilePrompt().catch((err: unknown) => {
            console.warn('[TaxProfilePrompt] failed to dismiss', err);
        });
    };

    return (
        <div className="border-border bg-card space-y-3 rounded-xl border p-4">
            <p className="text-foreground text-sm">
                Заповніть свої податкові дані у профілі — і наступного разу поля
                нижче заповняться самі.
            </p>
            <div className="flex flex-wrap items-center gap-2">
                <UiButton
                    as="a"
                    href={`${CABINET_URL}/profile`}
                    variant="filled"
                    size="sm"
                >
                    Заповнити профіль
                </UiButton>
                <UiButton
                    type="button"
                    variant="text"
                    size="sm"
                    onClick={handleDismiss}
                >
                    Не пропонувати
                </UiButton>
            </div>
        </div>
    );
}
