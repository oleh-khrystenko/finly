import UiButton from '@/shared/ui/UiButton';

/**
 * Copyright-смуга — © + кредити (Ідея / Розробка). Витягнуто з
 * `widgets/landing-footer` без зміни стилів для шарингу між футерами.
 */
export function Copyright() {
    const year = new Date().getFullYear();

    return (
        <div className="border-border border-t">
            <div className="container mx-auto flex flex-col items-center gap-1 px-6 pt-4 pb-2 text-center text-sm sm:flex-row sm:justify-between sm:gap-0 sm:pt-2 sm:text-left">
                <p className="text-muted-foreground">
                    © {year} Finly. Всі права захищено.
                </p>
                <div className="text-muted-foreground flex flex-wrap items-center justify-center gap-x-2 gap-y-1 sm:justify-end">
                    <span className="inline-flex items-center gap-1">
                        Ідея:
                        <UiButton
                            as="a"
                            href="https://easyfin.in.ua/"
                            target="_blank"
                            rel="noopener noreferrer"
                            variant="link"
                            size="sm"
                            className="text-primary hover:text-primary/80 font-medium"
                        >
                            EasyFin
                        </UiButton>
                    </span>
                    <span aria-hidden className="text-muted-foreground/50">
                        ·
                    </span>
                    <span className="inline-flex items-center gap-1">
                        Розробка:
                        <UiButton
                            as="a"
                            href="https://cyanship.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            variant="link"
                            size="sm"
                            className="text-primary hover:text-primary/80 font-medium"
                        >
                            CyanShip
                        </UiButton>
                    </span>
                </div>
            </div>
        </div>
    );
}
