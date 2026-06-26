import {
    Body,
    Container,
    Head,
    Hr,
    Html,
    Link,
    Section,
    Text,
} from '@react-email/components';
import { EMAIL_COLORS } from '@finly/types';

interface BaseLayoutProps {
    children: React.ReactNode;
}

export function BaseLayout({ children }: BaseLayoutProps) {
    return (
        <Html lang="uk">
            <Head />
            <Body style={body}>
                <Container style={container}>
                    <Section style={header}>
                        <Link href="https://finly.com.ua" style={brandLink}>
                            <Text style={brand}>Finly</Text>
                        </Link>
                        <Text style={tagline}>Веди справи, а не папери.</Text>
                    </Section>
                    {children}
                    <Hr style={divider} />
                    <Text style={siteLink}>
                        <Link
                            href="https://finly.com.ua"
                            style={siteLinkAnchor}
                        >
                            finly.com.ua
                        </Link>
                    </Text>
                </Container>
            </Body>
        </Html>
    );
}

const body: React.CSSProperties = {
    fontFamily: 'sans-serif',
    backgroundColor: EMAIL_COLORS.background,
    padding: '40px 0',
};

const container: React.CSSProperties = {
    maxWidth: '480px',
    margin: '0 auto',
    backgroundColor: EMAIL_COLORS.card,
    borderRadius: '12px',
    padding: '40px',
    textAlign: 'center' as const,
};

const header: React.CSSProperties = {
    marginBottom: '8px',
};

const brandLink: React.CSSProperties = {
    textDecoration: 'none',
};

const brand: React.CSSProperties = {
    fontSize: '24px',
    fontWeight: 700,
    color: EMAIL_COLORS.foreground,
    margin: '0',
};

const tagline: React.CSSProperties = {
    fontSize: '13px',
    color: EMAIL_COLORS.mutedForeground,
    margin: '4px 0 0',
};

const divider: React.CSSProperties = {
    borderColor: EMAIL_COLORS.border,
    margin: '32px 0 24px',
};

const siteLink: React.CSSProperties = {
    margin: '0',
};

const siteLinkAnchor: React.CSSProperties = {
    color: EMAIL_COLORS.primary,
    fontSize: '13px',
    textDecoration: 'none',
};
