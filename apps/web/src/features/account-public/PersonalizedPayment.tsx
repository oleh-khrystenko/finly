'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Check, Copy } from 'lucide-react';
import {
    BANK_LABEL,
    individualTaxIdZod,
    personalizationFullNameZod,
    personalizationPeriodZod,
    type BankCode,
    type BusinessType,
    type PurposeMarker,
} from '@finly/types';
import { getPersonalizedNbuLinks, PublicApiError } from '@/shared/api';
import { kyivYearMonth } from '@/shared/lib';
import UiButton from '@/shared/ui/UiButton';
import UiBrandLogo from '@/shared/ui/UiBrandLogo';
import UiInput from '@/shared/ui/UiInput';
import UiPayeeCard from '@/shared/ui/UiPayeeCard';
import UiPaymentOptions from '@/shared/ui/UiPaymentOptions';
import UiQrImage from '@/shared/ui/UiQrImage';
import UiSelect from '@/shared/ui/UiSelect';
import { formatPayeeName } from '@/entities/business';

/** Довжина РНОКПП — форма ріже нецифри, тож недобір цифр і провал контрольної
 * суми — два різні user-facing стани. */
const TAX_ID_LENGTH = 10;

/**
 * Пауза набору, після якої введені значення застосовуються (адреса сторінки,
 * QR-картинка, банк-посилання). Без неї кожен символ ПІБ давав би два запити
 * (посилання + новий `src` картинки) і швидко вичерпував серверний бакет
 * `personalized-qr` (30/хв). Прецеденти: `UiSlugEditor`, `BrandLogoUploadDialog`.
 */
const APPLY_DEBOUNCE_MS = 500;

interface Props {
    businessSlug: string;
    account: {
        slug: string;
        name: string | null;
        bankCode: BankCode | null;
        ibanMask: string;
    };
    business: {
        type: BusinessType;
        name: string;
        logo?: string;
        brandDisplayName?: string | null;
    };
    /** Маркери шаблону — які поля показувати. */
    markers: PurposeMarker[];
}

/**
 * Sprint 29 — податкова персоналізація. Публічна сторінка системного отримувача
 * з шаблоном-маркерами: платник вводить свій РНОКПП/період/ПІБ, і сторінка
 * будує персональний QR (призначення з підставленими даними) плюс кнопки банків.
 * Значення живуть у query-параметрах, тож посилання можна переслати (бухгалтер
 * надсилає клієнту готову сторінку). Нічого не пишеться в БД.
 */
export default function PersonalizedPayment({
    businessSlug,
    account,
    business,
    markers,
}: Props) {
    const searchParams = useSearchParams();
    const payeeName = formatPayeeName(business.type, business.name);
    const bankLabel =
        account.bankCode !== null ? BANK_LABEL[account.bankCode] : null;

    const has = (m: PurposeMarker) => markers.includes(m);

    const [taxId, setTaxId] = useState(() => searchParams.get('taxId') ?? '');
    const [fullName, setFullName] = useState(
        () => searchParams.get('fullName') ?? ''
    );
    // Значення періоду з пересланого посилання може бути поза побудованим
    // списком (адмін завів інший рік чи власне формулювання). Тоді додаємо його
    // окремою опцією і робимо дефолтом: інакше `UiSelect` показав би плейсхолдер,
    // а в QR пішов би невидимий користувачу період — прямий ризик сплати не за
    // той період. Невалідне значення (charset/довжина) ігноруємо повністю, щоб
    // у полі не осів варіант, який сервер усе одно відхилить.
    const periodOptions = useMemo(() => {
        const built = buildPeriodOptions();
        const fromUrl = searchParams.get('period')?.trim();
        if (!fromUrl || !personalizationPeriodZod.safeParse(fromUrl).success) {
            return built;
        }
        if (built.options.some((o) => o.value === fromUrl)) {
            return { options: built.options, defaultValue: fromUrl };
        }
        return {
            options: [{ label: fromUrl, value: fromUrl }, ...built.options],
            defaultValue: fromUrl,
        };
    }, [searchParams]);
    const [period, setPeriod] = useState(() => periodOptions.defaultValue);

    // Валідація і підстановка йдуть по ОДНОМУ значенню (обрізаному): інакше
    // переслане посилання з пробілом (`?taxId=%201234567890`) провалювало б
    // перевірку на цілком коректному номері, а виправити його в полі було б
    // нічим (набір ріже нецифри).
    const trimmedTaxId = taxId.trim();
    const trimmedFullName = fullName.trim();
    const trimmedPeriod = period.trim();

    const taxIdValid =
        !has('taxId') || individualTaxIdZod.safeParse(trimmedTaxId).success;
    // Ті самі правила, що на сервері (NBU-charset + до 80), а не лише непорожність,
    // інакше невалідний ПІБ дав би 400 і биту QR-картинку без причини.
    const fullNameValid =
        !has('fullName') ||
        personalizationFullNameZod.safeParse(trimmedFullName).success;
    // Ті самі правила, що на сервері (NBU-charset + до 64), а не лише
    // непорожність: значення періоду приходить і з query-параметра.
    const periodValid =
        !has('period') ||
        personalizationPeriodZod.safeParse(trimmedPeriod).success;
    const allValid = taxIdValid && fullNameValid && periodValid;

    // Заповнені значення саме за маркерами шаблону (без зайвих ключів).
    const values = useMemo(() => {
        const v: Record<string, string> = {};
        if (has('taxId')) v.taxId = trimmedTaxId;
        if (has('fullName')) v.fullName = trimmedFullName;
        if (has('period')) v.period = trimmedPeriod;
        return v;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [trimmedTaxId, trimmedFullName, trimmedPeriod, markers]);

    const [nbuLinks, setNbuLinks] = useState<{
        primary: string;
        legacy: string;
    } | null>(null);
    // Стан завантаження банк-посилань. `error` це збій зв'язку: кнопки мертві, а
    // QR (окрема img) працює, тож показуємо його як фолбек. `rejected` це відмова
    // сервера на самих значеннях (задовге призначення тощо) — тоді QR-ендпоінт
    // відповість тим самим 4xx, і рендер картинки дав би биту картинку без
    // пояснення. Розрізняємо за статусом: 4xx = дані, решта = зв'язок.
    const [linksState, setLinksState] = useState<
        'loading' | 'ready' | 'error' | 'rejected'
    >('loading');
    const [copied, setCopied] = useState(false);

    // Застосовані значення — те, що вже пішло в адресу сторінки, QR і банк-
    // посилання. Оновлюються з паузою після набору, тож ввід ПІБ дає один запит
    // замість запиту на символ, а QR не мерехтить. Поки форма невалідна,
    // застосованих значень немає (блок оплати схований).
    const [appliedValues, setAppliedValues] = useState<Record<
        string,
        string
    > | null>(() => (allValid ? values : null));

    useEffect(() => {
        if (!allValid) {
            setAppliedValues(null);
            return;
        }
        const handle = setTimeout(
            () => setAppliedValues(values),
            APPLY_DEBOUNCE_MS
        );
        return () => clearTimeout(handle);
    }, [allValid, values]);

    // Синхронізуємо URL із застосованими даними (шерабельне посилання) і тягнемо
    // персоналізовані банк-посилання.
    useEffect(() => {
        if (!appliedValues) {
            setNbuLinks(null);
            setLinksState('loading');
            // Адресу теж чистимо, а не лише ховаємо блок оплати: інакше після
            // правки чужого номера з опискою в рядку адреси лишався б попередній
            // (валідний) номер, і скопійоване руками посилання відкрилося б у
            // отримувача з готовим QR на чужі дані.
            window.history.replaceState(null, '', window.location.pathname);
            return;
        }
        const search = new URLSearchParams(appliedValues).toString();
        window.history.replaceState(
            null,
            '',
            `${window.location.pathname}?${search}`
        );
        let cancelled = false;
        setLinksState('loading');
        getPersonalizedNbuLinks(businessSlug, account.slug, appliedValues)
            .then((links) => {
                if (cancelled) return;
                setNbuLinks(links);
                setLinksState('ready');
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                setNbuLinks(null);
                const rejectedByServer =
                    err instanceof PublicApiError &&
                    err.status >= 400 &&
                    err.status < 500;
                setLinksState(rejectedByServer ? 'rejected' : 'error');
            });
        return () => {
            cancelled = true;
        };
    }, [appliedValues, businessSlug, account.slug]);

    // Обидва QR-хости НБУ, як на звичайній вивісці: `legacy` це запасний код під
    // банки, що не читають формат основного хоста. Без нього податкова сторінка
    // лишала б таких платників без фолбеку, хоч на сторінці рахунку він є.
    const qrLinks = useMemo(() => {
        if (!appliedValues) return null;
        const qrBase = `/api/businesses/public/${encodeURIComponent(businessSlug)}/account/${encodeURIComponent(account.slug)}/qr/personalized.png`;
        const build = (host: 'primary' | 'legacy') =>
            `${qrBase}?${new URLSearchParams({ host, ...appliedValues })}`;
        return { primary: build('primary'), legacy: build('legacy') };
    }, [appliedValues, businessSlug, account.slug]);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(window.location.href);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Буфер недоступний — тихо ігноруємо, посилання видно в адресному рядку.
        }
    };

    return (
        <div className="mx-auto max-w-md space-y-6 px-4 py-8 md:max-w-2xl">
            <header className="flex flex-col items-center gap-3 text-center">
                {business.logo && (
                    <UiBrandLogo
                        src={business.logo}
                        alt={business.brandDisplayName ?? payeeName}
                        displayName={business.brandDisplayName}
                    />
                )}
                <div className="space-y-1">
                    <p className="text-muted-foreground text-sm">Отримувач</p>
                    <h1 className="text-foreground text-2xl font-bold tracking-tight break-words md:text-3xl">
                        {payeeName}
                    </h1>
                </div>
            </header>

            <UiPayeeCard
                bankLabel={bankLabel}
                ibanMask={account.ibanMask}
                accountName={account.name}
            />

            <div className="border-border bg-card space-y-4 rounded-xl border p-5">
                <div>
                    <h2 className="text-foreground text-lg font-semibold">
                        Ваші дані для платежу
                    </h2>
                    <p className="text-muted-foreground mt-1 text-sm">
                        Заповніть поля, щоб отримати QR-код зі своїми даними у
                        призначенні платежу.
                    </p>
                </div>

                {has('taxId') && (
                    <UiInput
                        label="РНОКПП (податковий номер)"
                        inputMode="numeric"
                        maxLength={10}
                        value={taxId}
                        onChange={(e) =>
                            setTaxId(e.target.value.replace(/\D/g, ''))
                        }
                        error={taxIdError(trimmedTaxId, taxIdValid)}
                    />
                )}
                {has('fullName') && (
                    <UiInput
                        label="Прізвище, ім’я, по батькові"
                        maxLength={80}
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        error={
                            trimmedFullName.length > 0 && !fullNameValid
                                ? 'Ім’я містить недопустимі символи або задовге (до 80)'
                                : undefined
                        }
                    />
                )}
                {has('period') && (
                    <UiSelect
                        label="Період"
                        options={periodOptions.options}
                        value={period}
                        onChange={setPeriod}
                        error={
                            periodValid ? undefined : 'Оберіть період зі списку'
                        }
                    />
                )}
            </div>

            {qrLinks ? (
                <div className="space-y-6">
                    {linksState === 'ready' && nbuLinks ? (
                        // Той самий «один шлях», що на звичайній вивісці: сітка
                        // банків перша, QR і запасний код під disclosure.
                        <UiPaymentOptions
                            nbuLinks={nbuLinks}
                            qrPrimary={qrLinks.primary}
                            qrLegacy={qrLinks.legacy}
                        />
                    ) : linksState === 'rejected' ? (
                        // Сервер відхилив самі значення, тож QR-ендпоінт віддасть
                        // ту саму помилку: картинку не показуємо, пояснюємо причину.
                        <p className="text-destructive text-center text-sm">
                            Не вдалося скласти платіж із цими даними. Найчастіша
                            причина: разом з назвою отримувача і призначенням
                            вийшло задовго. Спробуйте коротше ПІБ.
                        </p>
                    ) : linksState === 'error' ? (
                        // Кнопки банків залежать від fetch, QR-картинка ні, тож
                        // на збої показуємо QR напряму замість глухого кута.
                        <figure className="space-y-2 text-center">
                            <UiQrImage
                                src={qrLinks.primary}
                                alt="Персональний QR-код для оплати"
                                className="border-border mx-auto w-full rounded-md border bg-white sm:max-w-xs"
                            />
                            <figcaption className="text-muted-foreground text-sm">
                                Не вдалося завантажити кнопки банків. Наведіть
                                камеру в додатку банку.
                            </figcaption>
                        </figure>
                    ) : (
                        <p className="text-muted-foreground text-center text-sm">
                            Готуємо спосіб оплати...
                        </p>
                    )}

                    <UiButton
                        type="button"
                        variant="outline"
                        size="md"
                        onClick={() => void handleCopy()}
                        IconLeft={copied ? <Check /> : <Copy />}
                    >
                        {copied
                            ? 'Посилання скопійовано'
                            : 'Скопіювати персональне посилання'}
                    </UiButton>
                </div>
            ) : allValid ? (
                // Форма вже валідна, але значення ще не застосовані (пауза
                // набору). Показуємо очікування, а не «заповніть поля»: інакше
                // текст суперечив би заповненій формі.
                <p className="text-muted-foreground text-center text-sm">
                    Готуємо QR-код...
                </p>
            ) : (
                <p className="text-muted-foreground text-center text-sm">
                    Заповніть поля вище, щоб згенерувати QR-код для оплати.
                </p>
            )}
        </div>
    );
}

/**
 * Причина помилки РНОКПП людською мовою. Поле вже ріже нецифри і обмежене
 * десятьма символами, тож «введіть 10 цифр» на повністю заповненому номері
 * збивало б з пантелику: там єдина причина — провал контрольної суми, тобто
 * описка в самих цифрах. Розділяємо два стани.
 */
function taxIdError(taxId: string, taxIdValid: boolean): string | undefined {
    if (taxId.length === 0 || taxIdValid) return undefined;
    if (taxId.length < TAX_ID_LENGTH) {
        return `Введіть усі ${TAX_ID_LENGTH} цифр РНОКПП`;
    }
    return 'РНОКПП не проходить перевірку. Перевірте, чи немає описки в цифрах';
}

/**
 * Опції періоду: квартали поточного і минулого року, найновіші зверху. Дефолт —
 * поточний квартал. Значення (`{n} квартал {year}`) підставляється у призначення.
 *
 * Календар київський (`kyivYearMonth`), не локальний до середовища: сторінка
 * рендериться і на сервері (контейнер у UTC), і в браузері платника. На межі
 * кварталу у вікні 00:00-03:00 за Києвом локальний час дав би різні списки на
 * двох боках гідратації і дефолтний період на квартал назад у податковому QR.
 */
function buildPeriodOptions(): {
    options: { label: string; value: string }[];
    defaultValue: string;
} {
    const { year, month } = kyivYearMonth();
    const currentQuarter = Math.floor((month - 1) / 3) + 1;
    const options: { label: string; value: string }[] = [];
    for (const y of [year, year - 1]) {
        for (let q = 4; q >= 1; q -= 1) {
            const label = `${q} квартал ${y}`;
            options.push({ label, value: label });
        }
    }
    return {
        options,
        defaultValue: `${currentQuarter} квартал ${year}`,
    };
}
