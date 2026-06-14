import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
    SLUG_AVAILABILITY_STATUS,
    type SlugReservationView,
} from '@finly/types';
import UiSlugEditor from './UiSlugEditor';

const RESERVATION: SlugReservationView = {
    entityType: 'business',
    desiredSlug: 'acme',
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    businessSlug: 'old-slug',
    accountSlug: null,
    invoiceSlug: null,
};

function baseProps() {
    return {
        currentSlug: 'old-slug',
        prefix: 'pay.finly.com.ua/',
        publicUrl: 'https://pay.finly.com.ua/old-slug',
        ariaLabel: 'Адреса сторінки',
        validate: () => null,
        checkAvailability: jest
            .fn()
            .mockResolvedValue(SLUG_AVAILABILITY_STATUS.AVAILABLE),
        reserve: jest.fn().mockResolvedValue(RESERVATION),
        onSave: jest.fn().mockResolvedValue(undefined),
        onRegenerate: jest.fn(),
        onSubscribe: jest.fn(),
        subscribePriceLabel: 'Підписатись · 49 грн/міс',
        initialReservation: null,
        autoStartEdit: false,
    };
}

async function openEditAndType(value: string) {
    fireEvent.click(screen.getByRole('button', { name: 'Редагувати' }));
    const input = screen.getByLabelText('Адреса сторінки');
    fireEvent.change(input, { target: { value } });
    return input;
}

describe('UiSlugEditor (Sprint 20 — slug upsell flow)', () => {
    it('free: Save кладе ім\'я на холд і відкриває inline-апсел замість запису', async () => {
        const props = { ...baseProps(), isPaid: false };
        render(<UiSlugEditor {...props} />);

        await openEditAndType('acme');
        fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

        await waitFor(() => {
            expect(props.reserve).toHaveBeenCalledWith('acme');
        });
        expect(props.onSave).not.toHaveBeenCalled();
        // Апсел: прев'ю майбутньої адреси + ціновий CTA + відлік.
        expect(
            await screen.findByText('Підписатись · 49 грн/міс')
        ).toBeInTheDocument();
        expect(screen.getByText('acme')).toBeInTheDocument();
        expect(screen.getByText(/тримається за вами ще/)).toBeInTheDocument();
    });

    it('paid: Save пише slug одразу (onSave), без броні', async () => {
        const props = { ...baseProps(), isPaid: true };
        render(<UiSlugEditor {...props} />);

        await openEditAndType('acme');
        fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

        await waitFor(() => {
            expect(props.onSave).toHaveBeenCalledWith('acme');
        });
        expect(props.reserve).not.toHaveBeenCalled();
    });

    it('зайняте ім\'я не бронюється і не пишеться', async () => {
        const props = {
            ...baseProps(),
            isPaid: false,
            checkAvailability: jest
                .fn()
                .mockResolvedValue(SLUG_AVAILABILITY_STATUS.TAKEN),
        };
        render(<UiSlugEditor {...props} />);

        await openEditAndType('taken-name');
        fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

        await waitFor(() => {
            expect(props.checkAvailability).toHaveBeenCalled();
        });
        expect(props.reserve).not.toHaveBeenCalled();
        expect(props.onSave).not.toHaveBeenCalled();
    });

    it('активна бронь (initialReservation) показує апсел одразу на mount', () => {
        const props = {
            ...baseProps(),
            isPaid: false,
            initialReservation: RESERVATION,
        };
        render(<UiSlugEditor {...props} />);

        expect(
            screen.getByText('Підписатись · 49 грн/міс')
        ).toBeInTheDocument();
        expect(screen.getByText(/тримається за вами ще/)).toBeInTheDocument();
    });

    it('autoStartEdit одразу відкриває поле редагування (фолбек «оберіть інше»)', () => {
        const props = { ...baseProps(), isPaid: true, autoStartEdit: true };
        render(<UiSlugEditor {...props} />);

        expect(screen.getByLabelText('Адреса сторінки')).toBeInTheDocument();
    });

    it('autoStartEdit увімкнений ПІСЛЯ mount (поач-фолбек) відкриває поле', () => {
        const props = { ...baseProps(), isPaid: true, autoStartEdit: false };
        const { rerender } = render(<UiSlugEditor {...props} />);
        // На mount поле закрите (read-mode).
        expect(
            screen.queryByLabelText('Адреса сторінки')
        ).not.toBeInTheDocument();

        // Батько вмикає фолбек після провалу добивання наміру (SLUG_TAKEN).
        rerender(<UiSlugEditor {...props} autoStartEdit={true} />);
        expect(screen.getByLabelText('Адреса сторінки')).toBeInTheDocument();
    });

    it('upsell: збій старту оплати знімає loading з кнопки «Підписатись»', async () => {
        const onSubscribe = jest
            .fn()
            .mockRejectedValue(new Error('checkout failed'));
        const props = {
            ...baseProps(),
            isPaid: false,
            initialReservation: RESERVATION,
            onSubscribe,
        };
        render(<UiSlugEditor {...props} />);

        const cta = screen.getByRole('button', {
            name: 'Підписатись · 49 грн/міс',
        });
        fireEvent.click(cta);

        await waitFor(() => {
            expect(onSubscribe).toHaveBeenCalled();
        });
        // Після reject кнопка знову активна (loading знято) — повтор можливий.
        await waitFor(() => {
            expect(cta).not.toBeDisabled();
        });
    });

    it('paid: зміна лише регістру (case-only) доходить до onSave, не короткозамикається', async () => {
        const props = { ...baseProps(), isPaid: true, currentSlug: 'old-slug' };
        render(<UiSlugEditor {...props} />);

        await openEditAndType('OLD-SLUG');
        fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

        await waitFor(() => {
            expect(props.onSave).toHaveBeenCalledWith('OLD-SLUG');
        });
    });

    it('невалідний формат: показує live-помилку і блокує Save (без кліку)', async () => {
        const props = {
            ...baseProps(),
            isPaid: true,
            validate: (v: string) =>
                /^[a-z0-9-]+$/i.test(v) && v.length >= 3
                    ? null
                    : 'Лише латинські літери, цифри і дефіс, від 3 символів',
        };
        render(<UiSlugEditor {...props} />);

        await openEditAndType('ів'); // кирилиця + закоротко
        expect(
            await screen.findByText(
                'Лише латинські літери, цифри і дефіс, від 3 символів'
            )
        ).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Зберегти' })).toBeDisabled();
        expect(props.checkAvailability).not.toHaveBeenCalled();
    });

    it('фікс невалідного на валідне+вільне: помилка зникає, Save розблоковано', async () => {
        const props = {
            ...baseProps(),
            isPaid: true,
            validate: (v: string) =>
                /^[a-z0-9-]+$/i.test(v) && v.length >= 3
                    ? null
                    : 'Невалідний формат',
        };
        render(<UiSlugEditor {...props} />);

        const input = await openEditAndType('ів');
        expect(await screen.findByText('Невалідний формат')).toBeInTheDocument();

        fireEvent.change(input, { target: { value: 'acme' } });
        expect(await screen.findByText('Адреса вільна')).toBeInTheDocument();
        expect(
            screen.queryByText('Невалідний формат')
        ).not.toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: 'Зберегти' })
        ).not.toBeDisabled();
    });

    it('зайняте ім\'я: live-статус блокує Save до кліку', async () => {
        const props = {
            ...baseProps(),
            isPaid: true,
            checkAvailability: jest
                .fn()
                .mockResolvedValue(SLUG_AVAILABILITY_STATUS.TAKEN),
        };
        render(<UiSlugEditor {...props} />);

        await openEditAndType('taken-name');
        expect(
            await screen.findByText('Це посилання вже зайняте. Оберіть інше')
        ).toBeInTheDocument();
        await waitFor(() => {
            expect(
                screen.getByRole('button', { name: 'Зберегти' })
            ).toBeDisabled();
        });
    });

    it('free: збій броні при вільному імені → не показує «зайнято» і не відкриває апсел', async () => {
        const props = {
            ...baseProps(),
            isPaid: false,
            reserve: jest.fn().mockRejectedValue(new Error('network')),
            checkAvailability: jest
                .fn()
                .mockResolvedValue(SLUG_AVAILABILITY_STATUS.AVAILABLE),
        };
        render(<UiSlugEditor {...props} />);

        await openEditAndType('acme');
        fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

        await waitFor(() => {
            expect(props.reserve).toHaveBeenCalled();
        });
        // Лишаємось у edit-mode (апсел не відкрито), без хибного «зайнято».
        expect(
            screen.queryByText('Підписатись · 49 грн/міс')
        ).not.toBeInTheDocument();
        expect(screen.getByLabelText('Адреса сторінки')).toBeInTheDocument();
        expect(
            screen.queryByText('Це посилання вже зайняте. Оберіть інше')
        ).not.toBeInTheDocument();
    });
});
