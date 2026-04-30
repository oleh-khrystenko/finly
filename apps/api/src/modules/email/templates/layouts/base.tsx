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
import { EMAIL_COLORS } from '@neatslip/types';

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
                        <Link href="https://neatslip.com" style={brandLink}>
                            <Text style={brand}>NeatSlip</Text>
                        </Link>
                    </Section>
                    {children}
                    <Hr style={divider} />
                    <Section style={footerSection}>
                        <Link
                            href="https://www.linkedin.com/in/oleh-khrystenko"
                            style={socialLink}
                        >
                            LinkedIn
                        </Link>
                        <span style={socialDot}>&middot;</span>
                        <Link
                            href="https://github.com/oleh-khrystenko"
                            style={socialLink}
                        >
                            GitHub
                        </Link>
                    </Section>
                    <Text style={siteLink}>
                        <Link
                            href="https://neatslip.com"
                            style={siteLinkAnchor}
                        >
                            neatslip.com
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

const divider: React.CSSProperties = {
    borderColor: EMAIL_COLORS.background,
    margin: '32px 0 24px',
};

const footerSection: React.CSSProperties = {
    textAlign: 'center' as const,
};

const socialLink: React.CSSProperties = {
    color: EMAIL_COLORS.mutedForeground,
    fontSize: '13px',
    textDecoration: 'none',
};

const socialDot: React.CSSProperties = {
    color: EMAIL_COLORS.mutedForeground,
    margin: '0 8px',
    fontSize: '13px',
};

const siteLink: React.CSSProperties = {
    margin: '8px 0 0',
};

const siteLinkAnchor: React.CSSProperties = {
    color: EMAIL_COLORS.primary,
    fontSize: '13px',
    textDecoration: 'none',
};
