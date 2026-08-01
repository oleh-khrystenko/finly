import { render, screen } from '@testing-library/react';

jest.mock('@/shared/lib', () => {
    const actual =
        jest.requireActual<typeof import('@/shared/lib')>('@/shared/lib');
    return {
        ...actual,
        detectClientPlatform: jest.fn(),
    };
});

import { detectClientPlatform } from '@/shared/lib';
import UiBankAppGrid from './UiBankAppGrid';

const detectClientPlatformMock = jest.mocked(detectClientPlatform);

describe('UiBankAppGrid', () => {
    it('приховує ПУМБ на Android', () => {
        detectClientPlatformMock.mockReturnValue('android');

        render(
            <UiBankAppGrid
                nbuLegacyLink="https://bank.gov.ua/qr/payload"
                nbuFallbackLink="https://qr.bank.gov.ua/payload"
                banks={['pumb', 'monobank']}
            />
        );

        expect(
            screen.queryByRole('button', { name: 'Оплатити через ПУМБ' })
        ).not.toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: 'Оплатити через monobank' })
        ).toBeInTheDocument();
    });
});
