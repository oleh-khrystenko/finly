import { Header } from '@/widgets/header';
import { HelpFooter } from '@/widgets/help-footer';

export default function HelpLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <>
            <Header />
            {children}
            <HelpFooter />
        </>
    );
}
