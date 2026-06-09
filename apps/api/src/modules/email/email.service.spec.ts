import { InternalServerErrorException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { renderToStaticMarkup } from 'react-dom/server';

import { EmailService } from './email.service';
import { EMAIL_TEXT } from './translations';

jest.mock('../../config/env', () => ({
    ENV: {
        RESEND_API_KEY: 'test-key',
        RESEND_FROM_EMAIL: 'Finly <test@resend.dev>',
        WEB_URL: 'http://localhost:3000',
        ACCOUNT_DELETION_GRACE_DAYS: 2,
        ORPHAN_CLEANUP_DELETION_DAYS: 7,
    },
}));

jest.mock('resend', () => ({
    Resend: jest.fn().mockImplementation(() => ({
        emails: {
            send: jest.fn().mockResolvedValue({ error: null }),
        },
    })),
}));

describe('EmailService', () => {
    let emailService: EmailService;
    let sendSpy: jest.Mock;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [EmailService],
        }).compile();

        emailService = module.get<EmailService>(EmailService);
        sendSpy = (emailService as any).resend.emails.send;
        jest.clearAllMocks();
    });

    function getRenderedHtml(): string {
        const reactEl = sendSpy.mock.calls[0][0].react;
        return renderToStaticMarkup(reactEl);
    }

    describe('sendMagicLink', () => {
        const email = 'user@example.com';
        const token = 'abc123';

        it('should send login email', async () => {
            await emailService.sendMagicLink({
                email,
                token,
                purpose: 'login',
            });

            expect(sendSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    to: email,
                    subject: 'Посилання для входу в Finly',
                    react: expect.anything(),
                })
            );

            const html = getRenderedHtml();
            expect(html).toContain('Увійти');
            expect(html).toContain('lang="uk"');
        });

        it('should send register email', async () => {
            await emailService.sendMagicLink({
                email,
                token,
                purpose: 'register',
            });

            expect(sendSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    subject: 'Ласкаво просимо до Finly',
                })
            );

            const html = getRenderedHtml();
            expect(html).toContain('Завершити реєстрацію');
        });

        it('should send reset-password email', async () => {
            await emailService.sendMagicLink({
                email,
                token,
                purpose: 'reset-password',
            });

            expect(sendSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    subject: 'Скидання пароля Finly',
                })
            );

            const html = getRenderedHtml();
            expect(html).toContain('Скинути пароль');
        });

        it('should send delete-account email', async () => {
            await emailService.sendMagicLink({
                email,
                token,
                purpose: 'delete-account',
            });

            expect(sendSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    subject: 'Підтвердження видалення акаунту',
                })
            );

            const html = getRenderedHtml();
            expect(html).toContain('Підтвердити видалення');
        });

        it('should include token in verify link for login purpose', async () => {
            await emailService.sendMagicLink({
                email,
                token,
                purpose: 'login',
            });

            const html = getRenderedHtml();
            expect(html).toContain(
                `http://localhost:3000/auth/verify?token=${token}`
            );
        });

        it('should include token in reset-password link', async () => {
            await emailService.sendMagicLink({
                email,
                token,
                purpose: 'reset-password',
            });

            const html = getRenderedHtml();
            expect(html).toContain(
                `http://localhost:3000/auth/reset-password?token=${token}`
            );
        });

        it('should append redirectTo for non-reset purposes', async () => {
            await emailService.sendMagicLink({
                email,
                token,
                purpose: 'login',
                redirectTo: '/dashboard',
            });

            const html = getRenderedHtml();
            expect(html).toContain(
                `redirect=${encodeURIComponent('/dashboard')}`
            );
        });

        it('should not append redirectTo for reset-password', async () => {
            await emailService.sendMagicLink({
                email,
                token,
                purpose: 'reset-password',
                redirectTo: '/dashboard',
            });

            const html = getRenderedHtml();
            expect(html).not.toContain('redirect=');
        });

        it('should throw error when Resend fails', async () => {
            sendSpy.mockResolvedValue({
                error: { message: 'Send failed' },
            });

            await expect(
                emailService.sendMagicLink({
                    email,
                    token,
                    purpose: 'login',
                })
            ).rejects.toThrow(InternalServerErrorException);
        });
    });

    describe('sendDeletionConfirmation', () => {
        const email = 'user@example.com';
        const deletionDate = new Date('2026-03-29T12:00:00Z');

        it('should send deletion confirmation', async () => {
            await emailService.sendDeletionConfirmation({
                email,
                deletionDate,
            });

            expect(sendSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    to: email,
                    subject: 'Ваш акаунт Finly деактивовано',
                    react: expect.anything(),
                })
            );
        });

        it('should include signIn link in deletion email', async () => {
            await emailService.sendDeletionConfirmation({
                email,
                deletionDate,
            });

            const html = getRenderedHtml();
            expect(html).toContain('http://localhost:3000/auth/signin');
        });

        it('should include formatted date in Ukrainian locale', async () => {
            await emailService.sendDeletionConfirmation({
                email,
                deletionDate,
            });

            const html = getRenderedHtml();
            expect(html).toContain('2026');
            expect(html).toContain('березня');
        });

        it('should throw error when Resend fails', async () => {
            sendSpy.mockResolvedValue({
                error: { message: 'Send failed' },
            });

            await expect(
                emailService.sendDeletionConfirmation({
                    email,
                    deletionDate,
                })
            ).rejects.toThrow(InternalServerErrorException);
        });
    });

    describe('sendProfileCompletionReminder (Sprint 12 §12.1b)', () => {
        const user = { email: 'fop@example.com' };

        const buildBusiness = (name: string) => ({ name });

        it('single-business render uses singleSubject and contains business name in body', async () => {
            await emailService.sendProfileCompletionReminder({
                user,
                businesses: [buildBusiness('ФОП Іваненко')],
            });

            expect(sendSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    to: 'fop@example.com',
                    subject: 'Завершіть налаштування акаунту Finly',
                })
            );

            const html = getRenderedHtml();
            expect(html).toContain('«ФОП Іваненко»');
            expect(html).toContain('бізнес «ФОП Іваненко»');
            expect(html).toContain('Заповнити профіль');
            expect(html).toContain('7 днів');
            expect(html).toContain(
                'http://localhost:3000/profile?mode=new&amp;next=/business'
            );
        });

        it('multi-business (3) render uses few-form "бізнеси" and lists all names', async () => {
            await emailService.sendProfileCompletionReminder({
                user,
                businesses: [
                    buildBusiness('BizA'),
                    buildBusiness('BizB'),
                    buildBusiness('BizC'),
                ],
            });

            const html = getRenderedHtml();
            expect(html).toContain('3 бізнеси');
            expect(html).toContain('«BizA», «BizB», «BizC»');
            // Naming-конвенція (рахунок→реквізити): копія вживає інваріантне
            // «реквізити», старе «рахунок/рахунки/рахунків» не повертається.
            expect(html).toContain('реквізити');
            expect(html).not.toContain('рахун');
        });

        it('multi-business (5) render uses many-form "бізнесів"', async () => {
            await emailService.sendProfileCompletionReminder({
                user,
                businesses: [
                    buildBusiness('Biz1'),
                    buildBusiness('Biz2'),
                    buildBusiness('Biz3'),
                    buildBusiness('Biz4'),
                    buildBusiness('Biz5'),
                ],
            });

            const html = getRenderedHtml();
            expect(html).toContain('5 бізнесів');
            expect(html).toContain('реквізити');
            expect(html).not.toContain('рахун');
        });

        it('throws InternalServerErrorException when Resend fails', async () => {
            sendSpy.mockResolvedValue({ error: { message: 'Send failed' } });

            await expect(
                emailService.sendProfileCompletionReminder({
                    user,
                    businesses: [buildBusiness('ФОП Іваненко')],
                })
            ).rejects.toThrow(InternalServerErrorException);
        });
    });

    describe('sendProfileCompletionFinalWarning (Sprint 12 §12.1b)', () => {
        const user = { email: 'fop@example.com' };

        const buildBusiness = (name: string) => ({ name });

        it('single-business render uses singleSubject and contains "Це останнє нагадування"', async () => {
            await emailService.sendProfileCompletionFinalWarning({
                user,
                businesses: [buildBusiness('ФОП Іваненко')],
            });

            expect(sendSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    to: 'fop@example.com',
                    subject: 'Останнє нагадування про незаповнений профіль',
                })
            );

            const html = getRenderedHtml();
            expect(html).toContain('Завтра бізнес «ФОП Іваненко»');
            expect(html).toContain('Це останнє нагадування');
            expect(html).toContain('Заповнити профіль');
        });

        it('multi-business (3) render uses few-form "бізнеси" and lists all names', async () => {
            await emailService.sendProfileCompletionFinalWarning({
                user,
                businesses: [
                    buildBusiness('BizA'),
                    buildBusiness('BizB'),
                    buildBusiness('BizC'),
                ],
            });

            const html = getRenderedHtml();
            expect(html).toContain('Завтра 3 бізнеси');
            expect(html).toContain('«BizA», «BizB», «BizC»');
        });

        it('copy-strings contain no exclamation marks (tone classic-polite)', () => {
            const reminder = EMAIL_TEXT.profileCompletion.reminder;
            const finalWarning = EMAIL_TEXT.profileCompletion.finalWarning;
            const allText = [
                reminder.singleSubject,
                reminder.multiSubject,
                reminder.cta,
                reminder.singleBody('Біз', 7),
                reminder.multiBody(['A', 'B', 'C'], 7),
                finalWarning.singleSubject,
                finalWarning.multiSubject,
                finalWarning.cta,
                finalWarning.singleBody('Біз'),
                finalWarning.multiBody(['A', 'B', 'C']),
            ].join('\n');
            expect(allText).not.toMatch(/[!]/);
        });

        it('throws InternalServerErrorException when Resend fails', async () => {
            sendSpy.mockResolvedValue({ error: { message: 'Send failed' } });

            await expect(
                emailService.sendProfileCompletionFinalWarning({
                    user,
                    businesses: [buildBusiness('ФОП Іваненко')],
                })
            ).rejects.toThrow(InternalServerErrorException);
        });
    });
});
