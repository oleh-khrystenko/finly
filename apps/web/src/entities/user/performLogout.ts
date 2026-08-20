import { logout } from '@/shared/api';
import { isPublicHost } from '@/shared/config/publicHosts';
import { useAuthStore } from './authStore';

/**
 * Єдина послідовність виходу з акаунта для всього застосунку: серверний revoke
 * → скидання локального стану → перезавантаження сторінки. Живе в `entities`,
 * бо володіє станом поточного користувача, і доступна всім вищим шарам
 * (акаунт-меню кабінету, меню публічної шапки, діалог оновлених умов) — раніше
 * ця послідовність існувала трьома копіями, які встигли розійтися.
 *
 * Server-side revoke — best-effort: interceptor пропускає `/auth/logout`-помилки
 * наскрізь, і без catch користувач лишався б «не вийшов» без жодної реакції.
 * Локальний вихід виконується завжди; невідкликаний refresh-token доживе до TTL
 * або ротації.
 *
 * Куди веде вихід — визначає хост, а не caller. На публічній pay-зоні сторінка
 * оплати доступна анонімам, а `/` там веде у каталог, тож людина лишається там,
 * де платила. Перезавантаження, а не просто зміна стану: разом зі сторінкою
 * зникають підставлені у форму дані платника — на спільному комп'ютері
 * наступний відвідувач їх не побачить. У кабінеті йдемо на корінь.
 */
export async function performLogout(): Promise<void> {
    try {
        await logout();
    } catch (error) {
        console.warn('Logout request failed', error);
    }

    useAuthStore.getState().clearUser();

    if (isPublicHost(window.location.host)) {
        window.location.reload();
        return;
    }

    window.location.assign('/');
}
