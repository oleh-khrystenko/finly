export function getFullName(firstName?: string, lastName?: string): string {
    return [firstName, lastName].filter(Boolean).join(' ');
}

/**
 * Sprint 30 — ПІБ платника для призначення платежу: прізвище, ім'я, по батькові
 * саме в цьому порядку (як у податкових документах і в підказці поля на
 * публічній сторінці). Відрізняється від `getFullName`, який складає
 * розмовне «Ім'я Прізвище» для інтерфейсу — там інший порядок і інша мета.
 *
 * Порожні частини пропускаються: профіль може мати ім'я і прізвище без по
 * батькові, і підстановка все одно має дати осмислене значення, яке людина
 * допише руками.
 */
export function formatPayerFullName(
    lastName?: string,
    firstName?: string,
    middleName?: string
): string {
    return [lastName, firstName, middleName]
        .map((part) => part?.trim())
        .filter((part): part is string => Boolean(part))
        .join(' ');
}
