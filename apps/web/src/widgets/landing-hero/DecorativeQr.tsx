/**
 * Брендований декоративний QR для hero-mockup-у. НЕ сканується — це візуальний
 * підпис продукту, не платіжна команда. Реальний QR живе у
 * `features/qr-landing-preview` після того, як користувач вводить IBAN.
 *
 * Модулі — фірмовим primary-кольором на білій плитці (як кольорові брендовані
 * QR), ₴-марка в центрі повторює production-pipeline (logo-overlay). Сітка
 * детермінована (seeded LCG на module-eval), тож SSR і клієнт дають однакову
 * розмітку — без hydration-mismatch і без `Math.random`.
 */

const N = 29; // модулів по стороні (схоже на реальний QR version-3 діапазон)
const MARGIN = 2; // quiet zone у модулях
const LOGO_LO = 11; // межі вирізу під центральну ₴-марку
const LOGO_HI = 17;

type Cell = readonly [number, number]; // [row, col]

function buildModules(): Cell[] {
    const dark: boolean[][] = Array.from({ length: N }, () =>
        Array<boolean>(N).fill(false)
    );

    // Finder-патерни (3 кути): 7×7 рамка + 3×3 ядро — характерна QR-ознака.
    const placeFinder = (r0: number, c0: number) => {
        for (let i = 0; i < 7; i += 1) {
            for (let j = 0; j < 7; j += 1) {
                const edge = i === 0 || i === 6 || j === 0 || j === 6;
                const core = i >= 2 && i <= 4 && j >= 2 && j <= 4;
                dark[r0 + i][c0 + j] = edge || core;
            }
        }
    };
    placeFinder(0, 0);
    placeFinder(0, N - 7);
    placeFinder(N - 7, 0);

    const inFinder = (r: number, c: number) =>
        (r < 8 && c < 8) || (r < 8 && c >= N - 8) || (r >= N - 8 && c < 8);
    const inLogo = (r: number, c: number) =>
        r >= LOGO_LO && r <= LOGO_HI && c >= LOGO_LO && c <= LOGO_HI;

    // Детермінований LCG — стабільна «випадковість» між SSR і клієнтом.
    let seed = 0x9e3779b9;
    const rand = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 0xffffffff;
    };

    const cells: Cell[] = [];
    for (let r = 0; r < N; r += 1) {
        for (let c = 0; c < N; c += 1) {
            if (inFinder(r, c)) {
                if (dark[r][c]) cells.push([r, c]);
                continue;
            }
            if (inLogo(r, c)) continue;
            if (rand() < 0.46) cells.push([r, c]);
        }
    }
    return cells;
}

const MODULES = buildModules();
const SIZE = N + MARGIN * 2;

export function DecorativeQr({ className }: { className?: string }) {
    return (
        <svg
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className={className}
            aria-hidden="true"
            role="presentation"
            shapeRendering="crispEdges"
        >
            {MODULES.map(([r, c]) => (
                <rect
                    key={`${r}-${c}`}
                    x={MARGIN + c}
                    y={MARGIN + r}
                    width={1}
                    height={1}
                    rx={0.18}
                    className="fill-primary"
                />
            ))}

            {/* Центральна ₴-марка — округлений primary-бейдж з білим знаком. */}
            <rect
                x={MARGIN + LOGO_LO}
                y={MARGIN + LOGO_LO}
                width={LOGO_HI - LOGO_LO + 1}
                height={LOGO_HI - LOGO_LO + 1}
                rx={2}
                className="fill-primary"
            />
            <text
                x={SIZE / 2}
                y={SIZE / 2}
                dy="0.34em"
                textAnchor="middle"
                className="fill-white font-bold"
                style={{ fontSize: 5 }}
            >
                ₴
            </text>
        </svg>
    );
}
