import { ArrowRight } from 'lucide-react';
import {
    BANK_LABEL,
    CATALOG_CATEGORY_LABEL,
    type CatalogPayee,
    type PublicCatalogView,
} from '@finly/types';
import UiLink from '@/shared/ui/UiLink';
import { formatPayeeName } from '@/entities/business';

interface Props {
    catalog: PublicCatalogView;
}

/**
 * Sprint 29 — публічний каталог отримувачів на головній pay-хоста. Секції за
 * категоріями (порядок і склад визначає бекенд), у кожній картки отримувачів,
 * що ведуть на їхню чинну публічну сторінку. Whitelist із бекенду вже без
 * реквізитів, тут лише показ.
 */
export default function PublicCatalog({ catalog }: Props) {
    return (
        <div className="mx-auto max-w-2xl space-y-12 px-4 py-12">
            <header className="space-y-2 text-center">
                <h1 className="text-foreground text-2xl font-bold tracking-tight md:text-3xl">
                    Перевірені отримувачі
                </h1>
                <p className="text-muted-foreground text-base">
                    Готові сторінки для оплати податків, зборів і благодійних
                    внесків. Оберіть отримувача і платіть за QR-кодом.
                </p>
            </header>

            {catalog.sections.map((section) => (
                <section key={section.category} className="space-y-4">
                    <h2 className="text-foreground text-xl font-semibold">
                        {CATALOG_CATEGORY_LABEL[section.category]}
                    </h2>
                    <ul className="space-y-3">
                        {section.payees.map((payee) => (
                            <li key={payee.slug}>
                                <PayeeCard payee={payee} />
                            </li>
                        ))}
                    </ul>
                </section>
            ))}
        </div>
    );
}

function PayeeCard({ payee }: { payee: CatalogPayee }) {
    const payeeName = formatPayeeName(payee.type, payee.name);
    const href = `/${encodeURIComponent(payee.slug)}`;
    const requisites = payee.accounts.map(accountLabel).filter(Boolean);
    const meta =
        requisites.length > 0 ? requisites.join(', ') : 'Переглянути реквізити';

    return (
        <UiLink
            as="link"
            href={href}
            variant="unstyled"
            aria-label={`Відкрити отримувача: ${payeeName}`}
            className="group border-border bg-card hover:border-primary/40 hover:bg-muted/40 flex items-center gap-4 rounded-xl border p-4 transition-colors"
        >
            <div className="min-w-0 flex-1">
                <p className="text-foreground truncate text-base font-semibold">
                    {payeeName}
                </p>
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
        </UiLink>
    );
}

function accountLabel(account: CatalogPayee['accounts'][number]): string {
    if (account.name) return account.name;
    if (account.bankCode !== null) return BANK_LABEL[account.bankCode];
    return '';
}
