import UiButton from '@/shared/ui/UiButton';

/**
 * Sprint 8 §8.6 — content-complete hero для `finly.com.ua/`.
 *
 * **Чому 3 benefit-tiles, а не "усе що захочемо"**: кожен tile описує
 * **конкретний** факт продукту (а не маркетинг-копію). Якщо tile неможливо
 * зв'язати з реальним product-constraint, він не належить до Sprint 8 hero.
 *
 *  1. **Стандарт НБУ** — посилання на постанову № 97. Єдина існуюча
 *     нормативна база; реальна юридична прив'язка, не перебільшення.
 *  2. **Один тап** — реальний UX flow universal-link → app-link → банк-
 *     додаток. Sprint 2 §2.1 builder + Sprint 3 §3.7 host-aware routing
 *     забезпечують це поведінково.
 *  3. **Без комісій від Finly** — фактичне обмеження бізнес-моделі MVP.
 *     Sprint 6 додасть Paid-плани, але % з платежу не входить у roadmap
 *     (qr-decisions.md §1.12 — модель А "тупий генератор").
 *
 * **Server Component** (без `'use client'`) — статика без state. Інтерактивність
 * (анкори `<a href="#try-now">`) — нативна browser-функція, без React
 * client-runtime overhead.
 */
export function LandingHero() {
    return (
        <section className="container mx-auto px-6 py-20">
            <div className="text-center">
                <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">
                    Платіжні QR-коди
                    <br />
                    <span className="text-primary">
                        для українського бізнесу
                    </span>
                </h1>
                <p className="text-muted-foreground mx-auto mt-6 max-w-2xl text-lg">
                    Згенеруйте QR-код за стандартом НБУ і прийміть оплату в один
                    тап з будь-якого банк-додатку.
                </p>
                <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
                    <UiButton
                        as="a"
                        href="#try-now"
                        variant="filled"
                        size="lg"
                    >
                        Спробувати без реєстрації
                    </UiButton>
                    <UiButton
                        as="link"
                        href="/auth/signin"
                        variant="outline"
                        size="lg"
                    >
                        Зареєструватися
                    </UiButton>
                </div>
            </div>

            <ul className="mx-auto mt-16 grid max-w-4xl gap-6 sm:grid-cols-3">
                <li className="bg-card border-border rounded-xl border p-6">
                    <h3 className="text-base font-medium">Стандарт НБУ</h3>
                    <p className="text-muted-foreground mt-2 text-sm">
                        Формат 003 згідно постанови № 97 — сумісний з усіма
                        банк-додатками України.
                    </p>
                </li>
                <li className="bg-card border-border rounded-xl border p-6">
                    <h3 className="text-base font-medium">Один тап</h3>
                    <p className="text-muted-foreground mt-2 text-sm">
                        Клієнт сканує QR або відкриває посилання — банк-додаток
                        запускається з заповненими реквізитами.
                    </p>
                </li>
                <li className="bg-card border-border rounded-xl border p-6">
                    <h3 className="text-base font-medium">
                        Без комісій від Finly
                    </h3>
                    <p className="text-muted-foreground mt-2 text-sm">
                        Сервіс не утримує процент із платежу. Гроші йдуть
                        напряму на ваш IBAN.
                    </p>
                </li>
            </ul>
        </section>
    );
}
