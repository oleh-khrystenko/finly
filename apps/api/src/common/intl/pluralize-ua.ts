/**
 * UA-плюрал за останньою цифрою (mod-10) + спец-кейс на 11..14 (завжди форма
 * "багато"). 1 → one, 2-4 → few, 5-9/0/11-14 → many. Симетричний до web
 * `apps/web/src/shared/lib/intl.ts` — single source перегортається у
 * `@finly/types/utils` за потреби (Sprint 10+, якщо буде ще один callsite на
 * web/api).
 */
export function pluralizeUa(
    count: number,
    one: string,
    few: string,
    many: string
): string {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod100 >= 11 && mod100 <= 14) return `${count} ${many}`;
    if (mod10 === 1) return `${count} ${one}`;
    if (mod10 >= 2 && mod10 <= 4) return `${count} ${few}`;
    return `${count} ${many}`;
}
