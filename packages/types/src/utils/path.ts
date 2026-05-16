/**
 * Перевіряє, що `target` — same-origin absolute path (придатний для
 * `router.replace`), а не open-redirect-вектор.
 *
 * Single source of truth для path-safety-rule. Reuse-ається у трьох
 * call-site-ах: Zod-refine на `User.pendingPostLoginTarget`, backend
 * write-helper (`UsersService.setPendingPostLoginTarget`), frontend
 * read-helper (`AuthInitializer`).
 */
export function validateSameOriginPath(target: string): boolean {
    return (
        target.startsWith('/') &&
        !target.startsWith('//') &&
        !/^https?:\/\//i.test(target)
    );
}
