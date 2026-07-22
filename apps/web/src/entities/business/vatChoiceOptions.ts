import {
    VAT_ALLOWED_TAXATION_SYSTEMS,
    type VatAllowedTaxationSystem,
} from '@finly/types';
import type { UiRadioCardGroupOption } from '@/shared/ui/UiRadioCardGroup';

/**
 * UI-config поля "Платник ПДВ" як radio-cards (`BusinessCreateForm` на
 * /business/new + `TaxationSection` у cabinet edit). Семантика поля **різна**
 * на двох системах:
 *
 *  - **Спрощена-3** — це фактично вибір ставки єдиного податку (ст. 293.3 ПКУ):
 *    3% з окремою сплатою ПДВ vs 5% з ПДВ, що включений у склад ЄП. Платник
 *    ЄП-3 на 5% юридично НЕ може бути платником ПДВ; перехід 5%↔3% — за заявою
 *    за 10 календарних днів до початку кварталу.
 *  - **Загальна** — це факт реєстрації у податковій за формою 1-ПДВ (ст. 181,
 *    182 ПКУ): обовʼязкова при обороті понад 1 млн грн за 12 місяців, до цього
 *    порогу — добровільна.
 *
 * Замість UiSwitch + єдиний підпис під ним — два варіанти UiRadioCardGroup з
 * власним titlом і description-ом, що чесно показують ціну вибору. Дві окремі
 * семантики не змішуються в один tumbler.
 *
 * **Чому в `entities/business/`** (а не `shared/lib/` чи `features/...`):
 * symmetric з `taxIdField.ts` — domain helper, що оперує доменним
 * enum-ом (`VatAllowedTaxationSystem`) і мапить його на UI-семантику. Сonsumer-и
 * — два features (`business-wizard` /business/new, `business-edit`), shared-
 * розташування уникає cross-feature import-у (`modular-boundaries.md`).
 *
 * **Чому `VatChoice` як `'no' | 'yes'`, а не `boolean`**: `UiRadioCardGroup`
 * generic над `TValue extends string`. Bool↔string mapping живе тут, щоб
 * callsite не повторював mapping-логіку.
 */

export type VatChoice = 'no' | 'yes';

export const vatBoolToChoice = (v: boolean): VatChoice => (v ? 'yes' : 'no');
export const vatChoiceToBool = (v: VatChoice): boolean => v === 'yes';

/**
 * Заголовок radio-card-секції залежить від системи — на Спрощеній-3 це питання
 * про **ставку**, на Загальній — про **факт реєстрації**.
 */
export const VAT_CHOICE_SECTION_LABEL: Record<
    VatAllowedTaxationSystem,
    string
> = {
    'simplified-3': 'Як ви платите ПДВ?',
    general: 'Реєстрація платником ПДВ',
};

const OPTIONS_BY_SYSTEM: Record<
    VatAllowedTaxationSystem,
    ReadonlyArray<UiRadioCardGroupOption<VatChoice>>
> = {
    'simplified-3': [
        {
            value: 'no',
            title: 'Ставка 5% без ПДВ',
            description:
                'Платите єдиний податок 5% від доходу. Не реєструєтесь у податковій як платник ПДВ.',
        },
        {
            value: 'yes',
            title: 'Ставка 3% + ПДВ',
            description:
                'Платите ЄП 3% + 20% ПДВ окремо. Підходить для роботи з ПДВ-клієнтами (B2B).',
        },
    ],
    general: [
        {
            value: 'no',
            title: 'Не зареєстрований',
            description:
                'Підходить, поки оборот менше 1 млн грн за 12 місяців.',
        },
        {
            value: 'yes',
            title: 'Зареєстрований платник ПДВ',
            description:
                'При обороті понад 1 млн грн обовʼязково або за добровільним вибором.',
        },
    ],
};

export const getVatChoiceOptions = (
    system: VatAllowedTaxationSystem
): ReadonlyArray<UiRadioCardGroupOption<VatChoice>> =>
    OPTIONS_BY_SYSTEM[system];

/**
 * Type-guard для звуження `TaxationSystem` до `VatAllowedTaxationSystem` без
 * runtime-дублювання `VAT_ALLOWED_TAXATION_SYSTEMS`. Reuse-ить існуючий
 * helper з `@finly/types`, але дає TS-narrow до union literal-у.
 */
export const isVatChoiceApplicable = (
    system: string | undefined
): system is VatAllowedTaxationSystem =>
    system !== undefined &&
    (VAT_ALLOWED_TAXATION_SYSTEMS as readonly string[]).includes(system);
