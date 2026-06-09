'use client';

import UiBankAppGrid from '@/shared/ui/UiBankAppGrid';
import UiButton from '@/shared/ui/UiButton';
import UiDisclosure from '@/shared/ui/UiDisclosure';
import UiQrImage from '@/shared/ui/UiQrImage';
import type { UiPaymentOptionsProps } from './types';

const qrImageClass =
    'border-border mx-auto w-full max-w-[240px] rounded-md border bg-white';

/**
 * «Один шлях» оплати на публічних вивісках (account + invoice): сітка банків —
 * єдина помітна дія; app-link на інший банк і QR для стороннього пристрою
 * сховані під disclosure. Технічний primary/legacy НБУ-host прихований від
 * платника. Спільний для `account-public` і `invoice-public` (cross-feature
 * import заборонений FSD — composite живе у shared/ui, як `UiBankAppGrid`).
 */
const UiPaymentOptions = ({
    nbuLinks,
    qrPrimary,
    qrLegacy,
}: UiPaymentOptionsProps) => (
    <div className="space-y-8">
        <div className="space-y-3">
            <h2 className="text-foreground text-center text-base font-semibold">
                Оберіть банк для оплати
            </h2>
            <UiBankAppGrid
                nbuLegacyLink={nbuLinks.legacy}
                nbuFallbackLink={nbuLinks.primary}
            />
        </div>

        <div className="space-y-4">
            <UiDisclosure align="center" label="Мого банку немає у списку">
                {/* Зовнішні платіжні `bank://`-схеми — native <a> через UiButton
                    as="a" (Next <Link> підставив би client-router, що не знає про
                    non-http протоколи). */}
                <div className="space-y-2">
                    <UiButton
                        as="a"
                        href={nbuLinks.primary}
                        rel="external"
                        variant="filled"
                        size="md"
                        className="w-full"
                    >
                        Відкрити банк-додаток
                    </UiButton>
                    <UiButton
                        as="a"
                        href={nbuLinks.legacy}
                        rel="external"
                        variant="text"
                        size="sm"
                        className="w-full"
                    >
                        Інший спосіб, якщо не відкрилось
                    </UiButton>
                </div>
            </UiDisclosure>

            <UiDisclosure
                align="center"
                label="Показати QR для іншого пристрою"
            >
                <div className="space-y-3">
                    <figure className="space-y-2 text-center">
                        <UiQrImage
                            src={qrPrimary}
                            alt="QR для оплати в банку"
                            className={qrImageClass}
                        />
                        <figcaption className="text-muted-foreground text-sm">
                            Наведіть камеру в додатку банку
                        </figcaption>
                    </figure>
                    <UiDisclosure
                        align="center"
                        label="Запасний код, якщо не зчитався"
                    >
                        <figure className="space-y-2 text-center">
                            <UiQrImage
                                src={qrLegacy}
                                alt="Запасний QR для оплати в банку"
                                className={qrImageClass}
                            />
                        </figure>
                    </UiDisclosure>
                </div>
            </UiDisclosure>
        </div>
    </div>
);

UiPaymentOptions.displayName = 'UiPaymentOptions';

export default UiPaymentOptions;
