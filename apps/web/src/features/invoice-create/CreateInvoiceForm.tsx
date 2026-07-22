'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    useForm,
    Controller,
    type FieldError,
    type FieldErrors,
    type Resolver,
} from 'react-hook-form';
import { AxiosError } from 'axios';
import { toast } from 'sonner';
import {
    CreateInvoiceSchema,
    effectiveLimit,
    humanSlugPartSchema,
    type Account,
    type Business,
    type CreateInvoiceRequest,
} from '@finly/types';
import { createInvoice, getApiMessage, updateAccount } from '@/shared/api';
import {
    focusFirstInvalidField,
    getZodFieldError,
    mapValidationCode,
    parseUaMoney,
} from '@/shared/lib';
import UiButton from '@/shared/ui/UiButton';
import UiCheckbox from '@/shared/ui/UiCheckbox';
import UiInput from '@/shared/ui/UiInput';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSwitch from '@/shared/ui/UiSwitch';
import UiTextarea from '@/shared/ui/UiTextarea';
import {
    CREATE_FORMAT_ORDER,
    EMPTY_VALID_UNTIL_DRAFT,
    InvoiceFormatPicker,
    ValidUntilField,
    choiceToSlugInput,
    isAutoSlugMode,
    isValidUntilDraftValid,
    resolveAccountPurposeTemplate,
    resolveValidUntil,
    useSlugPresetWarningStore,
    type InvoiceFormatChoice,
    type ValidUntilDraft,
} from '@/entities/invoice';

interface Props {
    business: Business;
    /**
     * Sprint 9 §SP-6 — Account, що володіє новим інвойсом. `invoiceSlugPresetDefault`
     * читається з account-доку (per-account нумерація). Sprint 29 — звідси ж
     * береться `paymentPurposeTemplate` рівня рахунку: template-fallback у
     * purpose-input мусить показувати те, що реально піде у банк.
     */
    account: Account;
}

/**
 * Sprint 4 §4.5 SP-9 — single-form для створення інвойсу.
 *
 * **Slug-input як один flat dropdown із 6 опцій** (plan §4.5 + DoD): кожна
 * 1:1 мапить на `SlugInput.kind` (3 рівні qr-decisions §4.3.1) — `explicit`,
 * 4 preset-варіанти, `random`. Без вкладених dropdowns: один клік — один
 * вибір, без UX-cost.
 *
 * **Default опція = `account.invoiceSlugPresetDefault ?? 'simple'`** (Sprint 9
 * §SP-6 — per-account нумерація; до Sprint 9 поле жило на Business). Якщо
 * ФОП у налаштуваннях рахунку обрав конкретний пресет — форма стартує з
 * нього без додаткового кліку. Якщо `null` — `simple` як global system
 * fallback (§SP-1).
 *
 * **Edge case:** якщо account-default = `with-purpose` і це перший інвойс
 * — warning-modal не тригериться автоматично (тільки на manual change через
 * dropdown). `with-purpose` як account-level default має бути obvious-вибір
 * ФОП-а у налаштуваннях рахунку, де warning теж показується раз.
 *
 * **Coupled `amount × amountLocked` (SP-6).** Switch "Дозволити клієнту
 * правити суму" — інверсна семантика від API-поля (ON ⇔ `amountLocked=false`).
 * Default OFF (≡ `amountLocked=true`) коли user задав суму — fix по плану
 * §SP-6 "default `false` для switch-а, тобто amountLocked=true". Disabled
 * коли `amount === null`; у signage-режимі стан switch-а derived **без
 * мутації** form-state-у (`checked={isSignage ? true : !amountLocked}`),
 * а submit-normalizer перед Zod-refine форсить `amountLocked=false` для
 * signage. Це уникає race-у з useEffect-reset на transient invalid input
 * (типу `1500abc`) і зберігає user's intent через signage-cycle: якщо
 * ФОП один раз дозволив правити, то після порожнього input-а та повторного
 * вводу суми lock-стан зберігається.
 *
 * **Live-validation `humanPart`** (mode `onChange`): humanSlugPartSchema
 * перевіряє формат при кожному typing-event, error binded до конкретного
 * UI-поля.
 *
 * **Лічильник символів** для `paymentPurpose` (плани вимагають) — показує
 * remaining-budget vs `effectiveLimit('purpose').chars` (Sprint 2 §2.2 ===
 * MIN по `PAYLOAD_VERSIONS`, гарантує QR-render для будь-якої з підтримуваних
 * версій).
 */

interface FormValues {
    /**
     * Raw сума з input-а (UA-формат: кома або крапка, optional NBSP-thousands).
     * Парситься через `parseUaMoney` → копійки. `''` = signage-mode.
     *
     * Зберігаємо raw string (а не parsed copies), бо `<input type="number">`
     * не підтримує UA-кому, і `Number.parseFloat('1500,50')` дає 1500 — silent
     * втрата 50 копійок. parseUaMoney закриває цей boundary.
     */
    amountInput: string;
    /** `true` = ФОП фіксує, клієнт не може правити. */
    amountLocked: boolean;
    paymentPurpose: string | null;
    /** Спільна модель «Терміну дії» (mode + raw `ДД.ММ.РРРР`). */
    validUntilDraft: ValidUntilDraft;
    slugChoice: InvoiceFormatChoice;
    /** Активний при `slugChoice === 'explicit'`. */
    humanPart: string;
    /**
     * Опт-ін «запам'ятати обраний формат як домашній для цих реквізитів».
     * Видимий лише коли вибір — авто-режим, відмінний від поточного дефолту.
     * На submit (якщо `true`) PATCH-ить `account.invoiceSlugPresetDefault`.
     */
    rememberDefault: boolean;
}

const PURPOSE_CHAR_LIMIT = effectiveLimit('purpose').chars;

// Безчасовий приклад читабельної частини посилання (схема: лише [a-z0-9-]).
// Використовується і в placeholder, і в live-прев'ю, щоб порожнє поле показувало
// узгоджений результат.
const SLUG_EXAMPLE = 'order-1024';

function defaultSlugChoice(account: Account): InvoiceFormatChoice {
    // Sprint 9 §SP-6 — «домашній формат» на Account; null fallback на global
    // system default `'simple'` (Sprint 4 §SP-1).
    return account.invoiceSlugPresetDefault ?? 'simple';
}

/**
 * Перетворює form-state на API-shape. Викликається лише після того, як
 * resolver упевнився, що `amountInput` валідний — тут parser-fail трактується
 * як bug (assert через помилку, не silent fallback).
 */
function formValuesToCreateRequest(values: FormValues): CreateInvoiceRequest {
    const money = parseUaMoney(values.amountInput);
    if (!money.ok) {
        throw new Error(
            `formValuesToCreateRequest invariant: amountInput "${values.amountInput}" expected pre-validated, got ${money.error}`
        );
    }
    // SP-6: signage-режим завжди надсилає amountLocked=false (Zod-refine
    // блокує amount=null + amountLocked=true). Form state може зберігати
    // user's intent (`true`), щоб при поверненні до has-amount mode lock
    // не скидався — submit нормалізує лише для wire-format-у.
    const isSignage = money.kopecks === null;
    return {
        amount: money.kopecks,
        amountLocked: isSignage ? false : values.amountLocked,
        paymentPurpose: values.paymentPurpose,
        // SP-7 Kyiv-tz 23:59:59 інкапсульовано у `resolveValidUntil`. Resolver
        // нижче гарантує, що сюди не доходить невалідний date-draft (інакше
        // `value` був би `null` — silent «без терміну» замість помилки).
        validUntil: resolveValidUntil(values.validUntilDraft).value,
        slugInput: choiceToSlugInput(values.slugChoice, values.humanPart),
    };
}

/**
 * RHF resolver: валідація flat-form-state через `CreateInvoiceSchema` +
 * pre-validation `humanPart` через `humanSlugPartSchema` (live-error на
 * UI-полі, не aggregate "slugInput"-error).
 *
 * Окремо валідовуємо submit-blocking edge-case: `validUntilMode === 'date'`
 * з empty `validUntilDate` (silent-null fallback недопустимий — користувач
 * обрав режим "до дати" і не вказав, треба явна error).
 */
const createInvoiceResolver: Resolver<FormValues> = async (values) => {
    const errors: FieldErrors<FormValues> = {};

    // 1. Pre-validate humanPart (live-feedback). `error.message` зберігаємо як
    //    SCREAMING_SNAKE-код — UI рендерить через `getZodFieldError(...)`
    //    (`mapValidationCode`).
    if (values.slugChoice === 'explicit') {
        const r = humanSlugPartSchema.safeParse(values.humanPart);
        if (!r.success) {
            errors.humanPart = {
                type: 'manual',
                message:
                    r.error.issues[0]?.message ??
                    'INVALID_HUMAN_SLUG_PART_FORMAT',
            };
        }
    }

    // 2. Невалідний date-draft (режим «до дати» з порожнім/невалідним текстом)
    //    блокує submit: помилка прокидається у `ValidUntilField` через
    //    Controller `fieldState` (live-формат-помилку поле показує й само).
    //    Без цього `resolveValidUntil` дав би silent `null` — «без терміну».
    if (!isValidUntilDraftValid(values.validUntilDraft)) {
        errors.validUntilDraft = {
            type: 'manual',
            message: 'VALID_UNTIL_DATE_REQUIRED',
        };
    }

    // 3. Parse amountInput. Помилка формату — submit-blocking error на власному
    //    UI-полі. Якщо ok — `kopecks` далі прокинеться у CreateInvoiceSchema
    //    (overflow перевіриться там).
    const money = parseUaMoney(values.amountInput);
    if (!money.ok) {
        errors.amountInput = { type: 'manual', message: money.error };
    }

    // 4. Build API-shape і валідуємо через CreateInvoiceSchema. Лише якщо
    //    попередні етапи не дали format-помилок — інакше `formValuesToCreateRequest`
    //    кине invariant-error.
    if (Object.keys(errors).length === 0) {
        const apiShape = formValuesToCreateRequest(values);
        const r = CreateInvoiceSchema.safeParse(apiShape);
        if (!r.success) {
            for (const issue of r.error.issues) {
                const path = issue.path[0];
                if (path === 'amount') {
                    errors.amountInput = {
                        type: 'zod',
                        message: issue.message,
                    };
                } else if (path === 'amountLocked') {
                    // Coupled-rule (`AMOUNT_LOCKED_REQUIRES_AMOUNT`) Zod
                    // ставить `path: ['amountLocked']`, але UiSwitch не має
                    // error-slot-у. Bubble на `amountInput` — той самий
                    // amount-блок візуально показує помилку поряд з
                    // toggle-ом. SP-6 normalizer на submit мав би
                    // запобігти цьому шляху, але defense-in-depth.
                    errors.amountInput = {
                        type: 'zod',
                        message: issue.message,
                    };
                } else if (path === 'paymentPurpose') {
                    errors.paymentPurpose = {
                        type: 'zod',
                        message: issue.message,
                    };
                } else if (path === 'validUntil') {
                    errors.validUntilDraft = {
                        type: 'zod',
                        message: issue.message,
                    };
                } else if (path === 'slugInput') {
                    const target =
                        values.slugChoice === 'explicit'
                            ? 'humanPart'
                            : 'slugChoice';
                    errors[target] = {
                        type: 'zod',
                        message: issue.message,
                    };
                } else {
                    // Unmatched-path → bubble на root-помилку. Без цього
                    // нові schema-paths (наприклад refine на slugInput.preset)
                    // тихо губилися б — submit заблокований без feedback-у.
                    // Code mapping проходить через mapValidationCode у render-i.
                    // RHF-quirk: `errors.root` має intersection-type, що не
                    // приймає прямий `FieldError`-shape — explicit cast.
                    errors.root = {
                        type: 'zod',
                        message: issue.message,
                    } as FieldError;
                }
            }
        }
    }

    if (Object.keys(errors).length > 0) {
        return { values: {}, errors };
    }
    return { values, errors: {} };
};

export default function CreateInvoiceForm({ business, account }: Props) {
    const router = useRouter();
    const openWarning = useSlugPresetWarningStore((s) => s.open);
    const [submitting, setSubmitting] = useState(false);

    const homeDefault = account.invoiceSlugPresetDefault;
    const initialChoice = useMemo(() => defaultSlugChoice(account), [account]);
    // Sprint 29 — підказка «за замовчуванням» мусить дзеркалити backend-ланцюг
    // `invoice → account → business`, інакше форма обіцяє шаблон отримувача, а у
    // `payeeSnapshot` і QR лягає шаблон рахунку.
    const inheritedPurposeTemplate = resolveAccountPurposeTemplate(
        account.paymentPurposeTemplate,
        business.paymentPurposeTemplate
    );

    const form = useForm<FormValues>({
        resolver: createInvoiceResolver,
        defaultValues: {
            amountInput: '',
            // SP-6 §plan: default `true` (≡ switch OFF "Дозволити правити").
            // Якщо user стартує у signage-режимі — submit-normalizer
            // переведе у `false` для wire-format-у; UI рендерить derived
            // state без мутації form-store (див. `lockSwitchChecked`).
            amountLocked: true,
            // `null` (не `''`) для consistency з API-shape: empty input у
            // textarea = "ФОП не задав, наслідуємо з business" → API `null`.
            // `''`-default fail-ить Zod refine `invoicePaymentPurposeSchema.min(1)`
            // ще до першого user-input-у.
            paymentPurpose: null,
            validUntilDraft: EMPTY_VALID_UNTIL_DRAFT,
            slugChoice: initialChoice,
            humanPart: '',
            rememberDefault: false,
        },
        // `onChange` для live-validation `humanPart` + immediate-feedback на
        // amount-overflow / purpose-length errors. План §4.5 явно: "live-
        // валідацією через humanSlugPartSchema".
        mode: 'onChange',
        // Всі поля — Controller без прокинутого `field.ref`, тож вбудований
        // focus RHF не має куди цілитись. Замість нього —
        // focusFirstInvalidField у handleSubmit (перше aria-invalid по DOM).
        shouldFocusError: false,
    });

    const { control, handleSubmit, watch, setValue, formState } = form;
    const amountInput = watch('amountInput');
    const amountLocked = watch('amountLocked');
    const paymentPurpose = watch('paymentPurpose');
    const slugChoice = watch('slugChoice');
    const humanPart = watch('humanPart');
    const rememberDefault = watch('rememberDefault');

    /**
     * Derived parse-state amountInput. Розмежовуємо три режими:
     *   - `valid-amount` — parse-ok, kopecks є числом → switch enabled, lock
     *     toggling allowed.
     *   - `valid-signage` — parse-ok, kopecks=null (empty input) → switch
     *     disabled, **семантичний** signage-mode → SP-6 auto-reset amountLocked.
     *   - `invalid` — parse-fail (transient невалідний ввід типу `1500abc`)
     *     → switch disabled, але amountLocked **зберігається**. Transient
     *     validation state НЕ міняє семантичний прапорець.
     *
     * Без цього розмежування `parsedAmount === null` одночасно означав і
     * signage, і parse-fail; useEffect reset-ив amountLocked на transient
     * invalid input — payment-correctness баг (lock зникав під час набору
     * суми, потім submit йшов з allow-edit вже всупереч намірам ФОПа).
     */
    type AmountUiState =
        | { kind: 'valid-amount'; kopecks: number }
        | { kind: 'valid-signage' }
        | { kind: 'invalid' };
    const amountUiState = useMemo<AmountUiState>(() => {
        const r = parseUaMoney(amountInput);
        if (!r.ok) return { kind: 'invalid' };
        if (r.kopecks === null) return { kind: 'valid-signage' };
        return { kind: 'valid-amount', kopecks: r.kopecks };
    }, [amountInput]);
    const isSignage = amountUiState.kind === 'valid-signage';
    const lockSwitchDisabled = amountUiState.kind !== 'valid-amount';

    // SP-6 — UI-стан switch-а "Дозволити правити" derived з form-store-у:
    // у signage-режимі завжди показуємо ON (allow-edit), не торкаючись
    // store-значення. На transient invalid (typing) — рендеримо stored
    // intent. Submit-normalizer (formValuesToCreateRequest) форсить
    // wire-shape `amountLocked=false` для signage. Без useEffect-reset
    // — це закриває race на transient input-ах (`1500abc`) і зберігає
    // user-intent через signage-cycle.
    const lockSwitchChecked = isSignage ? true : !amountLocked;

    /**
     * §4.5 — warning-modal на manual select `'with-purpose'` (не на
     * default-mount). Tracking через `acknowledged: Set` (на life of form).
     * Cancel → picker лишається controlled на попередньому виборі (no-op).
     */
    const [acknowledged, setAcknowledged] = useState<Set<InvoiceFormatChoice>>(
        new Set()
    );

    const effectiveHome: InvoiceFormatChoice = homeDefault ?? 'simple';
    // Галочка «запам'ятати» доречна лише коли вибір — авто-режим, відмінний від
    // поточного домашнього формату (ручний ввід не зберігається; збіг з дефолтом
    // нема що запам'ятовувати).
    const canRemember =
        isAutoSlugMode(slugChoice) && slugChoice !== effectiveHome;

    const applyChoice = (next: InvoiceFormatChoice): void => {
        setValue('slugChoice', next, { shouldDirty: true });
        // Кожне нове відхилення від дефолту вимагає свідомого опт-іну заново.
        setValue('rememberDefault', false, { shouldDirty: false });
    };

    const handleFormatChange = (next: InvoiceFormatChoice): void => {
        if (next === slugChoice) return;
        if (next === 'with-purpose' && !acknowledged.has(next)) {
            openWarning(
                () => {
                    setAcknowledged((s) => new Set(s).add(next));
                    applyChoice(next);
                },
                () => undefined
            );
            return;
        }
        applyChoice(next);
    };

    const onSubmit = async (values: FormValues): Promise<void> => {
        const payload = formValuesToCreateRequest(values);
        setSubmitting(true);
        try {
            const created = await createInvoice(
                business.slug,
                account.slug,
                payload
            );
            const choice = values.slugChoice;
            if (
                values.rememberDefault &&
                isAutoSlugMode(choice) &&
                choice !== effectiveHome
            ) {
                try {
                    await updateAccount(business.slug, account.slug, {
                        invoiceSlugPresetDefault: choice,
                    });
                } catch {
                    // Рахунок уже створено — це другорядна дія, не блокуємо.
                    toast.error('Формат за замовчуванням не вдалося зберегти');
                }
            }
            toast.success('Рахунок створено');
            router.replace(
                `/business/${business.slug}/account/${account.slug}/invoice/${created.slug}`
            );
        } catch (err: unknown) {
            const code =
                err instanceof AxiosError
                    ? ((
                          err.response?.data as
                              | { error?: { code?: string } }
                              | undefined
                      )?.error?.code ?? 'unknown')
                    : 'unknown';
            toast.error(getApiMessage(code, 'invoices'));
        } finally {
            setSubmitting(false);
        }
    };

    const purposeLength = paymentPurpose?.length ?? 0;
    const purposeOverflow = purposeLength > PURPOSE_CHAR_LIMIT;

    return (
        <form
            onSubmit={(e) => {
                void handleSubmit(onSubmit, focusFirstInvalidField)(e);
            }}
            className="space-y-8"
            noValidate
        >
            {/*
             * Деталі рахунку — зміст платежу (скільки / за що / доки) в одній
             * картці. Три параметри читаються як одна думка про один рахунок;
             * окремі картки на однопольні секції роздували б форму. Заголовки
             * картки більше не служать лейблами полів — кожне поле має власний
             * видимий label (`labelSize="md"`, ритм create-форм).
             */}
            <UiSectionCard title="Деталі рахунку">
                <div className="mt-6 space-y-8">
                    {/* Сума + lock-switch (тісно зв'язана пара) */}
                    <div className="space-y-4">
                        <Controller
                            name="amountInput"
                            control={control}
                            render={({ field, fieldState }) => (
                                <UiInput
                                    // `type="text"`, не `number` — щоб приймати UA-кому
                                    // (кома у HTML5 `number` interpret-ується locale-
                                    // dependent і часто rejected). `inputMode="decimal"`
                                    // дає mobile numeric keypad з комою.
                                    type="text"
                                    inputMode="decimal"
                                    label="Сума"
                                    labelSize="md"
                                    placeholder="1500,50"
                                    IconRight={
                                        <span className="text-sm">грн</span>
                                    }
                                    description="Якщо не вказати суму, клієнт впише її самостійно під час оплати."
                                    value={field.value}
                                    onChange={(e) =>
                                        field.onChange(e.target.value)
                                    }
                                    onBlur={field.onBlur}
                                    error={getZodFieldError(fieldState.error)}
                                />
                            )}
                        />
                        {/*
                         * Тогл блокування суми — формулювання дзеркалить SEO-тогл
                         * business-сторінки і `AmountLockSwitch` edit-сторінки:
                         * заголовок-статус описує поточний стан (не імператив),
                         * switch праворуч, пояснення знизу. Інверсна семантика:
                         * switch ON = «дозволити правити» = amountLocked=false.
                         */}
                        <label
                            htmlFor="amount-lock-switch"
                            className={`flex flex-col gap-1 ${
                                lockSwitchDisabled
                                    ? 'cursor-not-allowed opacity-60'
                                    : 'cursor-pointer'
                            }`}
                        >
                            <span className="flex items-center justify-between gap-3">
                                <span className="text-foreground text-lg font-medium">
                                    {lockSwitchDisabled
                                        ? 'Клієнт вписує суму у банку сам'
                                        : amountLocked
                                          ? 'Клієнт сплатить точно зазначену суму'
                                          : 'Клієнт може змінити суму перед оплатою'}
                                </span>
                                <UiSwitch
                                    id="amount-lock-switch"
                                    className="shrink-0"
                                    checked={lockSwitchChecked}
                                    disabled={lockSwitchDisabled}
                                    onChange={(allowEdit) =>
                                        setValue('amountLocked', !allowEdit, {
                                            shouldDirty: true,
                                        })
                                    }
                                />
                            </span>
                            <span className="text-muted-foreground text-sm">
                                {lockSwitchDisabled
                                    ? 'Доступно лише коли задано суму. Поки суми немає, клієнт вписує її сам.'
                                    : 'Керує тим, чи може клієнт змінити суму у банку. Якщо вимкнено, клієнт сплатить рівно зазначену суму.'}
                            </span>
                        </label>
                    </div>

                    {/* Призначення платежу */}
                    <div className="space-y-2">
                        <Controller
                            name="paymentPurpose"
                            control={control}
                            render={({ field, fieldState }) => (
                                <UiTextarea
                                    label="Призначення платежу"
                                    labelSize="md"
                                    value={field.value ?? ''}
                                    onChange={(e) => {
                                        const v = e.target.value;
                                        field.onChange(v === '' ? null : v);
                                    }}
                                    placeholder={`За замовчуванням: «${inheritedPurposeTemplate}»`}
                                    error={getZodFieldError(fieldState.error)}
                                    autoGrow
                                    maxRows={4}
                                />
                            )}
                        />
                        {/*
                         * Лічильник символів (план §4.5 явно). Граничне значення
                         * — `effectiveLimit('purpose').chars` (Sprint 2 §2.2:
                         * MIN-по-версіях, гарантує QR-render для всіх supported
                         * `PAYLOAD_VERSIONS`).
                         */}
                        <div className="flex items-center justify-between">
                            <p className="text-muted-foreground text-sm">
                                Якщо лишити порожнім, клієнт побачить стандартне
                                призначення отримувача.
                            </p>
                            <span
                                className={`text-sm ${
                                    purposeOverflow
                                        ? 'text-destructive'
                                        : 'text-muted-foreground'
                                }`}
                                aria-live="polite"
                            >
                                {purposeLength} / {PURPOSE_CHAR_LIMIT}
                            </span>
                        </div>
                    </div>

                    {/* Термін дії — спільний редактор з edit-сторінкою */}
                    <Controller
                        name="validUntilDraft"
                        control={control}
                        render={({ field, fieldState }) => (
                            <ValidUntilField
                                label="Термін дії"
                                draft={field.value}
                                onChange={field.onChange}
                                error={getZodFieldError(fieldState.error)}
                            />
                        )}
                    />
                </div>
            </UiSectionCard>

            {/* Формат номера — спільний picker (форма + перевипуск) */}
            <UiSectionCard title="Як назвати рахунок">
                <div className="mt-6 space-y-6">
                    <InvoiceFormatPicker
                        value={slugChoice}
                        onChange={handleFormatChange}
                        options={CREATE_FORMAT_ORDER}
                        defaultMode={homeDefault}
                    />
                    {slugChoice === 'explicit' && (
                        <Controller
                            name="humanPart"
                            control={control}
                            render={({ field, fieldState }) => (
                                <div className="space-y-2">
                                    <UiInput
                                        value={field.value}
                                        // НЕ викликаємо `.trim()` під час typing
                                        // — це ламає UX (cursor-jumps); user
                                        // може ввести space, але `humanSlug-
                                        // PartSchema` блокує ці значення —
                                        // live-error моментально.
                                        onChange={(e) =>
                                            field.onChange(e.target.value)
                                        }
                                        placeholder={`Наприклад: ${SLUG_EXAMPLE}`}
                                        maxLength={60}
                                        error={getZodFieldError(
                                            fieldState.error
                                        )}
                                    />
                                    <p className="text-muted-foreground text-sm">
                                        Наприкінці додамо кілька символів, щоб
                                        посилання було унікальним:{' '}
                                        <span className="font-mono break-all">
                                            {humanPart || SLUG_EXAMPLE}-aB3xQ9k7
                                        </span>
                                    </p>
                                </div>
                            )}
                        />
                    )}
                    {slugChoice === 'with-purpose' && (
                        <p className="text-muted-foreground text-sm">
                            У URL потрапить ім&apos;я або ключові слова з
                            призначення.
                        </p>
                    )}
                    {slugChoice === 'random' && (
                        <p className="text-muted-foreground text-sm">
                            Найкоротший варіант: лише унікальний код типу{' '}
                            <span className="font-mono">aB3xQ9k7</span>.
                            Підходить, коли URL-вид не важливий.
                        </p>
                    )}
                    {canRemember && (
                        <UiCheckbox
                            checked={rememberDefault}
                            onChange={(checked) =>
                                setValue('rememberDefault', checked, {
                                    shouldDirty: true,
                                })
                            }
                        >
                            Запам&apos;ятати формат для наступних рахунків
                        </UiCheckbox>
                    )}
                </div>
            </UiSectionCard>

            {formState.errors.root?.message && (
                <p className="text-destructive text-sm">
                    {/* mapValidationCode гарантує UA-fallback — раніше тут
                        потенційно міг рендеритися raw `INVALID_*`-код. */}
                    {mapValidationCode(formState.errors.root.message) ??
                        'Перевірте правильність значень'}
                </p>
            )}

            <div className="flex justify-end gap-3 pt-2">
                <UiButton
                    as="link"
                    href={`/business/${business.slug}/account/${account.slug}#invoices`}
                    variant="text"
                    size="md"
                    disabled={submitting}
                >
                    Скасувати
                </UiButton>
                <UiButton
                    type="submit"
                    variant="filled"
                    size="md"
                    disabled={submitting || formState.isSubmitting}
                >
                    {submitting ? 'Створюю...' : 'Створити рахунок'}
                </UiButton>
            </div>
        </form>
    );
}
