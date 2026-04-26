import { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { fetchMetadata } from '@/shared/seo/metadata';
import { MetaProps } from '@/shared/types/settings';
import UiLink from '@/shared/ui/UiLink';
import { LandingFooter } from '@/widgets/agency/landing';
import { DEFAULT_ACCOUNT_DELETION_GRACE_DAYS } from '@cyanship/types';

export async function generateMetadata(props: MetaProps): Promise<Metadata> {
    const { locale } = await props.params;
    const t = await getTranslations({ locale, namespace: 'legal.privacy' });

    return await fetchMetadata({
        ...props,
        page: null,
        href: 'privacy',
        meta: {
            title: t('title'),
            description: t('description'),
        },
    });
}

export default async function PrivacyPage() {
    const locale = await getLocale();

    return (
        <>
            <main className="py-16 md:py-24">
                <article className="container px-6">
                    <div className="mx-auto max-w-3xl">
                        {locale === 'uk' && (
                            <p className="mb-8 rounded-lg border border-border bg-secondary/50 px-4 py-3 text-sm text-muted-foreground">
                                Цей документ доступний лише англійською
                                мовою.
                            </p>
                        )}

                        <header className="mb-10 md:mb-16">
                            <span className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                                Legal
                            </span>
                            <h1 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">
                                Privacy Policy
                            </h1>
                            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
                                The privacy of your data — and it is your data,
                                not ours — is a big deal to us. Here&apos;s the
                                rundown of what we collect and why, when we
                                access your information, and your rights.
                            </p>
                            <p className="mt-4 text-sm text-muted-foreground">
                                Last updated: March 13, 2026
                            </p>
                        </header>

                        <div className="prose-legal space-y-12 text-base leading-relaxed text-muted-foreground">
                            {/* ------------------------------------------------ */}
                            {/* INTRO                                            */}
                            {/* ------------------------------------------------ */}
                            <section>
                                <p>
                                    In this policy, we lay out: what data we
                                    collect and why; how your data is handled;
                                    and your rights with respect to your data. We
                                    promise we never sell your data: never have,
                                    never will.
                                </p>
                                <p className="mt-4">
                                    This policy applies to the CyanShip website
                                    (cyanship.com) and all services built and
                                    maintained by Oleh Khrystenko, sole
                                    proprietor (FOP), operating under the
                                    &quot;CyanShip&quot; brand (referred to as
                                    &quot;Company&quot;, &quot;we&quot;,
                                    &quot;our&quot;, or &quot;us&quot;
                                    throughout).
                                </p>
                                <p className="mt-4">
                                    This policy applies to our handling of
                                    information about site visitors, prospective
                                    customers, and customers (collectively
                                    referred to as &quot;you&quot;). It does not
                                    cover information about a customer&apos;s end
                                    users that we receive or process on a
                                    customer&apos;s behalf under an applicable
                                    services agreement.
                                </p>
                            </section>

                            {/* ------------------------------------------------ */}
                            {/* WHAT WE COLLECT AND WHY                          */}
                            {/* ------------------------------------------------ */}
                            <section>
                                <h2>What We Collect and Why</h2>
                                <p className="mt-4">
                                    Our guiding principle is to collect only what
                                    we need. Here&apos;s what that means in
                                    practice:
                                </p>

                                <h3>Identity and Access</h3>
                                <p className="mt-3">
                                    When you sign up for a CyanShip product, we
                                    ask for identifying information such as your
                                    name and email address. That&apos;s so you
                                    can personalize your account, and we can send
                                    you product updates and other essential
                                    information. We&apos;ll never sell your
                                    personal information to third parties, and we
                                    won&apos;t use your name in marketing
                                    statements without your permission.
                                </p>

                                <h3>Billing Information</h3>
                                <p className="mt-3">
                                    If you sign up for a paid service, you will
                                    be asked to provide your payment information.
                                    Credit card information is submitted directly
                                    to our payment processor (Stripe) and never
                                    touches our servers. We store a record of the
                                    payment transaction, including the last 4
                                    digits of the credit card number, for account
                                    history, invoicing, and billing support. We
                                    store your billing address to charge you for
                                    service, calculate any sales tax due, send
                                    invoices, and detect fraudulent transactions.
                                </p>

                                <h3>Product Interactions</h3>
                                <p className="mt-3">
                                    We store on our servers the content that you
                                    upload or maintain in your product accounts.
                                    This is so you can use our products as
                                    intended. We keep this content as long as
                                    your account is active. If you delete your
                                    account, we&apos;ll delete the content within{' '}
                                    {DEFAULT_ACCOUNT_DELETION_GRACE_DAYS} days.
                                </p>

                                <h3>Website Analytics</h3>
                                <p className="mt-3">
                                    We collect information about your browsing
                                    activity for analytics and statistical
                                    purposes such as conversion rate testing.
                                    This includes your browser and operating
                                    system versions, which web pages you visited
                                    and how long they took to load, and which
                                    website referred you to us.
                                </p>

                                <h3>Cookies</h3>
                                <p className="mt-3">
                                    We use persistent first-party cookies to
                                    store certain preferences, make it easier for
                                    you to use our applications, and support
                                    analytics. A cookie is a piece of text stored
                                    by your browser. You can adjust cookie
                                    retention settings and accept or block
                                    individual cookies in your browser settings,
                                    although our apps may not function properly if
                                    you turn cookies off.
                                </p>

                                <h3>Voluntary Correspondence</h3>
                                <p className="mt-3">
                                    When you email us with a question or to ask
                                    for help, we keep that correspondence,
                                    including your email address, so that we have
                                    a history of past correspondence to reference
                                    if you reach out in the future.
                                </p>
                            </section>

                            {/* ------------------------------------------------ */}
                            {/* WHEN WE ACCESS OR DISCLOSE YOUR INFO             */}
                            {/* ------------------------------------------------ */}
                            <section>
                                <h2>
                                    When We Access or Disclose Your Information
                                </h2>

                                <p className="mt-4">
                                    <strong>
                                        To provide products or services
                                        you&apos;ve requested.
                                    </strong>{' '}
                                    We use the following third-party
                                    subprocessors to help run our applications
                                    and provide services to you:
                                </p>
                                <ul className="mt-3">
                                    <li>
                                        <strong>Stripe</strong> — payment
                                        processing
                                    </li>
                                    <li>
                                        <strong>Vercel</strong> — website hosting
                                        and deployment
                                    </li>
                                    <li>
                                        <strong>MongoDB Atlas</strong> — database
                                        hosting
                                    </li>
                                    <li>
                                        <strong>Resend</strong> — transactional
                                        email delivery
                                    </li>
                                    <li>
                                        <strong>Google</strong> — OAuth
                                        authentication
                                    </li>
                                </ul>

                                <p className="mt-6">
                                    <strong>
                                        To help you troubleshoot or squash a
                                        software bug, with your permission.
                                    </strong>{' '}
                                    If at any point we need to access your
                                    content to help you with a support case, we
                                    will ask for your consent before proceeding.
                                </p>

                                <p className="mt-6">
                                    <strong>
                                        Aggregated and de-identified data.
                                    </strong>{' '}
                                    We may aggregate and/or de-identify
                                    information collected through the services.
                                    We may use de-identified or aggregated data
                                    for any purpose, including marketing or
                                    analytics.
                                </p>

                                <p className="mt-6">
                                    <strong>
                                        When required under applicable law.
                                    </strong>{' '}
                                    If compelled by legal process (a warrant,
                                    subpoena, or court order), we may be required
                                    to disclose data. Our policy is to notify
                                    affected users before disclosure unless we
                                    are legally prohibited from doing so.
                                </p>

                                <p className="mt-6">
                                    If CyanShip is acquired by or merges with
                                    another company, we&apos;ll notify you well
                                    before any of your personal information is
                                    transferred or becomes subject to a different
                                    privacy policy.
                                </p>
                            </section>

                            {/* ------------------------------------------------ */}
                            {/* YOUR RIGHTS                                      */}
                            {/* ------------------------------------------------ */}
                            <section>
                                <h2>
                                    Your Rights With Respect to Your Information
                                </h2>
                                <p className="mt-4">
                                    We strive to apply the same data rights to
                                    all customers, regardless of location. Your
                                    rights include:
                                </p>
                                <ul className="mt-4">
                                    <li>
                                        <strong>Right to Know.</strong> You have
                                        the right to know what personal
                                        information is collected, used, shared,
                                        or sold.
                                    </li>
                                    <li>
                                        <strong>Right of Access.</strong> You
                                        have the right to access the personal
                                        information we gather about you.
                                    </li>
                                    <li>
                                        <strong>Right to Correction.</strong> You
                                        have the right to request correction of
                                        your personal information.
                                    </li>
                                    <li>
                                        <strong>
                                            Right to Erasure / &quot;To Be
                                            Forgotten&quot;.
                                        </strong>{' '}
                                        You have the right to request that your
                                        personal information be erased from our
                                        possession. Fulfillment of some data
                                        deletion requests may prevent you from
                                        using our services, which may result in
                                        closing your account.
                                    </li>
                                    <li>
                                        <strong>Right to Complain.</strong> You
                                        have the right to make a complaint
                                        regarding our handling of your personal
                                        information with the appropriate
                                        supervisory authority.
                                    </li>
                                    <li>
                                        <strong>
                                            Right to Restrict Processing.
                                        </strong>{' '}
                                        You have the right to request restriction
                                        of how and why your personal information
                                        is used or processed.
                                    </li>
                                    <li>
                                        <strong>Right to Object.</strong> You
                                        have the right, in certain situations, to
                                        object to how or why your personal
                                        information is processed.
                                    </li>
                                    <li>
                                        <strong>Right to Portability.</strong>{' '}
                                        You have the right to receive the
                                        personal information we have about you
                                        and the right to transmit it to another
                                        party.
                                    </li>
                                    <li>
                                        <strong>
                                            Right to Non-Discrimination.
                                        </strong>{' '}
                                        We will not charge you a different amount
                                        or give you a lower level of service
                                        because you have exercised your data
                                        privacy rights.
                                    </li>
                                </ul>
                                <p className="mt-4">
                                    If you have questions about exercising these
                                    rights or need assistance, please contact us
                                    at{' '}
                                    <a href="mailto:privacy@cyanship.com">
                                        privacy@cyanship.com
                                    </a>
                                    .
                                </p>
                            </section>

                            {/* ------------------------------------------------ */}
                            {/* HOW WE SECURE YOUR DATA                          */}
                            {/* ------------------------------------------------ */}
                            <section>
                                <h2>How We Secure Your Data</h2>
                                <p className="mt-4">
                                    All data is encrypted via SSL/TLS when
                                    transmitted from our servers to your browser.
                                    Database backups are also encrypted. We go to
                                    great lengths to secure your data at rest and
                                    in transit.
                                </p>
                            </section>

                            {/* ------------------------------------------------ */}
                            {/* WHAT HAPPENS WHEN YOU DELETE                      */}
                            {/* ------------------------------------------------ */}
                            <section>
                                <h2>
                                    What Happens When You Delete Content in Your
                                    Account
                                </h2>
                                <p className="mt-4">
                                    If you choose to cancel your account, your
                                    content will become immediately inaccessible
                                    and will be purged from our systems within{' '}
                                    {DEFAULT_ACCOUNT_DELETION_GRACE_DAYS} days.
                                    This includes all active systems, logs, and
                                    backups.
                                </p>
                            </section>

                            {/* ------------------------------------------------ */}
                            {/* DATA RETENTION                                   */}
                            {/* ------------------------------------------------ */}
                            <section>
                                <h2>Data Retention</h2>
                                <p className="mt-4">
                                    We keep your information for the time
                                    necessary for the purposes for which it is
                                    processed. The length of time depends on the
                                    purposes for which we collected and use it
                                    and your choices, after which time we may
                                    delete and/or aggregate it. We may also
                                    retain and use this information as necessary
                                    to comply with our legal obligations, resolve
                                    disputes, and enforce our agreements.
                                </p>
                            </section>

                            {/* ------------------------------------------------ */}
                            {/* LOCATION OF DATA                                 */}
                            {/* ------------------------------------------------ */}
                            <section>
                                <h2>Location of Site and Data</h2>
                                <p className="mt-4">
                                    Our services are hosted on infrastructure
                                    located in the United States and Europe
                                    (Vercel, MongoDB Atlas). If you are located
                                    in the European Union, UK, or elsewhere
                                    outside of the United States, please be aware
                                    that any information you provide to us may be
                                    transferred to and stored in these regions.
                                    By using our services, you consent to this
                                    transfer.
                                </p>
                            </section>

                            {/* ------------------------------------------------ */}
                            {/* EU TRANSFERS                                     */}
                            {/* ------------------------------------------------ */}
                            <section>
                                <h2>
                                    When Transferring Personal Data From the EU
                                </h2>
                                <p className="mt-4">
                                    The European Data Protection Board (EDPB) has
                                    issued guidance that personal data
                                    transferred out of the EU must be treated
                                    with the same level of protection that is
                                    granted under EU privacy law. UK law provides
                                    similar safeguards for UK user data. We are
                                    committed to treating all user data with this
                                    level of protection regardless of origin.
                                </p>
                            </section>

                            {/* ------------------------------------------------ */}
                            {/* CHANGES & QUESTIONS                              */}
                            {/* ------------------------------------------------ */}
                            <section>
                                <h2>Changes and Questions</h2>
                                <p className="mt-4">
                                    We may update this policy as needed to comply
                                    with relevant regulations and reflect any new
                                    practices. Whenever we make a significant
                                    change, we will refresh the date at the top
                                    of this page.
                                </p>
                                <p className="mt-4">
                                    Have any questions, comments, or concerns
                                    about this privacy policy, your data, or your
                                    rights? Please get in touch by emailing us at{' '}
                                    <a href="mailto:privacy@cyanship.com">
                                        privacy@cyanship.com
                                    </a>
                                    .
                                </p>
                            </section>

                        </div>

                        <footer className="mt-12 border-t border-border pt-8">
                            <p className="text-xs text-muted-foreground/60">
                                This policy is adapted from the{' '}
                                <UiLink
                                    href="https://github.com/basecamp/policies"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    variant="subtle"
                                >
                                    Basecamp open-source policies
                                </UiLink>
                                , licensed under{' '}
                                <UiLink
                                    href="https://creativecommons.org/licenses/by/4.0/"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    variant="subtle"
                                >
                                    CC BY 4.0
                                </UiLink>
                                .
                            </p>
                        </footer>
                    </div>
                </article>
            </main>
            <LandingFooter />
        </>
    );
}
