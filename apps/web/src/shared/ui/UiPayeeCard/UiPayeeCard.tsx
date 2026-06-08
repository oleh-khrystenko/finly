import type { UiPayeeCardProps } from './types';

/**
 * Підписаний блок ідентичності платежу для публічних вивісок: розділяє «кому
 * платять» (Отримувач) і «по чому платять» (Реквізити) у двосекційний `<dl>`,
 * замість злитого речення «Платіж на користь {X} через {Y}». Рядок «Отримувач»
 * опційний (account-page показує отримувача окремим hero-h1).
 *
 * Layout: на mobile рядки stacked (лейбл над значенням), на `sm:` —
 * label-left / value-right (receipt-style). `break-words` проти overflow
 * довгих user-controlled назв на 320px.
 */
const UiPayeeCard = ({
    recipient,
    bankLabel,
    ibanMask,
    accountName,
}: UiPayeeCardProps) => {
    // Власну назву показуємо як primary лише коли вона несе сенс: не дублює
    // банк-лейбл і не є auto-default виду «ПриватБанк •2580» (така назва містить
    // маску → дублювала б технічний рядок). За наявності — назва є людським
    // ідентифікатором (primary), банк + маска стають уточненням (secondary).
    const showAccountName =
        !!accountName &&
        accountName !== bankLabel &&
        !accountName.includes(ibanMask);

    const bankAndMask = (
        <>
            {bankLabel ? `${bankLabel} ` : null}
            <span className="font-mono">{ibanMask}</span>
        </>
    );

    return (
        <dl className="border-border bg-card divide-border divide-y rounded-xl border">
            {recipient ? (
                <div className="flex flex-col gap-1 p-4 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
                    <dt className="text-muted-foreground text-base">
                        Отримувач
                    </dt>
                    <dd className="text-foreground text-lg font-semibold break-words sm:text-right">
                        {recipient}
                    </dd>
                </div>
            ) : null}
            <div className="flex flex-col gap-1 p-4 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
                <dt className="text-muted-foreground text-base">Реквізити</dt>
                <dd className="break-words sm:text-right">
                    {showAccountName ? (
                        <>
                            <span className="text-foreground text-base font-medium">
                                {accountName}
                            </span>
                            <span className="text-muted-foreground mt-0.5 block text-sm">
                                {bankAndMask}
                            </span>
                        </>
                    ) : (
                        <span className="text-foreground text-base">
                            {bankAndMask}
                        </span>
                    )}
                </dd>
            </div>
        </dl>
    );
};

UiPayeeCard.displayName = 'UiPayeeCard';

export default UiPayeeCard;
