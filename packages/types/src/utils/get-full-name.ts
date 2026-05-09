export function getFullName(firstName?: string, lastName?: string): string {
    return [firstName, lastName].filter(Boolean).join(' ');
}
