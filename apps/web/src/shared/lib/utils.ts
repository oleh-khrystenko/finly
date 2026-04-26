/**
 * Composes multiple class names into a single string, filtering out falsy values
 *
 * @param classes - Array of class names, can include false/undefined for conditional classes
 * @returns Single string with all truthy classes joined by space
 *
 * @example
 * composeClasses('btn', isActive && 'active', 'px-4')
 * // Returns: 'btn active px-4' (if isActive is true)
 * // Returns: 'btn px-4' (if isActive is false)
 */
export const composeClasses = (
    ...classes: Array<string | false | undefined>
): string => classes.filter(Boolean).join(' ');
