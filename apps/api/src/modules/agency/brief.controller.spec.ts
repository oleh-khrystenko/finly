import { Test, TestingModule } from '@nestjs/testing';
import { RESPONSE_CODE } from '@cyanship/types';
import { BadRequestException } from '@nestjs/common';

import { BriefController } from './brief.controller';
import { BriefService } from './services/brief.service';
import { TurnstileService } from './services/turnstile.service';

jest.mock('../../config/env', () => ({
    ENV: {},
}));

const mockBriefService = {
    submit: jest.fn().mockResolvedValue(undefined),
};

const mockTurnstileService = {
    verify: jest.fn().mockResolvedValue(undefined),
};

const testDto = {
    name: 'John Doe',
    email: 'john@example.com',
    description: 'A project description',
    budget: 'under_2500',
    lang: 'en',
    captchaToken: 'test-token',
} as any;

describe('BriefController', () => {
    let controller: BriefController;

    beforeEach(async () => {
        jest.clearAllMocks();
        mockBriefService.submit.mockResolvedValue(undefined);
        mockTurnstileService.verify.mockResolvedValue(undefined);

        const module: TestingModule = await Test.createTestingModule({
            controllers: [BriefController],
            providers: [
                { provide: BriefService, useValue: mockBriefService },
                { provide: TurnstileService, useValue: mockTurnstileService },
            ],
        }).compile();

        controller = module.get(BriefController);
    });

    it('verifies Turnstile before submitting brief', async () => {
        const callOrder: string[] = [];
        mockTurnstileService.verify.mockImplementation(async () => {
            callOrder.push('verify');
        });
        mockBriefService.submit.mockImplementation(async () => {
            callOrder.push('submit');
        });

        await controller.submitBrief(testDto, '127.0.0.1');

        expect(callOrder).toEqual(['verify', 'submit']);
    });

    it('calls turnstile.verify with captchaToken and ip', async () => {
        await controller.submitBrief(testDto, '192.168.1.1');

        expect(mockTurnstileService.verify).toHaveBeenCalledWith(
            'test-token',
            '192.168.1.1'
        );
    });

    it('does not call submit when Turnstile fails', async () => {
        mockTurnstileService.verify.mockRejectedValue(
            new BadRequestException({
                code: RESPONSE_CODE.CAPTCHA_FAILED,
            })
        );

        await expect(
            controller.submitBrief(testDto, '127.0.0.1')
        ).rejects.toThrow(BadRequestException);

        expect(mockBriefService.submit).not.toHaveBeenCalled();
    });

    it('returns correct response envelope on success', async () => {
        const result = await controller.submitBrief(testDto, '127.0.0.1');

        expect(result).toEqual({
            data: null,
            code: RESPONSE_CODE.BRIEF_SUBMITTED,
        });
    });
});
