import { Plus } from 'lucide-react';

import UiLink from '@/shared/ui/UiLink';
import { JsonLd } from '@/shared/seo/JsonLd';

/**
 * FAQ на лендінгу. Обробляє реальні заперечення там, де відвідувач вирішує,
 * реєструватись чи ні (банк чи ні, комісії, банки, ціна, безпека).
 *
 * `answer` — плоский текст, єдине джерело і для видимого блоку, і для
 * FAQPage-розмітки, тож вони не розходяться. `link` веде у профільну статтю
 * довідки описовим анкором (внутрішнє перелінкування лендінг → help).
 *
 * Розмітка FAQPage лишається свідомо: Google прибрав FAQ rich results у
 * травні 2026, але тип валідний і його читають AI-пошук та парсери сутностей.
 * Ціль розмітки — машинне розуміння і AEO, не «зірочки» у видачі.
 *
 * Server Component: нативні <details>, без клієнтського JS.
 */

interface FaqItem {
    question: string;
    answer: string;
    link: { href: string; label: string };
}

const FAQ: readonly FaqItem[] = [
    {
        question: 'Finly це банк? Ви маєте доступ до моїх грошей?',
        answer: 'Ні. Finly не банк і не платіжна установа. Ми не проводимо переказів і не маємо доступу до ваших рахунків. Гроші йдуть напряму від клієнта до його банку, а Finly лише готує платіжну команду за стандартом НБУ, яку читає банк клієнта.',
        link: {
            href: '/help/yak-pratsiuie-qr',
            label: 'Як працює платіжний QR-код',
        },
    },
    {
        question: 'Які комісії бере Finly за платежі?',
        answer: 'Finly не бере комісій за самі платежі, бо не бере участі в переказі коштів: клієнт платить у своєму банку на звичайних умовах цього банку. Платна у Finly лише послуга «Бренд» з власним оформленням сторінки оплати.',
        link: { href: '/help/taryfy-finly', label: 'Тарифи Finly' },
    },
    {
        question: 'У яких банках це працює?',
        answer: 'У будь-якому банку клієнта, чий застосунок читає платіжний QR-код за стандартом НБУ, а це всі великі українські банки. Клієнту не потрібен акаунт Finly: він сканує код у своєму застосунку і підтверджує оплату.',
        link: {
            href: '/help/storinka-oplaty',
            label: 'Сторінка оплати і як нею ділитися',
        },
    },
    {
        question: 'Користуватися Finly безкоштовно?',
        answer: 'Так. Отримувачі, реквізити, рахунки, сторінки оплати і QR-коди безкоштовні і без обмежень кількості. Окремо оплачується лише послуга «Бренд»: власна адреса сторінки оплати і ваш логотип.',
        link: { href: '/help/taryfy-finly', label: 'Тарифи Finly' },
    },
    {
        question: 'Чи безпечно, що мої реквізити на публічній сторінці?',
        answer: 'Сторінка оплати не показує повний IBAN текстом: видно лише останні цифри для впізнавання. Повні реквізити передаються тільки через платіжний код, який читає банк, тож ваші дані не розходяться зайвими копіями в переписці.',
        link: {
            href: '/help/storinka-oplaty',
            label: 'Сторінка оплати і як нею ділитися',
        },
    },
] as const;

export function LandingFaq() {
    return (
        <section
            id="faq"
            aria-labelledby="faq-heading"
            className="bg-background"
        >
            <div className="container mx-auto px-6 py-16 md:py-24">
                <div className="mx-auto mb-12 max-w-2xl text-center md:mb-16">
                    <h2
                        id="faq-heading"
                        className="text-foreground text-3xl font-semibold tracking-tight sm:text-4xl"
                    >
                        Часті запитання
                    </h2>
                </div>

                <div className="mx-auto max-w-3xl divide-y divide-border/70">
                    {FAQ.map((item) => (
                        <details
                            key={item.question}
                            className="group py-5"
                        >
                            <summary className="text-foreground flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-medium">
                                {item.question}
                                <Plus
                                    aria-hidden
                                    className="text-muted-foreground size-5 shrink-0 transition-transform group-open:rotate-45"
                                />
                            </summary>
                            <div className="text-muted-foreground mt-3 text-base leading-relaxed">
                                <p>{item.answer}</p>
                                <p className="mt-2">
                                    <UiLink
                                        as="link"
                                        href={item.link.href}
                                        variant="primary"
                                    >
                                        Докладніше: {item.link.label}
                                    </UiLink>
                                </p>
                            </div>
                        </details>
                    ))}
                </div>
            </div>

            <JsonLd
                data={{
                    '@context': 'https://schema.org',
                    '@type': 'FAQPage',
                    mainEntity: FAQ.map((item) => ({
                        '@type': 'Question',
                        name: item.question,
                        acceptedAnswer: {
                            '@type': 'Answer',
                            text: item.answer,
                        },
                    })),
                }}
            />
        </section>
    );
}
