import { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { fetchMetadata } from '@/shared/seo/metadata';
import { MetaProps } from '@/shared/types/settings';
import UiLink from '@/shared/ui/UiLink';
import { LandingFooter } from '@/widgets/agency/landing';
import { DEFAULT_ACCOUNT_DELETION_GRACE_DAYS } from '@cyanship/types';

export async function generateMetadata(props: MetaProps): Promise<Metadata> {
    const { locale } = await props.params;
    const t = await getTranslations({ locale, namespace: 'legal.terms' });

    return await fetchMetadata({
        ...props,
        page: null,
        href: 'terms',
        meta: {
            title: t('title'),
            description: t('description'),
        },
    });
}

export default async function TermsPage() {
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
                                Terms of Service
                            </h1>
                            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
                                All the terms that you agree to when you sign up
                                for a CyanShip product or service.
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
                                    Thank you for using CyanShip! These Terms of
                                    Service (&quot;Terms&quot;) govern your use
                                    of the CyanShip website (cyanship.com) and
                                    all related products and services.
                                </p>
                                <p className="mt-4">
                                    When we say &quot;Company&quot;,
                                    &quot;we&quot;, &quot;our&quot;, or
                                    &quot;us&quot; in this document, we are
                                    referring to Oleh Khrystenko, sole
                                    proprietor (FOP), operating under the
                                    &quot;CyanShip&quot; brand.
                                </p>
                                <p className="mt-4">
                                    When we say &quot;Services&quot;, we mean the
                                    CyanShip website and any product created and
                                    maintained by us, whether delivered within a
                                    web browser, desktop application, or another
                                    format.
                                </p>
                                <p className="mt-4">
                                    When we say &quot;You&quot; or
                                    &quot;your&quot;, we are referring to the
                                    people or organizations that own an account
                                    with one or more of our Services.
                                </p>
                                <p className="mt-4">
                                    We may update these Terms in the future.
                                    Whenever we make a significant change, we
                                    will refresh the date at the top of this page
                                    and take appropriate steps to notify account
                                    holders.
                                </p>
                                <p className="mt-4">
                                    When you use our Services, now or in the
                                    future, you are agreeing to the latest Terms.
                                    There may be times where we do not exercise
                                    or enforce a right or provision of the Terms;
                                    however, that does not mean we are waiving
                                    that right or provision.{' '}
                                    <strong>
                                        These Terms do contain a limitation of
                                        our liability.
                                    </strong>
                                </p>
                            </section>

                            {/* ------------------------------------------------ */}
                            {/* ACCOUNT TERMS                                    */}
                            {/* ------------------------------------------------ */}
                            <section>
                                <h2>Account Terms</h2>
                                <ol className="mt-4">
                                    <li>
                                        You are responsible for maintaining the
                                        security of your account and password.
                                        The Company cannot and will not be liable
                                        for any loss or damage from your failure
                                        to comply with this security obligation.
                                    </li>
                                    <li>
                                        You may not use the Services for any
                                        illegal or unauthorized purpose.
                                    </li>
                                    <li>
                                        You are responsible for all content
                                        posted to and activity that occurs under
                                        your account.
                                    </li>
                                    <li>
                                        You must be a human. Accounts registered
                                        by &quot;bots&quot; or other automated
                                        methods are not permitted.
                                    </li>
                                </ol>
                            </section>

                            {/* ------------------------------------------------ */}
                            {/* PAYMENT, REFUNDS, PLAN CHANGES                   */}
                            {/* ------------------------------------------------ */}
                            <section>
                                <h2>Payment, Refunds, and Plan Changes</h2>
                                <ol className="mt-4">
                                    <li>
                                        If you are using a free version of one of
                                        our Services, it is really free: we do
                                        not ask you for your credit card and we
                                        do not sell your data.
                                    </li>
                                    <li>
                                        For paid Services that offer a free
                                        trial, we explain the length of trial
                                        when you sign up. After the trial period,
                                        you need to pay in advance to keep using
                                        the Service. If you do not pay, we will
                                        freeze your account until you make
                                        payment.
                                    </li>
                                    <li>
                                        If you are upgrading from a free plan to
                                        a paid plan, we will charge your card
                                        immediately and your billing cycle starts
                                        on the day of upgrade.
                                    </li>
                                    <li>
                                        All fees are exclusive of all taxes,
                                        levies, or duties imposed by taxing
                                        authorities. Where required, we will
                                        collect those taxes on behalf of the
                                        taxing authority. Otherwise, you are
                                        responsible for payment of all taxes,
                                        levies, or duties.
                                    </li>
                                    <li>
                                        Refunds are handled on a case-by-case
                                        basis. If you are unhappy with the
                                        service, please contact us at{' '}
                                        <a href="mailto:support@cyanship.com">
                                            support@cyanship.com
                                        </a>{' '}
                                        and we will do our best to find a fair
                                        resolution.
                                    </li>
                                </ol>
                            </section>

                            {/* ------------------------------------------------ */}
                            {/* CANCELLATION AND TERMINATION                     */}
                            {/* ------------------------------------------------ */}
                            <section>
                                <h2>Cancellation and Termination</h2>
                                <ol className="mt-4">
                                    <li>
                                        You are solely responsible for properly
                                        canceling your account. You can cancel
                                        your account from the account settings
                                        page. An email request to cancel your
                                        account is not automatically considered
                                        cancellation.
                                    </li>
                                    <li>
                                        All of your content will be inaccessible
                                        from the Services immediately upon
                                        account cancellation. Within{' '}
                                        {DEFAULT_ACCOUNT_DELETION_GRACE_DAYS}{' '}
                                        days, all content will be permanently
                                        deleted from active systems, logs, and
                                        backups. We cannot recover this
                                        information once it has been permanently
                                        deleted.
                                    </li>
                                    <li>
                                        If you cancel the Service before the end
                                        of your current paid-up period, your
                                        cancellation will take effect
                                        immediately, and you will not be charged
                                        again.
                                    </li>
                                    <li>
                                        We have the right to suspend or terminate
                                        your account and refuse any and all
                                        current or future use of our Services for
                                        any reason at any time. Suspension means
                                        you will not be able to access the
                                        account or any content in the account.
                                        Termination will furthermore result in
                                        the deletion of your account and the
                                        forfeiture of all content.
                                    </li>
                                    <li>
                                        Verbal, physical, written, or other abuse
                                        (including threats of abuse or
                                        retribution) of a Company representative
                                        will result in immediate account
                                        termination.
                                    </li>
                                </ol>
                            </section>

                            {/* ------------------------------------------------ */}
                            {/* MODIFICATIONS TO SERVICE AND PRICES              */}
                            {/* ------------------------------------------------ */}
                            <section>
                                <h2>Modifications to the Service and Prices</h2>
                                <ol className="mt-4">
                                    <li>
                                        We reserve the right at any time to
                                        modify or discontinue, temporarily or
                                        permanently, any part of our Services
                                        with or without notice.
                                    </li>
                                    <li>
                                        Sometimes we change the pricing structure
                                        for our products. If we change prices for
                                        existing customers, we will give at least
                                        30 days notice via the email address on
                                        record.
                                    </li>
                                </ol>
                            </section>

                            {/* ------------------------------------------------ */}
                            {/* UPTIME, SECURITY, AND PRIVACY                    */}
                            {/* ------------------------------------------------ */}
                            <section>
                                <h2>Uptime, Security, and Privacy</h2>
                                <ol className="mt-4">
                                    <li>
                                        Your use of the Services is at your sole
                                        risk. We provide these Services on an
                                        &quot;as is&quot; and &quot;as
                                        available&quot; basis.
                                    </li>
                                    <li>
                                        We take many measures to protect and
                                        secure your data through backups,
                                        redundancies, and encryption. We enforce
                                        encryption for data transmission from the
                                        public Internet.
                                    </li>
                                    <li>
                                        When you use our Services, you entrust us
                                        with your data. You agree that CyanShip
                                        may process your data as described in our{' '}
                                        <a href="privacy">Privacy Policy</a>{' '}
                                        and for no other purpose.
                                    </li>
                                </ol>
                            </section>

                            {/* ------------------------------------------------ */}
                            {/* COPYRIGHT AND CONTENT OWNERSHIP                  */}
                            {/* ------------------------------------------------ */}
                            <section>
                                <h2>Copyright and Content Ownership</h2>
                                <ol className="mt-4">
                                    <li>
                                        All content posted on the Services must
                                        comply with applicable copyright law.
                                    </li>
                                    <li>
                                        You give us a limited license to use the
                                        content posted by you in order to provide
                                        the Services to you, but we claim no
                                        ownership rights over those materials.
                                        All materials you submit to the Services
                                        remain yours.
                                    </li>
                                    <li>
                                        We do not pre-screen content, but we
                                        reserve the right (but not the
                                        obligation) in our sole discretion to
                                        refuse or remove any content that is
                                        available via the Service.
                                    </li>
                                    <li>
                                        The Company owns all right, title, and
                                        interest in and to the Services,
                                        including all intellectual property
                                        rights therein. You may not duplicate,
                                        copy, or reuse any portion of the HTML,
                                        CSS, JavaScript, or visual design
                                        elements without express written
                                        permission.
                                    </li>
                                </ol>
                            </section>

                            {/* ------------------------------------------------ */}
                            {/* FEATURES AND BUGS                                */}
                            {/* ------------------------------------------------ */}
                            <section>
                                <h2>Features and Bugs</h2>
                                <p className="mt-4">
                                    We design our Services with care. However,
                                    there is no such thing as a service that
                                    pleases everybody. We make no guarantees that
                                    our Services will meet your specific
                                    requirements or expectations. We also test
                                    all of our features extensively before
                                    shipping them. As with any software, our
                                    Services inevitably have some bugs. We track
                                    the bugs reported to us and work through
                                    priority ones, especially any related to
                                    security or privacy. Not all reported bugs
                                    will get fixed and we don&apos;t guarantee
                                    completely error-free Services.
                                </p>
                            </section>

                            {/* ------------------------------------------------ */}
                            {/* LIABILITY                                        */}
                            {/* ------------------------------------------------ */}
                            <section>
                                <h2>Liability</h2>
                                <p className="mt-4 rounded-lg border border-border bg-secondary/50 p-6 text-sm italic">
                                    You expressly understand and agree that the
                                    Company shall not be liable, in law or in
                                    equity, to you or to any third party for any
                                    direct, indirect, incidental, lost profits,
                                    special, consequential, punitive or exemplary
                                    damages, including, but not limited to,
                                    damages for loss of profits, goodwill, use,
                                    data or other intangible losses (even if the
                                    Company has been advised of the possibility
                                    of such damages), resulting from: (i) the use
                                    or the inability to use the Services; (ii)
                                    the cost of procurement of substitute goods
                                    and services; (iii) unauthorized access to or
                                    alteration of your transmissions or data;
                                    (iv) statements or conduct of any third party
                                    on the service; (v) or any other matter
                                    relating to these Terms or the Services,
                                    whether as a breach of contract, tort
                                    (including negligence whether active or
                                    passive), or any other theory of liability.
                                </p>
                                <p className="mt-4">
                                    In other words: choosing to use our Services
                                    does mean you are making a bet on us. If the
                                    bet does not work out, that&apos;s on you,
                                    not us. We do our best to be as safe a bet as
                                    possible through careful management of the
                                    business and investments in security and
                                    infrastructure.
                                </p>
                            </section>

                            {/* ------------------------------------------------ */}
                            {/* CONTACT                                          */}
                            {/* ------------------------------------------------ */}
                            <section>
                                <h2>Contact</h2>
                                <p className="mt-4">
                                    If you have a question about any of these
                                    Terms, please contact us at{' '}
                                    <a href="mailto:support@cyanship.com">
                                        support@cyanship.com
                                    </a>
                                    .
                                </p>
                            </section>

                        </div>

                        <footer className="mt-12 border-t border-border pt-8">
                            <p className="text-xs text-muted-foreground/60">
                                These terms are adapted from the{' '}
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
