import { useCallback } from 'react';
import { toast } from 'sonner';
import { getApiMessage, updateProfile } from '@/shared/api';
import { useAuthStore } from './authStore';

/**
 * Sprint 18 design — робочий контекст «власні / клієнтські отримувачі».
 *
 * Раніше це був toggle "Режим бухгалтера" в попапі від аватарки (Sprint 3
 * §E5). Перемикач переїхав на сторінку отримувачів як segmented-control, бо
 * його ефект (фільтр списку + дефолт для створення) живе саме там, а не у
 * глобальному меню акаунта.
 *
 * `worksAsBookkeeper` лишається персистентним дефолтним контекстом на
 * користувачі: backend фільтрує список бізнесів за цим прапором, тож зміна
 * сегмента і змінює вид, і запам'ятовує його до наступного логіну.
 *
 * Логіка:
 *   1. Optimistic-flip у `authStore` — миттєвий feedback (chip + re-fetch).
 *   2. PATCH `/users/me { worksAsBookkeeper: next }`.
 *   3. На fail — rollback authStore + UA-toast (mapApiCode).
 */
export function useBookkeeperMode() {
    const user = useAuthStore((s) => s.user);
    const setUser = useAuthStore((s) => s.setUser);

    const isBookkeeper = user?.worksAsBookkeeper ?? false;

    const setBookkeeper = useCallback(
        async (next: boolean) => {
            // No-op, якщо контекст уже активний — UiChipGroup і так не
            // викликає onChange на повторний вибір, це лише захист.
            if (!user || user.worksAsBookkeeper === next) return;

            const previous = user.worksAsBookkeeper;
            setUser({ ...user, worksAsBookkeeper: next });
            try {
                await updateProfile({ worksAsBookkeeper: next });
            } catch (err) {
                setUser({ ...user, worksAsBookkeeper: previous });
                const code =
                    (
                        err as {
                            response?: { data?: { error?: { code?: string } } };
                        }
                    )?.response?.data?.error?.code ?? 'unknown';
                toast.error(getApiMessage(code, 'users'));
            }
        },
        [user, setUser]
    );

    return { isBookkeeper, setBookkeeper };
}
