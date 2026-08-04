import { ArrowRight } from 'lucide-react';
import {
    BANK_LABEL,
    CATALOG_CATEGORY_LABEL,
    type CatalogPayee,
    type PublicCatalogView,
} from '@finly/types';
import UiLink from '@/shared/ui/UiLink';
import UiVerifiedBadge from '@/shared/ui/UiVerifiedBadge';
import { formatPayeeName } from '@/entities/business';

interface Props {
    catalog: PublicCatalogView;
    /**
     * Origin pay-зони для карток, показаних ПОЗА нею (кабінет). На самій
     * pay-зоні лишається `undefined` — там адреса відносна, і клієнтська
     * навігація Next.js працює як і працювала.
     */
    linkOrigin?: string;
}

/**
 * Секції каталогу з картками отримувачів — спільне тіло публічної вітрини
 * (`PublicCatalog`) і кабінетної сторінки. Порядок і склад секцій визначає
 * бекенд; whitelist уже без реквізитів, тут лише показ.
 */
export default function CatalogSections({ catalog, linkOrigin }: Props) {
    return (
        <>
            {catalog.sections.map((section) => (
                <section key={section.category} className="space-y-4">
                    <h2 className="text-foreground text-xl font-semibold">
                        {CATALOG_CATEGORY_LABEL[section.category]}
                    </h2>
                    <ul className="space-y-3">
                        {section.payees.map((payee) => (
                            <li key={payee.slug}>
                                <PayeeCard
                                    payee={payee}
                                    linkOrigin={linkOrigin}
                                />
                            </li>
                        ))}
                    </ul>
                </section>
            ))}
        </>
    );
}

const CARD_CLASSES =
    'group border-border bg-card hover:border-primary/40 hover:bg-muted/40 flex items-center gap-4 rounded-xl border p-4 transition-colors';

function PayeeCard({
    payee,
    linkOrigin,
}: {
    payee: CatalogPayee;
    linkOrigin?: string;
}) {
    const payeeName = formatPayeeName(payee.type, payee.name);
    const path = `/${encodeURIComponent(payee.slug)}`;
    const requisites = payee.accounts.map(accountLabel).filter(Boolean);
    const meta =
        requisites.length > 0 ? requisites.join(', ') : 'Переглянути реквізити';

    const body = (
        <>
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <p className="text-foreground truncate text-base font-semibold">
                        {payeeName}
                    </p>
                    {payee.isSystem && <UiVerifiedBadge size="sm" />}
                </div>
                <p className="text-muted-foreground mt-0.5 truncate text-sm">
                    {meta}
                </p>
            </div>
            <span
                className="text-primary inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold"
                aria-hidden
            >
                Відкрити
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </span>
        </>
    );

    // Перехід між хостами — звичайний anchor: клієнтська навігація Next.js
    // працює лише в межах одного origin. Нова вкладка тут не прикраса: людина
    // прийшла з робочої сторінки кабінету і має повернутись до неї після
    // оплати, а не шукати шлях назад через історію чужого хоста.
    if (linkOrigin) {
        return (
            <UiLink
                href={`${linkOrigin.replace(/\/$/, '')}${path}`}
                variant="unstyled"
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Відкрити отримувача: ${payeeName} (у новій вкладці)`}
                className={CARD_CLASSES}
            >
                {body}
            </UiLink>
        );
    }

    return (
        <UiLink
            as="link"
            href={path}
            variant="unstyled"
            aria-label={`Відкрити отримувача: ${payeeName}`}
            className={CARD_CLASSES}
        >
            {body}
        </UiLink>
    );
}

function accountLabel(account: CatalogPayee['accounts'][number]): string {
    if (account.name) return account.name;
    if (account.bankCode !== null) return BANK_LABEL[account.bankCode];
    return '';
}
