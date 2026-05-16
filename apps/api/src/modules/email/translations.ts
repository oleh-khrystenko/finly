// Single-locale uk only — пряме string-джерело без `t()`-runtime. Sprint 12 §12.1b
// створює файл вперше (decoration з tone.md §Patterns закладалася як convention
// для майбутніх рядків, але до цього спринту жоден шаблон не агрегував копії
// поза template-файлом). Migration of existing magic-link / deletion templates
// — окремий tech-debt-ticket поза скоупом Sprint 12.

export const PROFILE_COMPLETION_CTA_PATH = '/profile?mode=new&next=/business';

const PLURAL_RULES_UK = new Intl.PluralRules('uk-UA');

function pluralBusinesses(count: number): string {
    return PLURAL_RULES_UK.select(count) === 'few' ? 'бізнеси' : 'бізнесів';
}

function pluralAccounts(count: number): string {
    return PLURAL_RULES_UK.select(count) === 'few' ? 'рахунки' : 'рахунків';
}

function pluralDays(count: number): string {
    const form = PLURAL_RULES_UK.select(count);
    if (form === 'one') return 'день';
    if (form === 'few') return 'дні';
    return 'днів';
}

function formatBusinessList(names: string[]): string {
    return names.map((name) => `«${name}»`).join(', ');
}

export const EMAIL_TEXT = {
    profileCompletion: {
        reminder: {
            singleSubject: 'Завершіть налаштування акаунту Finly',
            multiSubject: 'Завершіть налаштування акаунту Finly',
            cta: 'Заповнити профіль',
            singleBody(businessName: string, deletionDays: number): string {
                return `Доброго дня. Ви створили бізнес «${businessName}» через Finly, але ще не дозаповнили профіль (імʼя і прізвище). Завершіть налаштування у кабінеті, щоб зберегти рахунок і виставляти інвойси клієнтам. Без заповненого профілю рахунок буде автоматично видалено через ${deletionDays} ${pluralDays(deletionDays)} від створення бізнесу.`;
            },
            multiBody(businessNames: string[], deletionDays: number): string {
                const count = businessNames.length;
                return `Доброго дня. Ви створили ${count} ${pluralBusinesses(count)} через Finly: ${formatBusinessList(businessNames)}, але ще не дозаповнили профіль. Завершіть налаштування у кабінеті, щоб зберегти ${pluralAccounts(count)}. Без заповненого профілю ${pluralAccounts(count)} буде автоматично видалено через ${deletionDays} ${pluralDays(deletionDays)} від створення першого бізнесу.`;
            },
        },
        finalWarning: {
            singleSubject: 'Останнє нагадування про незаповнений профіль',
            multiSubject: 'Останнє нагадування про незаповнений профіль',
            cta: 'Заповнити профіль',
            singleBody(businessName: string): string {
                return `Доброго дня. Завтра бізнес «${businessName}» буде остаточно видалено через незаповнений профіль. Це останнє нагадування. Завершіть налаштування у кабінеті, щоб зберегти дані.`;
            },
            multiBody(businessNames: string[]): string {
                const count = businessNames.length;
                return `Доброго дня. Завтра ${count} ${pluralBusinesses(count)} ${formatBusinessList(businessNames)} буде остаточно видалено через незаповнений профіль. Це останнє нагадування. Завершіть налаштування у кабінеті, щоб зберегти дані.`;
            },
        },
    },
};
