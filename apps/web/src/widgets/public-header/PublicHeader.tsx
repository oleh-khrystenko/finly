import { Logo } from '@/entities/brand';
import ChangeTheme from '@/features/change-theme';
import UiButton from '@/shared/ui/UiButton';
import UiHeaderShell from '@/shared/ui/UiHeaderShell';
import { ENV } from '@/shared/config/env';
import PublicHeaderAuth from './PublicHeaderAuth';

/**
 * Бренд-бар для публічного payment-host-а (`pay.finly.com.ua`).
 *
 * **Навмисно НЕ кабінетний `widgets/header`.** Той тягне landing-навігацію,
 * scroll-анімацію і мобільне меню кабінету — на сторінці оплати це зайве
 * відволікання. Тут лише бренд-якір (довіра «це Finly»), перемикач теми і, зі
 * Sprint 30, auth-острівець: сесія стала спільною для обох хостів, тож
 * залогінений бачить своє меню, а анонім — кнопку входу.
 *
 * Server Component — без auth-стану й scroll-анімації. `ChangeTheme` і
 * `PublicHeaderAuth` — самодостатні client-острівці: серверний рендер
 * публічної сторінки лишається однаковим для всіх і кешованим.
 *
 * Лого веде на marketing-origin (`NEXT_PUBLIC_BASE_URL`) у новій вкладці: на
 * pay-host `/` — це business-root без slug-а (404), тому "додому" для бренду —
 * це продуктовий сайт. Нова вкладка зберігає незавершений платіж.
 */
export function PublicHeader() {
    return (
        <div className="sticky top-0 z-50">
            <div
                className="liquid-glass border-b-liquid-glass-border absolute inset-0 border-b"
                aria-hidden="true"
            />
            <UiHeaderShell className="relative z-10">
                <UiButton
                    as="a"
                    href={ENV.NEXT_PUBLIC_BASE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    variant="text"
                    size="md"
                    className="p-0"
                    aria-label="Finly — дізнатися більше"
                >
                    <Logo />
                </UiButton>
                <div className="flex items-center gap-2">
                    <ChangeTheme />
                    <PublicHeaderAuth />
                </div>
            </UiHeaderShell>
        </div>
    );
}
