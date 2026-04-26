import { SVGProps } from 'react';

/**
 * Standard props for icon components
 *
 * Uses React's built-in SVGProps which already includes:
 * - className: string
 * - style: CSSProperties
 * - onClick, onMouseEnter, etc.
 * - aria-* attributes
 * - data-* attributes
 * - all other standard SVG attributes
 *
 * @example
 * ```tsx
 * import type { IconProps } from '@/shared/icons';
 *
 * const MyIcon = ({ className = 'h-5 w-5', ...props }: IconProps) => {
 *   return (
 *     <svg
 *       className={className}
 *       viewBox="0 0 24 24"
 *       fill="currentColor"
 *       xmlns="http://www.w3.org/2000/svg"
 *       aria-hidden="true"
 *       {...props}
 *     >
 *       <path d="..." />
 *     </svg>
 *   );
 * };
 * ```
 */
export type IconProps = SVGProps<SVGSVGElement>;
