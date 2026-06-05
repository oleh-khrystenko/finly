import {
    Rocket,
    Landmark,
    FileText,
    QrCode,
    UserCog,
    BookOpen,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const CATEGORY_ICONS: Record<string, LucideIcon> = {
    'getting-started': Rocket,
    accounts: Landmark,
    invoices: FileText,
    'qr-payments': QrCode,
    'account-billing': UserCog,
};

export function getCategoryIcon(categoryId: string): LucideIcon {
    return CATEGORY_ICONS[categoryId] ?? BookOpen;
}
