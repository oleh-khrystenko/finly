'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { z } from 'zod';
import { individualTaxIdZod, middleNameSchema } from '@finly/types';
import type { UserProfile } from '@finly/types';
import UiButton from '@/shared/ui/UiButton';
import UiInput from '@/shared/ui/UiInput';
import UiSectionCard from '@/shared/ui/UiSectionCard';
import { getZodFieldError } from '@/shared/lib';
import { updateProfile, getMe } from '@/shared/api';
import { useAuthStore } from '@/entities/user';

/**
 * Обидва поля опційні і очищувані: порожній рядок — це «прибрати значення», і
 * саме так його трактує сервер. Тому валідатори застосовуються лише до
 * непорожнього вводу — інакше порожня форма (звичайний стан для того, хто
 * податків не платить) світилася б помилками.
 */
const TaxDataFormSchema = z.object({
    middleName: z.union([middleNameSchema, z.literal('')]),
    taxId: z.union([individualTaxIdZod, z.literal('')]),
});

type TaxDataFormValues = z.input<typeof TaxDataFormSchema>;

/** Довжина РНОКПП — поле ріже нецифри, тож більше набрати неможливо. */
const TAX_ID_LENGTH = 10;

interface Props {
    user: UserProfile;
}

/**
 * Sprint 30 — власні дані для податкових платежів. Джерело підстановки на
 * публічних податкових сторінках: заповнив один раз — далі поля на сторінці
 * оплати заповнюються самі (і лишаються редагованими перед оплатою).
 */
export default function TaxDataForm({ user }: Props) {
    const setUser = useAuthStore((s) => s.setUser);

    const form = useForm<TaxDataFormValues>({
        resolver: zodResolver(TaxDataFormSchema),
        mode: 'onTouched',
        defaultValues: {
            middleName: user.profile.middleName ?? '',
            taxId: user.profile.taxId ?? '',
        },
    });

    const { errors, isSubmitting, isDirty } = form.formState;

    const onSubmit = async (data: TaxDataFormValues) => {
        try {
            await updateProfile({
                middleName: data.middleName.trim(),
                taxId: data.taxId.trim(),
            });
            const me = await getMe();
            setUser(me);
            form.reset({
                middleName: me.profile.middleName ?? '',
                taxId: me.profile.taxId ?? '',
            });
            toast.success('Податкові дані збережено');
        } catch {
            toast.error('Не вдалося зберегти податкові дані');
        }
    };

    return (
        <UiSectionCard title="Податкові дані">
            <p className="text-muted-foreground mt-2 text-sm">
                Потрібні лише для сплати податків через Finly: ми підставимо їх
                у призначення платежу замість ручного вводу. Ці дані бачите
                тільки ви.
            </p>

            <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="mt-4 max-w-md space-y-4"
            >
                <div>
                    <label className="text-muted-foreground mb-1.5 block text-sm">
                        По батькові
                    </label>
                    <UiInput
                        {...form.register('middleName')}
                        type="text"
                        placeholder="Ваше по батькові"
                        error={getZodFieldError(errors.middleName)}
                        size="lg"
                    />
                </div>

                <div>
                    <label className="text-muted-foreground mb-1.5 block text-sm">
                        РНОКПП (податковий номер)
                    </label>
                    <UiInput
                        {...form.register('taxId', {
                            onChange: (e) => {
                                // Поле числове за нормативом; ріжемо все, крім
                                // цифр, ще на вводі, щоб вставка з пробілами чи
                                // дефісами не падала на валідації.
                                e.target.value = e.target.value.replace(
                                    /\D/g,
                                    ''
                                );
                            },
                        })}
                        type="text"
                        inputMode="numeric"
                        maxLength={TAX_ID_LENGTH}
                        placeholder="10 цифр"
                        error={getZodFieldError(errors.taxId)}
                        size="lg"
                    />
                </div>

                {isDirty && (
                    <div className="flex items-center gap-3">
                        <UiButton
                            type="submit"
                            variant="filled"
                            size="md"
                            loading={isSubmitting}
                        >
                            Зберегти
                        </UiButton>
                        <UiButton
                            type="button"
                            variant="text"
                            size="md"
                            onClick={() => form.reset()}
                            disabled={isSubmitting}
                        >
                            Скасувати
                        </UiButton>
                    </div>
                )}
            </form>
        </UiSectionCard>
    );
}
