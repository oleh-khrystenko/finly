'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { AxiosError } from 'axios';
import { useRouter } from 'next/navigation';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
    BUSINESS_TYPES,
    BUSINESS_TYPE_LABEL,
    CreateBusinessSchema,
    TAXATION_SYSTEMS,
    TAXATION_SYSTEM_LABEL,
    businessNameSchema,
    businessPaymentPurposeTemplateSchema,
    isTaxationAllowedForType,
    requiresTaxation,
    type BusinessCreationVerdict,
    type BusinessType,
    type CreateBusinessRequest,
    type TaxationSystem,
} from '@finly/types';
import {
    VAT_CHOICE_SECTION_LABEL,
    getVatChoiceOptions,
    isVatChoiceApplicable,
    paymentPurposeTemplateFieldConfig,
    taxIdFieldConfig,
    vatBoolToChoice,
    vatChoiceToBool,
    type VatChoice,
} from '@/entities/business';
import { useQrLandingDraftStore } from '@/entities/qr-landing-draft';
import { createBusiness, getApiMessage } from '@/shared/api';
import { focusFirstInvalidField, getZodFieldError } from '@/shared/lib';
import UiButton from '@/shared/ui/UiButton';
import UiInput from '@/shared/ui/UiInput';
import UiRadioCardGroup, {
    type UiRadioCardGroupOption,
} from '@/shared/ui/UiRadioCardGroup';
import UiSelect from '@/shared/ui/UiSelect';
import UiTextarea from '@/shared/ui/UiTextarea';

/**
 * Один екран створення бізнесу: всі поля одночасно, без кроків.
 *
 * Зв'язок між полями:
 *  - `taxId` валідується per-type (`taxIdFieldConfig(type).validator`).
 *  - `taxationSystem` + `isVatPayer` рендеряться лише для `requiresTaxation`-
 *    типів (`fop` / `tov`).
 *  - VAT-картки рендеряться лише для `isVatChoiceApplicable`-систем
 *    (`simplified-3` / `general`). Для `simplified-1/2` ПКУ забороняє ПДВ —
 *    `isVatPayer` форсується у `false` на submit.
 *  - Зміна `type` атомарно скидає несумісні `taxId` (10 ↔ 8 цифр) і taxation-
 *    поля (fop/tov → individual/organization або simplified-1/2 ↔ tov).
 *
 * Single source of truth для крос-полевих правил — `superRefine` у схемі;
 * фінальний `CreateBusinessSchema.safeParse` перед `createBusiness` — sanity-
 * net проти drift form-state vs payload-DTO.
 */

export interface BusinessCreateFormInitialValues {
    type?: BusinessType;
    name?: string;
    taxId?: string;
    paymentPurposeTemplate?: string;
}

const FormSchema = z
    .object({
        type: z.enum(BUSINESS_TYPES).optional(),
        name: z.string(),
        taxId: z.string(),
        taxationSystem: z.enum(TAXATION_SYSTEMS).optional(),
        isVatPayer: z.boolean().optional(),
        paymentPurposeTemplate: z.string(),
    })
    .superRefine((data, ctx) => {
        if (!data.type) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['type'],
                message: 'INVALID_TYPE_REQUIRED',
            });
            return;
        }
        const nameParse = businessNameSchema.safeParse(data.name);
        if (!nameParse.success) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['name'],
                message: nameParse.error.issues[0]?.message ?? 'INVALID_NAME',
            });
        }
        const taxIdParse = taxIdFieldConfig(data.type).validator.safeParse(
            data.taxId
        );
        if (!taxIdParse.success) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['taxId'],
                message:
                    taxIdParse.error.issues[0]?.message ?? 'INVALID_TAX_ID',
            });
        }
        const purposeParse = businessPaymentPurposeTemplateSchema.safeParse(
            data.paymentPurposeTemplate
        );
        if (!purposeParse.success) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['paymentPurposeTemplate'],
                message:
                    purposeParse.error.issues[0]?.message ?? 'INVALID_PURPOSE',
            });
        }
        if (requiresTaxation(data.type)) {
            if (!data.taxationSystem) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['taxationSystem'],
                    message: 'TAXATION_REQUIRED_FOR_TYPE',
                });
            } else if (
                !isTaxationAllowedForType(data.type, data.taxationSystem)
            ) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['taxationSystem'],
                    message: 'TAXATION_SYSTEM_NOT_ALLOWED_FOR_TYPE',
                });
            } else if (
                isVatChoiceApplicable(data.taxationSystem) &&
                data.isVatPayer === undefined
            ) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['isVatPayer'],
                    message: 'INVALID_VAT_REQUIRED',
                });
            }
        }
    });

type FormValues = z.input<typeof FormSchema>;

const TYPE_DESCRIPTIONS: Record<BusinessType, string> = {
    individual: 'Збори, донати, особисті повернення',
    fop: 'Послуги, гонорари, рахунки клієнтам',
    tov: 'Товари, послуги, контракти з компаніями',
    organization: 'Внески, пожертви, цільові збори',
};

const NAME_LABELS: Record<BusinessType, string> = {
    individual: "Повне ім'я",
    fop: "Повне ім'я",
    tov: 'Назва компанії',
    organization: 'Назва організації',
};

const NAME_HELPERS: Record<BusinessType, string> = {
    individual: '«Фізособа» додасться автоматично',
    fop: '«ФОП» додасться автоматично',
    tov: '«ТОВ» додасться автоматично',
    organization: '«Неприбуткова організація» додасться автоматично',
};

const NAME_PLACEHOLDERS: Record<BusinessType, string> = {
    individual: 'Коваленко Іван Миколайович',
    fop: 'Шевченко Марія Іванівна',
    tov: '«Ваша компанія»',
    organization: '«Ваша організація»',
};

interface Props {
    initialValues?: BusinessCreateFormInitialValues;
    fromLanding?: boolean;
    /**
     * Sprint 19 ліміти — per-тип вердикти доступності (обчислені сторінкою
     * через `evaluateOwnedBusinessCreation` з `@finly/types`, ті самі правила,
     * що enforce-ить API). Відсутність пропа = все дозволено: graceful degrade
     * при fail фонового fetch-у списку; сервер лишається фінальним арбітром.
     */
    typeVerdicts?: Record<BusinessType, BusinessCreationVerdict>;
    /**
     * Блок-пропозиція, що з'являється під type-picker-ом після кліку на
     * plan-locked картку (`requires-plan`). Приходить зверху ReactNode-ом
     * (сторінка збирає його з білінг-фічі), бо крос-імпорт
     * business-wizard → billing заборонений modular-boundaries.
     */
    planUpsell?: ReactNode;
}

export default function BusinessCreateForm({
    initialValues,
    fromLanding = false,
    typeVerdicts,
    planUpsell,
}: Props) {
    const router = useRouter();
    const [submitting, setSubmitting] = useState(false);
    // Показується після кліку на plan-locked картку (ТОВ/організація понад
    // ліміт тарифу). Вибір дозволеного типу ховає апсел.
    const [planUpsellVisible, setPlanUpsellVisible] = useState(false);

    /**
     * Картки типів з урахуванням лімітів:
     *  - `type-limit` (вже є фізособа/ФОП) — глухий кут без дії користувача,
     *    тому картка disabled з причиною на місці;
     *  - `requires-plan` (ТОВ/організація понад тариф) — точка продажу.
     *    Картка навмисно виглядає звичайною, без тариф-маркера: клік не
     *    обирає тип, а розкриває пропозицію (`handleTypeChange` → `planUpsell`).
     *    Видимий маркер відсіював би людей до взаємодії; миттєва предметна
     *    відповідь на клік (ціна + оплата) конвертує краще.
     */
    const typeOptions = useMemo<
        ReadonlyArray<UiRadioCardGroupOption<BusinessType>>
    >(
        () =>
            BUSINESS_TYPES.map((type) => {
                const verdict = typeVerdicts?.[type];
                if (
                    verdict &&
                    !verdict.allowed &&
                    verdict.reason === 'type-limit'
                ) {
                    return {
                        value: type,
                        title: BUSINESS_TYPE_LABEL[type],
                        description: 'У вас вже є такий отримувач',
                        disabled: true,
                    };
                }
                return {
                    value: type,
                    title: BUSINESS_TYPE_LABEL[type],
                    description: TYPE_DESCRIPTIONS[type],
                };
            }),
        [typeVerdicts]
    );

    // Явний полевий merge замість spread: caller (наприклад, recovery з
    // лендінгу) може передати `name: undefined` / `taxId: undefined` для
    // частково очищеного draft-у. Naive spread {...EMPTY, ...initialValues}
    // перезаписав би `''` на `undefined` — `UiTextarea` через `Controller`
    // отримав би `value={undefined}` і впав у React controlled→uncontrolled
    // warning. Тримаємо string-поля guaranteed-string-ом.
    const form = useForm<FormValues>({
        resolver: zodResolver(FormSchema),
        mode: 'onChange',
        // Вбудований focus RHF вміє лише registered-поля з ref і пропустив би
        // type/taxationSystem/isVatPayer (setValue-driven). Замість нього —
        // focusFirstInvalidField у handleSubmit (перше aria-invalid по DOM).
        shouldFocusError: false,
        defaultValues: {
            type: initialValues?.type,
            name: initialValues?.name ?? '',
            taxId: initialValues?.taxId ?? '',
            taxationSystem: undefined,
            isVatPayer: undefined,
            paymentPurposeTemplate: initialValues?.paymentPurposeTemplate ?? '',
        },
    });

    const type = form.watch('type');
    const taxationSystem = form.watch('taxationSystem');
    const isVatPayer = form.watch('isVatPayer');
    const errors = form.formState.errors;

    const handleTypeChange = (newType: BusinessType) => {
        const verdict = typeVerdicts?.[newType];
        if (verdict && !verdict.allowed) {
            // `type-limit`-картки disabled (Headless UI не викликає onChange),
            // сюди долітає лише `requires-plan`: клік не обирає тип, а
            // показує апсел під групою.
            setPlanUpsellVisible(true);
            return;
        }
        setPlanUpsellVisible(false);

        const currentTaxId = form.getValues('taxId');
        const currentSystem = form.getValues('taxationSystem');

        form.setValue('type', newType, { shouldValidate: true });

        // Скидаємо taxId, якщо формат не підходить новому типу (10↔8 цифр).
        if (
            currentTaxId &&
            !taxIdFieldConfig(newType).validator.safeParse(currentTaxId).success
        ) {
            form.setValue('taxId', '', { shouldValidate: true });
        }

        // Для типів без taxation — повністю чистимо.
        if (!requiresTaxation(newType)) {
            form.setValue('taxationSystem', undefined, {
                shouldValidate: true,
            });
            form.setValue('isVatPayer', undefined, { shouldValidate: true });
            return;
        }

        // Cross-taxation-type перехід: система, дозволена для попереднього
        // типу, може бути заборонена для нового (наприклад, simplified-1/2
        // на ФОП — заборонені на ТОВ за ПКУ розд. XIV гл. 1).
        if (
            currentSystem &&
            !isTaxationAllowedForType(newType, currentSystem)
        ) {
            form.setValue('taxationSystem', undefined, {
                shouldValidate: true,
            });
            form.setValue('isVatPayer', undefined, { shouldValidate: true });
        }
    };

    const handleTaxationSystemChange = (next: string) => {
        const nextSystem = next as TaxationSystem;
        form.setValue('taxationSystem', nextSystem, { shouldValidate: true });
        // Системи без ПДВ (simplified-1/2) — VAT-картки ховаємо, поточний
        // вибір не несе сенсу, інакше submit ніс би stale-true з попередньої
        // VAT-allowed системи.
        if (!isVatChoiceApplicable(nextSystem)) {
            form.setValue('isVatPayer', undefined, { shouldValidate: true });
        }
    };

    const handleVatChange = (choice: VatChoice) => {
        form.setValue('isVatPayer', vatChoiceToBool(choice), {
            shouldValidate: true,
        });
    };

    const handleCancel = () => {
        // На recovery-flow з лендінгу обнуляємо draft, інакше
        // `useClaimLandingDraft` міг би підхопити stale `claim-failed-
        // business`-intent на наступному auth-mount.
        if (fromLanding) {
            useQrLandingDraftStore.getState().clearAll();
        }
        router.push('/business');
    };

    const onSubmit = async (values: FormValues) => {
        if (!values.type) return;

        const request = buildCreateRequest(values);
        const parsed = CreateBusinessSchema.safeParse(request);
        if (!parsed.success) {
            toast.error('Перевірте дані форми');
            return;
        }

        setSubmitting(true);
        try {
            const created = await createBusiness(parsed.data);
            // Sprint 10 — на recovery з лендінгу wizard передавав естафету
            // на account-create. Поведінка зберігається.
            if (fromLanding) {
                router.replace(
                    `/business/${created.slug}/account/new?from=landing`
                );
            } else {
                router.replace(`/business/${created.slug}`);
            }
        } catch (err) {
            const code =
                err instanceof AxiosError
                    ? (
                          err.response?.data as
                              | { error?: { code?: string } }
                              | undefined
                      )?.error?.code
                    : undefined;
            toast.error(getApiMessage(code ?? 'unknown', 'businesses'));
            setSubmitting(false);
        }
    };

    const taxIdConfig = type ? taxIdFieldConfig(type) : null;
    const purposeConfig = type ? paymentPurposeTemplateFieldConfig(type) : null;
    const taxationSelectOptions = type
        ? TAXATION_SYSTEMS.filter((s) => isTaxationAllowedForType(type, s)).map(
              (value) => ({ value, label: TAXATION_SYSTEM_LABEL[value] })
          )
        : [];
    const vatApplicable = isVatChoiceApplicable(taxationSystem);
    const vatOptions = vatApplicable
        ? getVatChoiceOptions(taxationSystem)
        : null;
    const vatValue =
        isVatPayer === undefined ? undefined : vatBoolToChoice(isVatPayer);

    return (
        <form
            onSubmit={form.handleSubmit(onSubmit, focusFirstInvalidField)}
            className="space-y-6"
            noValidate
        >
            <div className="border-border bg-card space-y-6 rounded-xl border p-6 md:p-8">
                <UiRadioCardGroup<BusinessType>
                    label="Тип отримувача"
                    labelSize="md"
                    options={typeOptions}
                    value={type}
                    onChange={handleTypeChange}
                    columns={{ mobile: 2, desktop: 4 }}
                    error={getZodFieldError(errors.type)}
                />

                {planUpsellVisible && planUpsell}

                {type && taxIdConfig && purposeConfig && (
                    <>
                        <UiInput
                            label={NAME_LABELS[type]}
                            labelSize="md"
                            placeholder={NAME_PLACEHOLDERS[type]}
                            description={NAME_HELPERS[type]}
                            {...form.register('name')}
                            error={getZodFieldError(errors.name)}
                        />

                        <UiInput
                            label={taxIdConfig.label}
                            labelSize="md"
                            placeholder={taxIdConfig.placeholder}
                            description={taxIdConfig.description}
                            inputMode="numeric"
                            maxLength={taxIdConfig.maxLength}
                            {...form.register('taxId')}
                            error={getZodFieldError(errors.taxId)}
                        />

                        {requiresTaxation(type) && (
                            <>
                                <UiSelect
                                    label="Система оподаткування"
                                    labelSize="md"
                                    placeholder="Оберіть систему"
                                    options={taxationSelectOptions}
                                    value={taxationSystem ?? ''}
                                    onChange={handleTaxationSystemChange}
                                    error={getZodFieldError(
                                        errors.taxationSystem
                                    )}
                                />

                                {vatApplicable && vatOptions && (
                                    <UiRadioCardGroup<VatChoice>
                                        label={
                                            VAT_CHOICE_SECTION_LABEL[
                                                taxationSystem
                                            ]
                                        }
                                        labelSize="md"
                                        options={vatOptions}
                                        value={vatValue}
                                        onChange={handleVatChange}
                                        columns={{ mobile: 1, desktop: 2 }}
                                        error={getZodFieldError(
                                            errors.isVatPayer
                                        )}
                                    />
                                )}
                            </>
                        )}

                        <Controller
                            name="paymentPurposeTemplate"
                            control={form.control}
                            render={({ field, fieldState }) => (
                                <UiTextarea
                                    label={purposeConfig.label}
                                    labelSize="md"
                                    placeholder={purposeConfig.placeholder}
                                    description={purposeConfig.description}
                                    value={field.value}
                                    onChange={field.onChange}
                                    onBlur={field.onBlur}
                                    ref={field.ref}
                                    error={getZodFieldError(fieldState.error)}
                                    autoGrow
                                    maxRows={4}
                                />
                            )}
                        />
                    </>
                )}
            </div>

            <div className="flex justify-between gap-3">
                <UiButton
                    type="button"
                    variant="text"
                    size="md"
                    onClick={handleCancel}
                    disabled={submitting}
                >
                    Скасувати
                </UiButton>
                <UiButton
                    type="submit"
                    variant="filled"
                    size="md"
                    loading={submitting}
                >
                    Створити
                </UiButton>
            </div>
        </form>
    );
}

/**
 * Map flat form-values → discriminated `CreateBusinessRequest` variant.
 * `superRefine` гарантує, що для fop/tov `taxationSystem` визначена, а
 * `isVatPayer` визначена, коли система VAT-allowed. На VAT-disallowed
 * системах (`simplified-1/2`) ПКУ забороняє ПДВ — форсуємо `false`, бо
 * картки прибрані з UI і user-вибору не було.
 */
function buildCreateRequest(values: FormValues): CreateBusinessRequest {
    if (!values.type) {
        throw new Error('type required');
    }
    const base = {
        name: values.name,
        taxId: values.taxId,
        paymentPurposeTemplate: values.paymentPurposeTemplate,
    };
    switch (values.type) {
        case 'individual':
            return { type: 'individual', ...base };
        case 'organization':
            return { type: 'organization', ...base };
        case 'fop':
        case 'tov': {
            if (values.taxationSystem === undefined) {
                throw new Error('taxationSystem required for ' + values.type);
            }
            const vatApplicable = isVatChoiceApplicable(values.taxationSystem);
            const isVatPayer =
                vatApplicable && values.isVatPayer !== undefined
                    ? values.isVatPayer
                    : false;
            return {
                type: values.type,
                ...base,
                taxationSystem: values.taxationSystem,
                isVatPayer,
            };
        }
    }
}
