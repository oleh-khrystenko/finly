import {
    individualTaxIdZod,
    legalEntityTaxIdZod,
    type BusinessType,
} from '@finly/types';

/**
 * Sprint 7 §SP-4 — UI-config поля "Код одержувача" per BusinessType.
 *
 * Норматив НБУ §IV.10.5 явно дозволяє два формати: 10-цифровий РНОКПП
 * (фізособа / ФОП) АБО 8-цифровий ЄДРПОУ (юр.особа). Мапінг **мусить бути
 * стабільним і єдиним** — два consumer-и (`BusinessCreateForm` на /business/new,
 * `RequisitesSection` у cabinet edit) повинні рендерити рівно ту саму
 * label-у, placeholder, maxLength і validator. Без shared-helper-а перший
 * drift у label-копії ламає UAT-чекліст PUB-6..9 (різні UA-рядки у двох
 * місцях для однакового кейсу).
 *
 * **Чому в `entities/business/` (а не `shared/lib/`)**: це **бізнес-domain**
 * helper — він оперує `BusinessType` enum-ом, мапить його на доменну
 * UI-семантику. `shared/lib/` — для domain-agnostic утиліт (date formatting,
 * css helpers). `entities/{domain}/` — domain-specific утиліти, що споживає
 * decompose-features. FSD layer-iнваріант (`shared/` не імпортує
 * `entities/`); entities-helper можна безпечно імпортувати з features
 * (business-wizard, business-edit).
 *
 * **Discriminator-таблиця замість `if/else`** — додавання нового
 * `BusinessType` без оновлення цього мапінгу дає compile-error через
 * `Record<BusinessType, ...>` exhaustiveness (fail-fast convention).
 *
 * **`maxLength` — фізичний cap інпута, НЕ нормативна довжина коду.**
 * Жорсткий `maxLength` на нормативній довжині (10/8) мовчки обрізав би
 * зайві символи (особливо при вставці) — користувач не розуміє, чому
 * «не вводиться». Cap із запасом (15) + окремий validation-код
 * `INVALID_*_TOO_LONG` роблять надлишок видимим і поясненим.
 */

/** Фізичний `<input maxLength>` для полів коду одержувача (з запасом). */
export const TAX_ID_INPUT_MAX_LENGTH = 15;

/**
 * Union конкретних Zod-типів двох taxId-валідаторів. Використовуємо саме
 * union, а не загальний `ZodType<string>`, щоб TS вивів `output` / `input`
 * як `string` у `z.object({ taxId: validator })`-shape — інакше TS падає
 * у `unknown`-output при composition.
 */
export type TaxIdValidator =
    | typeof individualTaxIdZod
    | typeof legalEntityTaxIdZod;

export interface TaxIdFieldConfig {
    /** UA label — `'РНОКПП'` (10 цифр) АБО `'ЄДРПОУ'` (8 цифр). */
    label: string;
    /** Placeholder — приклад валідного значення для відповідного формату. */
    placeholder: string;
    /**
     * Human-readable підпис під полем — знімає frictions, які голий
     * нормативний label не знімає («це особистий код чи фопівський?», «де
     * взяти?»). Симетрично з `NAME_HELPERS` у Step1: low-friction tone-bridge
     * між «бюрократичною» абревіатурою-label-ом і паперовою реальністю.
     */
    description: string;
    /**
     * Zod-валідатор, що буде використаний у RHF-resolver-і / `safeParse`.
     * `individualTaxIdZod` для individual / fop (10 + checksum), або
     * `legalEntityTaxIdZod` для tov / organization (8 цифр без checksum).
     */
    validator: TaxIdValidator;
    /** Фізичний `<input maxLength>` — `TAX_ID_INPUT_MAX_LENGTH`, не норматив. */
    maxLength: number;
}

type TaxIdFieldStatic = Omit<TaxIdFieldConfig, 'maxLength'>;

const STATIC_CONFIG_BY_TYPE: Record<BusinessType, TaxIdFieldStatic> = {
    // Плейсхолдер — checksum-валідний приклад (десята цифра РНОКПП —
    // контрольна за алгоритмом ДПС): «1234567890» не проходить перевірку,
    // і введене «як у прикладі» значення миттєво червоніло б.
    individual: {
        label: 'РНОКПП',
        placeholder: '1234567899',
        description: '10 цифр, як у довідці ДПС',
        validator: individualTaxIdZod,
    },
    fop: {
        label: 'РНОКПП',
        placeholder: '1234567899',
        description: '10 цифр, особистий код з довідки ДПС',
        validator: individualTaxIdZod,
    },
    tov: {
        label: 'ЄДРПОУ',
        placeholder: '12345678',
        description: '8 цифр, як у виписці ЄДР',
        validator: legalEntityTaxIdZod,
    },
    organization: {
        label: 'ЄДРПОУ',
        placeholder: '12345678',
        description: '8 цифр, як у виписці ЄДР',
        validator: legalEntityTaxIdZod,
    },
};

export const taxIdFieldConfig = (type: BusinessType): TaxIdFieldConfig => ({
    ...STATIC_CONFIG_BY_TYPE[type],
    maxLength: TAX_ID_INPUT_MAX_LENGTH,
});
