import { Logo } from '@/entities/brand';
import ChangeTheme from '@/features/change-theme';
import UiButton from '@/shared/ui/UiButton';
import UiHeaderShell from '@/shared/ui/UiHeaderShell';
import { ENV } from '@/shared/config/env';

/**
 * Бренд-бар для публічного payment-host-а (`pay.finly.com.ua`).
 *
 * **Навмисно НЕ кабінетний `widgets/header`.** Той auth-aware (user-меню,
 * аватар, логаут, "Увійти", landing-nav). На pay-host відвідувач — анонімний
 * платник (cookie `bid_refresh` сюди не доходить, немає `Domain=`); auth-меню
 * для нього беззмістовне, а "Увійти" штовхає не туди. Тут лише бренд-якір
 * (довіра "це Finly") + перемикач теми. Жодної навігації, що відволікає від
 * оплати.
 *
 * Server Component — без auth-стану й scroll-анімації. `ChangeTheme` —
 * самодостатній client-острівець під капотом.
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
                <ChangeTheme />
            </UiHeaderShell>
        </div>
    );
}
