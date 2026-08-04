import { mapValidationCode } from '@/shared/lib';

/**
 * Sprint 29 — field-помилки адмінських форм (отримувач і його реквізити).
 *
 * Тексти НЕ живуть тут: переклад машинних Zod-кодів робить спільний
 * `shared/lib/mapValidationCode` (single source of truth, той самий словник, що
 * у кабінетних формах). Файл лишає тільки збирач `Zod issues → мапа поле→текст`,
 * спільний для обох адмін-форм.
 */
export type FieldErrors = Partial<Record<string, string>>;

export function mapFieldMessage(code: string): string {
    // Для непорожнього коду mapValidationCode завжди повертає рядок (невідомий
    // код → власний generic fallback); `??` — лише type-narrowing.
    return mapValidationCode(code) ?? 'Перевірте правильність значення';
}

/** Zod-issues → мапа `поле → текст помилки` для inline-рендеру у формі. */
export function collectFieldErrors(
    issues: readonly { path: PropertyKey[]; message: string }[]
): FieldErrors {
    const next: FieldErrors = {};
    for (const issue of issues) {
        const key = String(issue.path[0] ?? 'form');
        next[key] = mapFieldMessage(issue.message);
    }
    return next;
}
