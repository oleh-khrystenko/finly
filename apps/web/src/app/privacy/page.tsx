import { Metadata } from 'next';
import { CURRENT_TERMS_VERSION } from '@finly/types';
import { Header } from '@/widgets/header';
import { AppFooter } from '@/widgets/app-footer';
import UiLink from '@/shared/ui/UiLink';
import { fetchMetadata } from '@/shared/seo/metadata';

export function generateMetadata(): Metadata {
    return fetchMetadata({
        page: 'privacy',
        href: 'privacy',
        meta: {
            title: 'Політика конфіденційності — Finly',
            description:
                'Як Finly обробляє персональні дані українських ФОП та бухгалтерів. Що збираємо, що НЕ зберігаємо, права суб’єктів даних.',
        },
        // Drафт під ревʼю юриста (Sprint 1 → Sprint 6); не індексуємо до фіналу.
        noindex: true,
    });
}

const Section = ({
    title,
    children,
}: {
    title: string;
    children: React.ReactNode;
}) => (
    <section className="mt-10 space-y-3">
        <h2 className="text-foreground text-xl font-semibold tracking-tight">
            {title}
        </h2>
        <div className="text-muted-foreground space-y-3 text-base leading-relaxed">
            {children}
        </div>
    </section>
);

export default function PrivacyPage() {
    return (
        <>
            <Header />
            <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
                <h1 className="text-foreground text-3xl font-semibold tracking-tight">
                    Політика конфіденційності
                </h1>
                <p className="text-muted-foreground mt-3 text-sm">
                    Чинна редакція: {CURRENT_TERMS_VERSION}
                </p>

                <Section title="1. Хто оператор персональних даних">
                    <p>
                        Finly (далі — «ми», «сервіс») — SaaS-сервіс для
                        українських фізичних осіб-підприємців (ФОП) та
                        бухгалтерів, що дозволяє генерувати платіжні QR-коди й
                        посилання за стандартом Національного банку України.
                        Сайт сервісу — finly.com.ua.
                    </p>
                    <p>
                        Питання щодо обробки персональних даних:{' '}
                        <UiLink
                            href="mailto:support@finly.com.ua"
                            variant="primary-underline"
                        >
                            support@finly.com.ua
                        </UiLink>
                        .
                    </p>
                </Section>

                <Section title="2. Які дані ми обробляємо">
                    <p>
                        <strong className="text-foreground">
                            Дані акаунту:
                        </strong>{' '}
                        електронна пошта, ім’я, прізвище, аватар (якщо ви
                        підключаєте Google) та хеш паролю (за наявності).
                    </p>
                    <p>
                        <strong className="text-foreground">
                            Реквізити отримувача:
                        </strong>{' '}
                        IBAN, ІПН (для ФОП), назва отримувача, призначення
                        платежу за замовчуванням, перелік банків, з яких ви
                        приймаєте оплати. Ці дані ви додаєте самостійно при
                        створенні отримувача у вашому кабінеті.
                    </p>
                    <p>
                        <strong className="text-foreground">
                            Технічні дані:
                        </strong>{' '}
                        IP-адреса (для захисту від зловживань), логи запитів,
                        дати створення/оновлення сутностей.
                    </p>
                    <p>
                        <strong className="text-foreground">
                            Дані про оплату підписки:
                        </strong>{' '}
                        обробляються нашим платіжним партнером WayForPay; ми
                        зберігаємо лише ідентифікатор підписки і токен картки для
                        списань, не повні реквізити карток.
                    </p>
                </Section>

                <Section title="3. Що ми НЕ збираємо і НЕ обробляємо">
                    <p>
                        Finly — це{' '}
                        <strong className="text-foreground">генератор</strong>{' '}
                        платіжних посилань, а не платіжна установа. Ми{' '}
                        <strong className="text-foreground">
                            не зберігаємо
                        </strong>{' '}
                        реквізити платіжних карток ваших клієнтів,{' '}
                        <strong className="text-foreground">
                            не виконуємо
                        </strong>{' '}
                        переказів і{' '}
                        <strong className="text-foreground">
                            не маємо доступу
                        </strong>{' '}
                        до банківських акаунтів — ні вашого, ні ваших клієнтів.
                    </p>
                    <p>
                        Коли клієнт сканує згенерований нами QR-код або
                        відкриває платіжне посилання, він потрапляє у власний
                        мобільний застосунок банку. Усі подальші дії
                        відбуваються виключно між клієнтом та його банком —
                        Finly у цьому процесі не бере участі.
                    </p>
                </Section>

                <Section title="4. Підстави обробки">
                    <p>
                        Ми обробляємо персональні дані на таких підставах згідно
                        із Законом України «Про захист персональних даних»:
                    </p>
                    <ul className="list-disc space-y-1.5 pl-6">
                        <li>
                            виконання договору (надання послуг сервісу) — для
                            даних акаунту, реквізитів отримувача, оплати
                            підписки;
                        </li>
                        <li>
                            законні інтереси (безпека сервісу, протидія
                            зловживанням) — для технічних даних і логів;
                        </li>
                        <li>
                            ваша згода — для опційних маркетингових комунікацій
                            (можна відкликати у будь-який момент).
                        </li>
                    </ul>
                </Section>

                <Section title="5. Треті сторони">
                    <p>
                        Для надання сервісу ми залучаємо такі компанії
                        («суб-процесори»). Вони обробляють дані лише в обсязі,
                        необхідному для конкретної функції:
                    </p>
                    <ul className="list-disc space-y-1.5 pl-6">
                        <li>
                            <strong className="text-foreground">Google</strong>{' '}
                            — авторизація через Google OAuth (отримання email та
                            публічного імені на момент входу);
                        </li>
                        <li>
                            <strong className="text-foreground">
                                WayForPay
                            </strong>{' '}
                            — обробка платежів за підписку Finly;
                        </li>
                        <li>
                            <strong className="text-foreground">Resend</strong>{' '}
                            — доставка транзакційних email-листів
                            (підтвердження, magic link, нагадування про
                            видалення акаунту);
                        </li>
                        <li>
                            <strong className="text-foreground">
                                Cloudflare R2
                            </strong>{' '}
                            — зберігання завантажених аватарів профілю.
                        </li>
                    </ul>
                </Section>

                <Section title="6. Cookies">
                    <p>Ми використовуємо лише технічно необхідні cookies:</p>
                    <ul className="list-disc space-y-1.5 pl-6">
                        <li>
                            <code className="text-foreground">bid_refresh</code>{' '}
                            — httpOnly-cookie з refresh-токеном для підтримки
                            сесії; видаляється при виході з акаунту.
                        </li>
                    </ul>
                    <p>Аналітичних і трекінгових cookies не використовуємо.</p>
                </Section>

                <Section title="7. Зберігання та видалення">
                    <p>
                        Дані зберігаються поки активний ваш акаунт. Ви можете
                        запросити видалення акаунту в будь-який момент через
                        розділ «Профіль». Видалення відбувається у два етапи:
                    </p>
                    <ul className="list-disc space-y-1.5 pl-6">
                        <li>
                            <strong className="text-foreground">
                                Soft-delete:
                            </strong>{' '}
                            доступ блокується, дані позначаються як видалені,
                            акаунт можна відновити протягом grace-періоду;
                        </li>
                        <li>
                            <strong className="text-foreground">
                                Hard-delete:
                            </strong>{' '}
                            фоновий процес остаточно видаляє дані з нашої БД
                            після завершення grace-періоду.
                        </li>
                    </ul>
                    <p>
                        Дані, які ми зобовʼязані зберігати за вимогами
                        законодавства (наприклад, фіскальні платіжні документи
                        WayForPay), зберігаються протягом строків, встановлених
                        відповідними нормативними актами.
                    </p>
                </Section>

                <Section title="8. Ваші права">
                    <p>Як суб’єкт персональних даних ви маєте право на:</p>
                    <ul className="list-disc space-y-1.5 pl-6">
                        <li>доступ до своїх даних;</li>
                        <li>виправлення некоректних даних;</li>
                        <li>видалення даних;</li>
                        <li>обмеження обробки;</li>
                        <li>заперечення проти обробки;</li>
                        <li>
                            подання скарги до уповноваженого державного органу
                            (Верховна Рада України, Уповноважений з прав
                            людини).
                        </li>
                    </ul>
                    <p>
                        Для реалізації прав звертайтесь на{' '}
                        <UiLink
                            href="mailto:support@finly.com.ua"
                            variant="primary-underline"
                        >
                            support@finly.com.ua
                        </UiLink>
                        . Ми відповімо протягом 30 днів.
                    </p>
                </Section>

                <Section title="9. Зміни до Політики">
                    <p>
                        Ми можемо оновлювати цю Політику. У такому разі ми
                        попросимо вас прийняти нову редакцію при наступному
                        вході в сервіс — без цього подальша робота не можлива.
                        Дата чинної редакції вказана у верхній частині сторінки.
                    </p>
                </Section>

                <Section title="10. Дотичні документи">
                    <p>
                        Ця Політика читається спільно з{' '}
                        <UiLink href="/terms" variant="primary-underline">
                            Умовами використання
                        </UiLink>
                        .
                    </p>
                </Section>
            </main>

            <AppFooter />
        </>
    );
}
