import type { IconProps } from '../types';

const IzibankIcon = ({ className = 'h-full w-full', ...props }: IconProps) => (
    <svg
        className={className}
        viewBox="0 0 80 80"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        {...props}
    >
        <rect width="80" height="80" rx="14" fill="#E5E7EB" />
        <text
            x="40"
            y="48"
            textAnchor="middle"
            fontSize="22"
            fontWeight="600"
            fill="#6B7280"
            fontFamily="system-ui, sans-serif"
        >
            izi
        </text>
    </svg>
);

export default IzibankIcon;
