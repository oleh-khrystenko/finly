'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    useForm,
    Controller,
    type FieldErrors,
    type Resolver,
} from 'react-hook-form';
import { AxiosError } from 'axios';
import { toast } from 'sonner';
import {
    CreateInvoiceSchema,
    effectiveLimit,
    humanSlugPartSchema,
    type Business,
    type CreateInvoiceRequest,
    type SlugInput,
    type SlugPreset,
} from '@finly/types';
import { createInvoice, getApiMessage } from '@/shared/api';
import { getZodFieldError, kyivEndOfDayInstant } from '@/shared/lib';
import UiButton from '@/shared/ui/UiButton';
import UiInput from '@/shared/ui/UiInput';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSelect from '@/shared/ui/UiSelect';
import UiSwitch from '@/shared/ui/UiSwitch';
import UiTextarea from '@/shared/ui/UiTextarea';
import { useSlugPresetWarningStore } from '@/features/invoices';

interface Props {
    business: Business;
}

/**
 * Sprint 4 §4.5 SP-9 — single-form для створення інвойсу.
 *
 * **Slug-input як один flat dropdown із 6 опцій** (plan §4.5 + DoD): кожна
 * 1:1 мапить на `SlugInput.kind` (3 рівні qr-decisions §4.3.1) — `explicit`,
 * 4 preset-варіанти, `random`. Без вкладених dropdowns: один клік — один
 * вибір, без UX-cost.
 *
 * **Default опція = `business.invoiceSlugPresetDefault ?? 'simple'`.** Якщо
 * ФОП у "Налаштуваннях рахунків" обрав конкретний пресет — форма стартує з
 * нього без додаткового кліку. Якщо `null` — `simple` як global system
 * fallback (§SP-1).
 *
 * **Edge case:** якщо bizness-default = `with-purpose` і це перший інвойс
 * — warning-modal не тригериться автоматично (тільки на manual change через
 * dropdown). `with-purpose` як bizness-level default має бути obvious-вибір
 * ФОП-а у "Налаштуваннях рахунків", де warning теж показується раз.
 *
 * **Coupled `amount × amountLocked` (SP-6).** Switch "Дозволити клієнту
 * правити суму" — інверсна семантика від API-поля (ON ⇔ `amountLocked=false`).
 * Switch disabled коли `amount === null`; при зміні `amount=number → null`
 * — auto-reset `amountLocked=false` через `useEffect`-watch.
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

type ValidUntilMode = 'none' | 'date';

/**
 * Flat 6-option discriminator. `'preset:simple'` etc. — один-к-одному
 * мапиться на `SlugInput`. Кодуємо як string (UiSelect requirement).
 */
type SlugInputOption =
    | 'explicit'
    | 'preset:simple'
    | 'preset:with-month'
    | 'preset:with-year'
    | 'preset:with-purpose'
    | 'random';

const SLUG_OPTIONS: { value: SlugInputOption; label: string }[] = [
    { value: 'preset:simple', label: 'Автоматично — простий номер (inv-001)' },
    {
        value: 'preset:with-month',
        label: 'Автоматично — з місяцем (2026-05-001)',
    },
    {
        value: 'preset:with-year',
        label: 'Автоматично — з роком (2026-001)',
    },
    {
        value: 'preset:with-purpose',
        label: 'Автоматично — з призначення (oplata-...)',
    },
    { value: 'explicit', label: 'Ввести самому' },
    { value: 'random', label: 'Випадковий код (без префікса)' },
];

const VALID_UNTIL_OPTIONS: { value: ValidUntilMode; label: string }[] = [
    { value: 'none', label: 'Без терміну' },
    { value: 'date', label: 'До конкретної дати' },
];

interface FormValues {
    /** Сума у копійках, або null (signage mode). */
    amount: number | null;
    /** `true` = ФОП фіксує, клієнт не може правити. */
    amountLocked: boolean;
    paymentPurpose: string | null;
    validUntilMode: ValidUntilMode;
    /** ISO-date рядок (без часу) — конвертується у Date при submit. */
    validUntilDate: string;
    slugOption: SlugInputOption;
    /** Активний при `slugOption === 'explicit'`. */
    humanPart: string;
}

const PURPOSE_CHAR_LIMIT = effectiveLimit('purpose').chars;

function defaultSlugOption(business: Business): SlugInputOption {
    const preset: SlugPreset = business.invoiceSlugPresetDefault ?? 'simple';
    return `preset:${preset}` as SlugInputOption;
}

/**
 * Конструюємо `SlugInput`-discriminated union з flat-form-state — single
 * source of truth для submit-payload + Zod-resolver pre-validation.
 */
function buildSlugInput(values: FormValues): SlugInput {
    if (values.slugOption === 'explicit') {
        return { kind: 'explicit', humanPart: values.humanPart };
    }
    if (values.slugOption === 'random') {
        return { kind: 'random' };
    }
    // 'preset:*'
    const preset = values.slugOption.slice(
        'preset:'.length,
    ) as SlugPreset;
    return { kind: 'preset', preset };
}

function formValuesToCreateRequest(values: FormValues): CreateInvoiceRequest {
    return {
        amount: values.amount,
        amountLocked: values.amountLocked,
        paymentPurpose: values.paymentPurpose,
        validUntil:
            values.validUntilMode === 'date' && values.validUntilDate
                ? // SP-7 — фіксуємо 23:59:59 у Europe/Kyiv tz, незалежно
                  // від tz браузера (`new Date('YYYY-MM-DDTHH:MM:SS')` без
                  // `Z` interpret-ується як local time клієнта — зсунуло б
                  // backend Kyiv-tz parsing на сусідній день).
                  kyivEndOfDayInstant(values.validUntilDate)
                : null,
        slugInput: buildSlugInput(values),
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
    if (values.slugOption === 'explicit') {
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

    // 2. validUntilMode='date' + empty validUntilDate → submit-blocking error.
    //    Власний код у словнику `mapValidationCode` (`VALID_UNTIL_DATE_REQUIRED`).
    if (
        values.validUntilMode === 'date' &&
        values.validUntilDate.trim() === ''
    ) {
        errors.validUntilDate = {
            type: 'manual',
            message: 'VALID_UNTIL_DATE_REQUIRED',
        };
    }

    // 3. Build API-shape і валідуємо через CreateInvoiceSchema.
    if (Object.keys(errors).length === 0) {
        const apiShape = formValuesToCreateRequest(values);
        const r = CreateInvoiceSchema.safeParse(apiShape);
        if (!r.success) {
            for (const issue of r.error.issues) {
                const path = issue.path[0];
                if (path === 'amount') {
                    errors.amount = { type: 'zod', message: issue.message };
                } else if (path === 'amountLocked') {
                    errors.amountLocked = {
                        type: 'zod',
                        message: issue.message,
                    };
                } else if (path === 'paymentPurpose') {
                    errors.paymentPurpose = {
                        type: 'zod',
                        message: issue.message,
                    };
                } else if (path === 'validUntil') {
                    errors.validUntilDate = {
                        type: 'zod',
                        message: issue.message,
                    };
                } else if (path === 'slugInput') {
                    const target =
                        values.slugOption === 'explicit'
                            ? 'humanPart'
                            : 'slugOption';
                    errors[target] = {
                        type: 'zod',
                        message: issue.message,
                    };
                }
            }
        }
    }

    if (Object.keys(errors).length > 0) {
        return { values: {}, errors };
    }
    return { values, errors: {} };
};

export default function CreateInvoiceForm({ business }: Props) {
    const router = useRouter();
    const openWarning = useSlugPresetWarningStore((s) => s.open);
    const [submitting, setSubmitting] = useState(false);

    const initialOption = useMemo(
        () => defaultSlugOption(business),
        [business],
    );

    const form = useForm<FormValues>({
        resolver: createInvoiceResolver,
        defaultValues: {
            amount: null,
            amountLocked: false,
            // `null` (не `''`) для consistency з API-shape: empty input у
            // textarea = "ФОП не задав, наслідуємо з business" → API `null`.
            // `''`-default fail-ить Zod refine `invoicePaymentPurposeSchema.min(1)`
            // ще до першого user-input-у.
            paymentPurpose: null,
            validUntilMode: 'none',
            validUntilDate: '',
            slugOption: initialOption,
            humanPart: '',
        },
        // `onChange` для live-validation `humanPart` + immediate-feedback на
        // amount-overflow / purpose-length errors. План §4.5 явно: "live-
        // валідацією через humanSlugPartSchema".
        mode: 'onChange',
    });

    const { control, handleSubmit, watch, setValue, formState } = form;
    const amount = watch('amount');
    const amountLocked = watch('amountLocked');
    const paymentPurpose = watch('paymentPurpose');
    const validUntilMode = watch('validUntilMode');
    const slugOption = watch('slugOption');
    const humanPart = watch('humanPart');

    // SP-6 — auto-reset amountLocked → false при amount → null.
    useEffect(() => {
        if (amount === null && amountLocked) {
            setValue('amountLocked', false, { shouldDirty: true });
        }
    }, [amount, amountLocked, setValue]);

    /**
     * §4.5 — warning-modal на manual select `'preset:with-purpose'` (не на
     * default-mount). Tracking через `acknowledged: Set` (на life of form).
     * Cancel → revert до previous option.
     */
    const [acknowledged, setAcknowledged] = useState<Set<SlugInputOption>>(
        new Set(),
    );
    const handleSlugOptionChange = (
        next: SlugInputOption,
        prev: SlugInputOption,
    ): void => {
        if (
            next === 'preset:with-purpose' &&
            !acknowledged.has(next)
        ) {
            openWarning(
                () => {
                    setAcknowledged((s) => new Set(s).add(next));
                    setValue('slugOption', next, { shouldDirty: true });
                },
                () => {
                    setValue('slugOption', prev, { shouldDirty: false });
                },
            );
            return;
        }
        setValue('slugOption', next, { shouldDirty: true });
    };

    const onSubmit = async (values: FormValues): Promise<void> => {
        const payload = formValuesToCreateRequest(values);
        setSubmitting(true);
        try {
            const created = await createInvoice(business.slug, payload);
            toast.success('Рахунок створено');
            router.replace(
                `/business/${business.slug}/invoice/${created.slug}`,
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
                void handleSubmit(onSubmit)(e);
            }}
            className="space-y-4"
            noValidate
        >
            {/* Сума + lock-switch */}
            <UiSectionCard title="Сума">
                <div className="space-y-3">
                    <Controller
                        name="amount"
                        control={control}
                        render={({ field, fieldState }) => (
                            <UiInput
                                type="number"
                                inputMode="decimal"
                                placeholder="1500.00"
                                label="Сума, ₴"
                                value={
                                    field.value === null
                                        ? ''
                                        : (field.value / 100).toString()
                                }
                                onChange={(e) => {
                                    const raw = e.target.value;
                                    if (raw === '') {
                                        field.onChange(null);
                                        return;
                                    }
                                    const parsed = Number.parseFloat(raw);
                                    if (Number.isNaN(parsed)) return;
                                    // Конвертуємо у копійки (int).
                                    field.onChange(Math.round(parsed * 100));
                                }}
                                error={getZodFieldError(fieldState.error)}
                            />
                        )}
                    />
                    <p className="text-muted-foreground text-xs">
                        Залиште порожнім, щоб клієнт сам ввів суму у банку.
                    </p>
                    <label
                        htmlFor="amount-lock-switch"
                        className={`border-border flex items-start justify-between gap-3 rounded-md border p-3 ${
                            amount === null
                                ? 'cursor-not-allowed opacity-60'
                                : 'cursor-pointer'
                        }`}
                    >
                        <div className="flex flex-1 flex-col gap-1">
                            <span className="text-foreground text-sm font-medium">
                                Дозволити клієнту правити суму
                            </span>
                            <span className="text-muted-foreground text-xs">
                                {amount === null
                                    ? 'Заблокувати редагування можна лише при заданій сумі'
                                    : 'Якщо вимкнено — клієнт сплатить точно зазначену суму'}
                            </span>
                        </div>
                        <UiSwitch
                            id="amount-lock-switch"
                            // Інверсна семантика: switch ON = "дозволити правити" = amountLocked=false.
                            checked={!amountLocked}
                            disabled={amount === null}
                            onChange={(allowEdit) =>
                                setValue('amountLocked', !allowEdit, {
                                    shouldDirty: true,
                                })
                            }
                        />
                    </label>
                </div>
            </UiSectionCard>

            {/* Призначення */}
            <UiSectionCard title="Призначення платежу">
                <div className="space-y-2">
                    <Controller
                        name="paymentPurpose"
                        control={control}
                        render={({ field, fieldState }) => (
                            <UiTextarea
                                value={field.value ?? ''}
                                onChange={(e) => {
                                    const v = e.target.value;
                                    field.onChange(v === '' ? null : v);
                                }}
                                placeholder={`Якщо порожньо — використано: «${business.paymentPurposeTemplate}»`}
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
                        <p className="text-muted-foreground text-xs">
                            Залиште порожнім — щоб використати призначення з
                            налаштувань бізнесу.
                        </p>
                        <span
                            className={`text-xs ${
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
            </UiSectionCard>

            {/* Термін дії */}
            <UiSectionCard title="Термін дії">
                <div className="space-y-3">
                    <UiSelect
                        options={VALID_UNTIL_OPTIONS}
                        value={validUntilMode}
                        onChange={(v) =>
                            setValue('validUntilMode', v as ValidUntilMode, {
                                shouldDirty: true,
                            })
                        }
                    />
                    {validUntilMode === 'date' && (
                        <Controller
                            name="validUntilDate"
                            control={control}
                            render={({ field, fieldState }) => (
                                <UiInput
                                    type="date"
                                    value={field.value}
                                    onChange={(e) =>
                                        field.onChange(e.target.value)
                                    }
                                    error={getZodFieldError(fieldState.error)}
                                />
                            )}
                        />
                    )}
                </div>
            </UiSectionCard>

            {/* Slug-input — flat 6-option dropdown */}
            <UiSectionCard title="Як назвати рахунок">
                <div className="space-y-3">
                    <UiSelect
                        options={SLUG_OPTIONS}
                        value={slugOption}
                        onChange={(v) =>
                            handleSlugOptionChange(
                                v as SlugInputOption,
                                slugOption,
                            )
                        }
                    />
                    {slugOption === 'explicit' && (
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
                                        placeholder="наприклад: order-2026-may"
                                        maxLength={60}
                                        error={getZodFieldError(fieldState.error)}
                                    />
                                    <p className="text-muted-foreground text-xs">
                                        Сервер додасть унікальний хвіст
                                        автоматично:{' '}
                                        <span className="font-mono">
                                            {humanPart || 'ваш-варіант'}
                                            -aB3xQ9k7
                                        </span>{' '}
                                        (хвіст згенерується при створенні)
                                    </p>
                                </div>
                            )}
                        />
                    )}
                    {slugOption === 'preset:with-purpose' && (
                        <p className="text-muted-foreground text-xs">
                            У URL потрапить ім&apos;я / ключові слова з
                            призначення.
                        </p>
                    )}
                    {slugOption === 'random' && (
                        <p className="text-muted-foreground text-xs">
                            Найкоротший варіант — лише унікальний код типу{' '}
                            <span className="font-mono">aB3xQ9k7</span>.
                            Підходить, коли URL-вид не важливий.
                        </p>
                    )}
                </div>
            </UiSectionCard>

            {formState.errors.root?.message && (
                <p className="text-destructive text-sm">
                    {formState.errors.root.message}
                </p>
            )}

            <div className="flex justify-end gap-3 pt-2">
                <UiButton
                    as="link"
                    href={`/business/${business.slug}#invoices`}
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
                    disabled={
                        submitting ||
                        formState.isSubmitting ||
                        purposeOverflow
                    }
                >
                    {submitting ? 'Створюю...' : 'Створити рахунок'}
                </UiButton>
            </div>
        </form>
    );
}
