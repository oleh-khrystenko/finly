import { InternalServerErrorException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { renderToStaticMarkup } from 'react-dom/server';

import { EmailService } from './email.service';

jest.mock('../../config/env', () => ({
    ENV: {
        RESEND_API_KEY: 'test-key',
        RESEND_FROM_EMAIL: 'NeatSlip <test@resend.dev>',
        WEB_URL: 'http://localhost:3000',
        ACCOUNT_DELETION_GRACE_DAYS: 2,
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

        it('should send login email with UK translations', async () => {
            await emailService.sendMagicLink({
                email,
                token,
                purpose: 'login',
                lang: 'uk',
            });

            expect(sendSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    to: email,
                    subject: 'Посилання для входу в NeatSlip',
                    react: expect.anything(),
                })
            );

            const html = getRenderedHtml();
            expect(html).toContain('Увійти');
        });

        it('should send register email with UK translations', async () => {
            await emailService.sendMagicLink({
                email,
                token,
                purpose: 'register',
                lang: 'uk',
            });

            expect(sendSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    subject: 'Ласкаво просимо до NeatSlip',
                })
            );

            const html = getRenderedHtml();
            expect(html).toContain('Завершити реєстрацію');
        });

        it('should send reset-password email with UK translations', async () => {
            await emailService.sendMagicLink({
                email,
                token,
                purpose: 'reset-password',
                lang: 'uk',
            });

            expect(sendSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    subject: 'Скидання пароля NeatSlip',
                })
            );

            const html = getRenderedHtml();
            expect(html).toContain('Скинути пароль');
        });

        it('should send delete-account email with UK translations', async () => {
            await emailService.sendMagicLink({
                email,
                token,
                purpose: 'delete-account',
                lang: 'uk',
            });

            expect(sendSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    subject: 'Підтвердження видалення акаунту',
                })
            );

            const html = getRenderedHtml();
            expect(html).toContain('Підтвердити видалення');
        });

        it('should send login email with EN translations', async () => {
            await emailService.sendMagicLink({
                email,
                token,
                purpose: 'login',
                lang: 'en',
            });

            expect(sendSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    subject: 'Your sign-in link for NeatSlip',
                })
            );

            const html = getRenderedHtml();
            expect(html).toContain('Sign In');
        });

        it('should send register email with EN translations', async () => {
            await emailService.sendMagicLink({
                email,
                token,
                purpose: 'register',
                lang: 'en',
            });

            expect(sendSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    subject: 'Welcome to NeatSlip',
                })
            );

            const html = getRenderedHtml();
            expect(html).toContain('Complete Registration');
        });

        it('should send reset-password email with EN translations', async () => {
            await emailService.sendMagicLink({
                email,
                token,
                purpose: 'reset-password',
                lang: 'en',
            });

            expect(sendSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    subject: 'Reset your NeatSlip password',
                })
            );

            const html = getRenderedHtml();
            expect(html).toContain('Reset Password');
        });

        it('should send delete-account email with EN translations', async () => {
            await emailService.sendMagicLink({
                email,
                token,
                purpose: 'delete-account',
                lang: 'en',
            });

            expect(sendSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    subject: 'Confirm account deletion',
                })
            );

            const html = getRenderedHtml();
            expect(html).toContain('Confirm Deletion');
        });

        it('should include token in verify link for login purpose', async () => {
            await emailService.sendMagicLink({
                email,
                token,
                purpose: 'login',
                lang: 'en',
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
                lang: 'en',
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
                lang: 'en',
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
                lang: 'en',
                redirectTo: '/dashboard',
            });

            const html = getRenderedHtml();
            expect(html).not.toContain('redirect=');
        });

        it('should fallback to EN when unknown lang provided', async () => {
            await emailService.sendMagicLink({
                email,
                token,
                purpose: 'login',
                lang: 'fr',
            });

            expect(sendSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    subject: 'Your sign-in link for NeatSlip',
                })
            );
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
                    lang: 'uk',
                })
            ).rejects.toThrow(InternalServerErrorException);
        });
    });

    describe('sendDeletionConfirmation', () => {
        const email = 'user@example.com';
        const deletionDate = new Date('2026-03-29T12:00:00Z');

        it('should send UK deletion confirmation', async () => {
            await emailService.sendDeletionConfirmation({
                email,
                deletionDate,
                lang: 'uk',
            });

            expect(sendSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    to: email,
                    subject: 'Ваш акаунт NeatSlip деактивовано',
                    react: expect.anything(),
                })
            );
        });

        it('should send EN deletion confirmation', async () => {
            await emailService.sendDeletionConfirmation({
                email,
                deletionDate,
                lang: 'en',
            });

            expect(sendSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    subject: 'Your NeatSlip account has been deactivated',
                })
            );
        });

        it('should include signIn link in deletion email', async () => {
            await emailService.sendDeletionConfirmation({
                email,
                deletionDate,
                lang: 'uk',
            });

            const html = getRenderedHtml();
            expect(html).toContain('http://localhost:3000/auth/signin');
        });

        it('should include formatted date in deletion email', async () => {
            await emailService.sendDeletionConfirmation({
                email,
                deletionDate,
                lang: 'en',
            });

            const html = getRenderedHtml();
            expect(html).toContain('2026');
        });

        it('should fallback to EN for unknown lang', async () => {
            await emailService.sendDeletionConfirmation({
                email,
                deletionDate,
                lang: 'fr',
            });

            expect(sendSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    subject: 'Your NeatSlip account has been deactivated',
                })
            );
        });

        it('should throw error when Resend fails', async () => {
            sendSpy.mockResolvedValue({
                error: { message: 'Send failed' },
            });

            await expect(
                emailService.sendDeletionConfirmation({
                    email,
                    deletionDate,
                    lang: 'uk',
                })
            ).rejects.toThrow(InternalServerErrorException);
        });
    });
});
