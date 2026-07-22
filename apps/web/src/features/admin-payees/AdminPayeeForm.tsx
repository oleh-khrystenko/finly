'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
    BUSINESS_TYPES,
    BUSINESS_TYPE_LABEL,
    CATALOG_CATEGORIES,
    CATALOG_CATEGORY_LABEL,
    TAXATION_SYSTEMS,
    TAXATION_SYSTEM_LABEL,
    CreateSystemPayeeSchema,
    UpdateSystemPayeeSchema,
    isTaxationAllowedForType,
    requiresTaxation,
    type Business,
    type BusinessType,
    type CatalogCategory,
    type TaxationSystem,
} from '@finly/types';

import {
    adminCreatePayee,
    adminUpdatePayee,
    extractApiErrorCode,
    getApiMessage,
} from '@/shared/api';
import UiBreadcrumb from '@/shared/ui/UiBreadcrumb';
import UiButton from '@/shared/ui/UiButton';
import UiInput from '@/shared/ui/UiInput';
import UiPageContainer from '@/shared/ui/UiPageContainer';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import UiSelect from '@/shared/ui/UiSelect';
import UiSwitch from '@/shared/ui/UiSwitch';

import { collectFieldErrors, type FieldErrors } from './fieldErrors';
import { PurposeTemplateField } from './PurposeTemplateField';

/**
 * Sprint 29 — форма системного отримувача: створення (`/admin/payees/new`) і
 * редагування (`/admin/payees/[slug]/edit`, коли передано `existing`). Тип
 * незмінний після створення, тож у режимі редагування показується read-only, а
 * slug редагується (поза Brand-гейтингом). Видимість у каталозі редагується
 * окремо на сторінці отримувача, тому перемикач «показувати одразу» лише при
 * створенні.
 */
export function AdminPayeeForm({ existing }: { existing?: Business }) {
    const router = useRouter();
    const isEdit = existing !== undefined;

    const [type, setType] = useState<BusinessType>(
        existing?.type ?? 'organization'
    );
    const [name, setName] = useState(existing?.name ?? '');
    const [slug, setSlug] = useState(existing?.slug ?? '');
    const [taxId, setTaxId] = useState(existing?.taxId ?? '');
    const [taxationSystem, setTaxationSystem] = useState<TaxationSystem>(
        existing?.taxationSystem ?? 'general'
    );
    const [isVatPayer, setIsVatPayer] = useState(existing?.isVatPayer ?? false);
    const [purpose, setPurpose] = useState(
        existing?.paymentPurposeTemplate ?? ''
    );
    const [category, setCategory] = useState<CatalogCategory>(
        existing?.catalogCategory ?? 'state'
    );
    // Дефолт прихований (як у контракті `CreateSystemPayeeSchema` і в правилі
    // «після схвалення все приховане»): у щойно створеного отримувача ще немає
    // реквізитів, тож видимий одразу він дав би в каталозі картку без жодного
    // способу заплатити.
    const [catalogVisible, setCatalogVisible] = useState(
        existing?.catalogVisible ?? false
    );

    const [errors, setErrors] = useState<FieldErrors>({});
    const [submitting, setSubmitting] = useState(false);

    const taxIdIsRnokpp = type === 'individual' || type === 'fop';

    /**
     * Cross-type перехід чистить поля, прив'язані до попереднього типу (дзеркало
     * `BusinessCreateForm.handleTypeChange`):
     *  - система, дозволена для ФОП (спрощена-1/2), заборонена для ТОВ; лишившись
     *    у стані, вона зникає зі списку опцій, і `UiSelect` рендерить дефолтний
     *    плейсхолдер, а submit ніс би заборонене значення;
     *  - формат податкового номера різний (10-РНОКПП vs 8-ЄДРПОУ), тож старе
     *    значення після перемикання завжди невалідне.
     */
    const handleTypeChange = (next: BusinessType) => {
        setType(next);
        setTaxId('');
        if (
            requiresTaxation(next) &&
            !isTaxationAllowedForType(next, taxationSystem)
        ) {
            setTaxationSystem('general');
            setIsVatPayer(false);
        }
    };

    const taxationPart = requiresTaxation(type)
        ? { taxationSystem, isVatPayer }
        : {};

    const submitEdit = async () => {
        const payload = {
            name: name.trim(),
            slug: slug.trim(),
            taxId: taxId.trim(),
            paymentPurposeTemplate: purpose.trim(),
            catalogCategory: category,
            ...taxationPart,
        };
        const parsed = UpdateSystemPayeeSchema.safeParse(payload);
        if (!parsed.success) {
            setErrors(collectFieldErrors(parsed.error.issues));
            return;
        }
        setErrors({});
        setSubmitting(true);
        try {
            const updated = await adminUpdatePayee(existing!.slug, parsed.data);
            toast.success('Отримувача оновлено');
            router.push(`/admin/payees/${updated.slug}`);
        } catch (err) {
            toast.error(getApiMessage(extractApiErrorCode(err), 'businesses'));
            setSubmitting(false);
        }
    };

    const submitCreate = async () => {
        const payload = {
            type,
            name: name.trim(),
            taxId: taxId.trim(),
            paymentPurposeTemplate: purpose.trim(),
            catalogCategory: category,
            catalogVisible,
            ...taxationPart,
        };
        const parsed = CreateSystemPayeeSchema.safeParse(payload);
        if (!parsed.success) {
            setErrors(collectFieldErrors(parsed.error.issues));
            return;
        }
        setErrors({});
        setSubmitting(true);
        try {
            const created = await adminCreatePayee(parsed.data);
            toast.success('Отримувача створено');
            router.push(`/admin/payees/${created.slug}`);
        } catch (err) {
            toast.error(getApiMessage(extractApiErrorCode(err), 'businesses'));
            setSubmitting(false);
        }
    };

    const handleSubmit = isEdit ? submitEdit : submitCreate;

    return (
        <UiPageContainer className="space-y-6 py-10 md:py-14">
            <UiBreadcrumb
                items={[
                    { label: 'Системні отримувачі', href: '/admin/payees' },
                    { label: isEdit ? 'Редагування' : 'Створення' },
                ]}
            />
            <h1 className="text-foreground text-2xl font-semibold tracking-tight md:text-3xl">
                {isEdit
                    ? 'Редагування отримувача'
                    : 'Новий системний отримувач'}
            </h1>

            <UiSectionCard title="Основне">
                <div className="mt-4 space-y-4">
                    {isEdit ? (
                        <div>
                            <p className="text-muted-foreground text-sm font-medium">
                                Тип
                            </p>
                            <p className="text-foreground mt-1 text-sm">
                                {BUSINESS_TYPE_LABEL[type]}
                            </p>
                        </div>
                    ) : (
                        <UiSelect
                            label="Тип"
                            options={BUSINESS_TYPES.map((t) => ({
                                value: t,
                                label: BUSINESS_TYPE_LABEL[t],
                            }))}
                            value={type}
                            onChange={(v) =>
                                handleTypeChange(v as BusinessType)
                            }
                        />
                    )}
                    <UiInput
                        label="Назва"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        error={errors.name}
                    />
                    {isEdit && (
                        <UiInput
                            label="Посилання (slug)"
                            value={slug}
                            onChange={(e) => setSlug(e.target.value)}
                            error={errors.slug}
                            placeholder="dps-kyiv"
                        />
                    )}
                    <UiInput
                        label={
                            taxIdIsRnokpp
                                ? 'РНОКПП (10 цифр)'
                                : 'ЄДРПОУ (8 цифр)'
                        }
                        inputMode="numeric"
                        maxLength={taxIdIsRnokpp ? 10 : 8}
                        value={taxId}
                        onChange={(e) =>
                            setTaxId(e.target.value.replace(/\D/g, ''))
                        }
                        error={errors.taxId}
                    />
                    {requiresTaxation(type) && (
                        <>
                            <UiSelect
                                label="Система оподаткування"
                                options={TAXATION_SYSTEMS.filter((s) =>
                                    isTaxationAllowedForType(type, s)
                                ).map((s) => ({
                                    value: s,
                                    label: TAXATION_SYSTEM_LABEL[s],
                                }))}
                                value={taxationSystem}
                                onChange={(v) =>
                                    setTaxationSystem(v as TaxationSystem)
                                }
                                error={errors.taxationSystem}
                            />
                            <div className="space-y-1">
                                <label
                                    htmlFor="payee-vat"
                                    className="flex cursor-pointer items-center justify-between gap-3"
                                >
                                    <span className="text-foreground text-sm font-medium">
                                        Платник ПДВ
                                    </span>
                                    <UiSwitch
                                        id="payee-vat"
                                        checked={isVatPayer}
                                        onChange={setIsVatPayer}
                                    />
                                </label>
                                {errors.isVatPayer && (
                                    <p className="text-destructive text-sm">
                                        {errors.isVatPayer}
                                    </p>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </UiSectionCard>

            <UiSectionCard title="Призначення платежу">
                <p className="text-muted-foreground mt-2 text-sm">
                    Вставте маркери, куди платник підставить свої дані. Тоді
                    сторінка стане податковою: перед QR зʼявиться форма.
                </p>
                <PurposeTemplateField
                    label="Шаблон призначення"
                    value={purpose}
                    onChange={setPurpose}
                    error={errors.paymentPurposeTemplate}
                    placeholder="Єдиний внесок {taxId} за {period}"
                />
            </UiSectionCard>

            <UiSectionCard title="Каталог">
                <div className="mt-4 space-y-4">
                    <UiSelect
                        label="Категорія"
                        options={CATALOG_CATEGORIES.map((c) => ({
                            value: c,
                            label: CATALOG_CATEGORY_LABEL[c],
                        }))}
                        value={category}
                        onChange={(v) => setCategory(v as CatalogCategory)}
                    />
                    {!isEdit && (
                        <label
                            htmlFor="payee-visible"
                            className="flex cursor-pointer items-center justify-between gap-3"
                        >
                            <span className="text-foreground text-sm font-medium">
                                Показувати в каталозі одразу
                            </span>
                            <UiSwitch
                                id="payee-visible"
                                checked={catalogVisible}
                                onChange={setCatalogVisible}
                            />
                        </label>
                    )}
                </div>
            </UiSectionCard>

            <div className="flex justify-end gap-3">
                <UiButton
                    as="link"
                    href={
                        isEdit
                            ? `/admin/payees/${existing.slug}`
                            : '/admin/payees'
                    }
                    variant="text"
                    size="md"
                >
                    Скасувати
                </UiButton>
                <UiButton
                    type="button"
                    variant="filled"
                    size="md"
                    loading={submitting}
                    onClick={() => void handleSubmit()}
                >
                    {isEdit ? 'Зберегти зміни' : 'Створити отримувача'}
                </UiButton>
            </div>
        </UiPageContainer>
    );
}
