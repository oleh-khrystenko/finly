const REDIRECT_KEY = 'auth_redirect';

/** Validate redirect path — must start with `/`, no protocol, no `//` */
export function isValidRedirect(path: string): boolean {
    return (
        path.startsWith('/') && !path.startsWith('//') && !path.includes('://')
    );
}

export function saveRedirect(path: string): void {
    if (isValidRedirect(path)) sessionStorage.setItem(REDIRECT_KEY, path);
}

export function consumeRedirect(fallback: string): string {
    const saved = sessionStorage.getItem(REDIRECT_KEY);
    sessionStorage.removeItem(REDIRECT_KEY);
    return saved && isValidRedirect(saved) ? saved : fallback;
}
