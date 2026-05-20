/**
 * Декоративний QR-паттерн для hero-mockup-у. НЕ сканується — використовується
 * лише як візуальна репрезентація продукту. Реальний QR живе у
 * `features/qr-landing-preview` після того, як користувач вводить IBAN.
 *
 * Чому не реальний QR: для декоративного hero не хочемо тримати hard-coded
 * IBAN-адресу Finly у frontend-коді (changeable, deployment-coupled) і не
 * хочемо лити network-request за асет, що не змінюється.
 */
export function DecorativeQr({ className }: { className?: string }) {
    return (
        <svg
            viewBox="0 0 100 100"
            className={className}
            aria-hidden="true"
            role="presentation"
        >
            {/* Finder patterns (3 кути) — характерна QR-ознака */}
            <FinderPattern x={4} y={4} />
            <FinderPattern x={76} y={4} />
            <FinderPattern x={4} y={76} />

            {/* Випадковий, але детерміністичний modules-grid */}
            {MODULES.map(([x, y, w, h], i) => (
                <rect
                    key={i}
                    x={x}
                    y={y}
                    width={w}
                    height={h}
                    className="fill-foreground"
                />
            ))}

            {/* Logo-overlay центром (₴) — як у production QR-pipeline */}
            <rect
                x={38}
                y={38}
                width={24}
                height={24}
                rx={4}
                className="fill-background"
            />
            <text
                x={50}
                y={58}
                textAnchor="middle"
                className="fill-primary text-lg font-bold"
            >
                ₴
            </text>
        </svg>
    );
}

function FinderPattern({ x, y }: { x: number; y: number }) {
    return (
        <g className="fill-foreground">
            <rect x={x} y={y} width={20} height={20} rx={2} />
            <rect
                x={x + 3}
                y={y + 3}
                width={14}
                height={14}
                rx={1}
                className="fill-background"
            />
            <rect x={x + 6} y={y + 6} width={8} height={8} rx={1} />
        </g>
    );
}

// Детерміністична псевдо-випадкова сітка модулів — стабільно виглядає як QR,
// але не несе payload. 3×3 та 2×2 групи нагадують реальні data-modules.
const MODULES: ReadonlyArray<readonly [number, number, number, number]> = [
    [28, 4, 3, 3],
    [34, 4, 3, 3],
    [40, 4, 3, 3],
    [48, 4, 3, 3],
    [56, 4, 3, 3],
    [62, 4, 3, 3],
    [28, 10, 3, 3],
    [38, 10, 3, 3],
    [52, 10, 3, 3],
    [60, 10, 3, 3],
    [4, 28, 3, 3],
    [10, 28, 3, 3],
    [16, 28, 3, 3],
    [22, 28, 3, 3],
    [28, 28, 3, 3],
    [34, 28, 3, 3],
    [66, 28, 3, 3],
    [72, 28, 3, 3],
    [78, 28, 3, 3],
    [86, 28, 3, 3],
    [4, 34, 3, 3],
    [12, 34, 3, 3],
    [20, 34, 3, 3],
    [68, 34, 3, 3],
    [80, 34, 3, 3],
    [86, 34, 3, 3],
    [4, 40, 3, 3],
    [10, 40, 3, 3],
    [22, 40, 3, 3],
    [28, 40, 3, 3],
    [66, 40, 3, 3],
    [78, 40, 3, 3],
    [86, 40, 3, 3],
    [4, 50, 3, 3],
    [14, 50, 3, 3],
    [22, 50, 3, 3],
    [28, 50, 3, 3],
    [68, 50, 3, 3],
    [78, 50, 3, 3],
    [86, 50, 3, 3],
    [4, 60, 3, 3],
    [10, 60, 3, 3],
    [18, 60, 3, 3],
    [24, 60, 3, 3],
    [68, 60, 3, 3],
    [74, 60, 3, 3],
    [80, 60, 3, 3],
    [86, 60, 3, 3],
    [28, 68, 3, 3],
    [34, 68, 3, 3],
    [62, 68, 3, 3],
    [68, 68, 3, 3],
    [80, 68, 3, 3],
    [28, 76, 3, 3],
    [40, 76, 3, 3],
    [50, 76, 3, 3],
    [60, 76, 3, 3],
    [68, 76, 3, 3],
    [80, 76, 3, 3],
    [28, 86, 3, 3],
    [34, 86, 3, 3],
    [44, 86, 3, 3],
    [52, 86, 3, 3],
    [62, 86, 3, 3],
    [74, 86, 3, 3],
    [86, 86, 3, 3],
    [28, 92, 3, 3],
    [40, 92, 3, 3],
    [50, 92, 3, 3],
    [60, 92, 3, 3],
    [72, 92, 3, 3],
    [82, 92, 3, 3],
];
