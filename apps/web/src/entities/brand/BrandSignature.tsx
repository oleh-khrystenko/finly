import Logo from './Logo';

/**
 * Бренд-підпис — лого + слоган. Витягнуто з brand-колонки
 * `widgets/landing-footer` без зміни стилів для шарингу між футерами.
 */
export function BrandSignature() {
    return (
        <div className="space-y-4">
            <Logo />
            <p className="text-foreground max-w-xs text-base leading-snug font-medium">
                Веди справи, а не папери.
            </p>
        </div>
    );
}
