import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { BankCode, PurposeMarker } from '@finly/types';

const mockGetPersonalizedNbuLinks = jest.fn();

jest.mock('next/navigation', () => ({
    // Дзеркалить рантайм Next: `useSearchParams` читає ЖИВУ адресу, а сторінка
    // сама переписує її через `history.replaceState`. Статичний знімок ховав би
    // регресії, де стан форми залежить від адреси, яку вона щойно почистила.
    useSearchParams: () => new URLSearchParams(window.location.search),
}));

jest.mock('@/shared/api', () => {
    // Мінімальне дзеркало реального класу: компонент розрізняє помилки через
    // `instanceof PublicApiError` + `status`, тож клас мусить жити у моці.
    class PublicApiError extends Error {
        constructor(
            public readonly status: number,
            public readonly statusText: string
        ) {
            super(`Public API request failed: ${status} ${statusText}`);
            this.name = 'PublicApiError';
        }
    }
    return {
        PublicApiError,
        getPersonalizedNbuLinks: (...args: unknown[]) =>
            mockGetPersonalizedNbuLinks(...args),
    };
});

import { PublicApiError } from '@/shared/api';
import PersonalizedPayment from './PersonalizedPayment';

const baseProps = {
    businessSlug: 'dps-kyiv',
    account: {
        slug: 'esv',
        name: 'ЄСВ',
        bankCode: 'privatbank' as BankCode | null,
        ibanMask: '•2580',
    },
    business: {
        type: 'organization' as const,
        name: 'ДПС у м. Києві',
    },
};

const renderWith = (markers: PurposeMarker[], query = '') => {
    window.history.replaceState(
        null,
        '',
        `/dps-kyiv/esv${query ? `?${query}` : ''}`
    );
    return render(<PersonalizedPayment {...baseProps} markers={markers} />);
};

/** Валідний РНОКПП (контрольна сума сходиться). */
const VALID_TAX_ID = '3182710695';
/** Інший валідний РНОКПП — «наступний клієнт» у тестах заміни значень. */
const OTHER_VALID_TAX_ID = '3182710608';

beforeEach(() => {
    jest.useFakeTimers();
    mockGetPersonalizedNbuLinks.mockReset();
    mockGetPersonalizedNbuLinks.mockResolvedValue({
        primary: 'https://qr.bank.gov.ua/abc',
        legacy: 'https://bank.gov.ua/qr/abc',
    });
    window.history.replaceState(null, '', '/dps-kyiv/esv');
});

afterEach(() => {
    jest.useRealTimers();
});

const flushDebounce = async () => {
    await act(async () => {
        jest.advanceTimersByTime(1000);
    });
};

/** Кодування значення так, як його пише `URLSearchParams` (пробіл — `+`). */
const queryEncoded = (value: string) =>
    new URLSearchParams({ v: value }).toString().slice(2);

/**
 * QR живе під disclosure у спільному `UiPaymentOptions` (той самий «один шлях»,
 * що на звичайній вивісці: сітка банків перша, коди для іншого пристрою
 * сховані), тож тест спершу розкриває секцію.
 */
const openQrPanel = () => {
    const trigger = screen.queryByText('Показати QR для іншого пристрою');
    if (trigger) fireEvent.click(trigger);
};

const qrImage = () => {
    openQrPanel();
    return screen.queryByAltText('QR для оплати в банку');
};

describe('PersonalizedPayment (Sprint 29 — податкова персоналізація)', () => {
    describe('Debounce застосування значень', () => {
        it('набір ПІБ дає один запит посилань і один src QR, а не запит на символ', async () => {
            renderWith(['fullName']);
            const input = screen.getByLabelText(/Прізвище/);

            // 13 символів набору: без debounce це були б десятки запитів і
            // стільки ж перемальовок важкого QR-рендеру на один ввід.
            const name = 'Іваненко Іван';
            for (let i = 1; i <= name.length; i += 1) {
                fireEvent.change(input, {
                    target: { value: name.slice(0, i) },
                });
                act(() => {
                    jest.advanceTimersByTime(50);
                });
            }
            expect(mockGetPersonalizedNbuLinks).not.toHaveBeenCalled();
            expect(qrImage()).toBeNull();

            await flushDebounce();

            expect(mockGetPersonalizedNbuLinks).toHaveBeenCalledTimes(1);
            expect(mockGetPersonalizedNbuLinks).toHaveBeenCalledWith(
                'dps-kyiv',
                'esv',
                { fullName: name }
            );
            expect(qrImage()).toHaveAttribute(
                'src',
                expect.stringContaining(queryEncoded(name))
            );
            expect(window.location.search).toContain(queryEncoded(name));
        });

        it('до застосування показує очікування, а не «заповніть поля»', async () => {
            renderWith(['fullName']);
            fireEvent.change(screen.getByLabelText(/Прізвище/), {
                target: { value: 'Іваненко Іван' },
            });
            expect(screen.getByText('Готуємо QR-код...')).toBeInTheDocument();

            await flushDebounce();
            expect(screen.queryByText('Готуємо QR-код...')).toBeNull();
            expect(qrImage()).not.toBeNull();
        });

        it('заміна валідного РНОКПП іншим валідним ОДРАЗУ ховає старий QR, кнопку копіювання і чистить адресу', async () => {
            // Вікно debounce не має показувати платіж на чужі дані: бухгалтер
            // вставив номер наступного клієнта і одразу тисне «Скопіювати» —
            // без негайного скидання посилання понесло б РНОКПП попереднього.
            renderWith(['taxId'], `taxId=${VALID_TAX_ID}`);
            await flushDebounce();
            expect(qrImage()).not.toBeNull();
            expect(window.location.search).toContain(VALID_TAX_ID);

            fireEvent.change(screen.getByLabelText(/РНОКПП/), {
                target: { value: OTHER_VALID_TAX_ID },
            });
            // Ще ДО паузи набору: блок оплати схований, адреса без старого номера.
            expect(qrImage()).toBeNull();
            expect(
                screen.queryByText('Скопіювати персональне посилання')
            ).toBeNull();
            expect(window.location.search).toBe('');
            expect(screen.getByText('Готуємо QR-код...')).toBeInTheDocument();

            await flushDebounce();
            expect(window.location.search).toContain(OTHER_VALID_TAX_ID);
            expect(qrImage()).not.toBeNull();
        });

        it('передзаповнене посилання тягне спосіб оплати одразу, без очікування паузи', async () => {
            renderWith(['fullName'], 'fullName=Іваненко Іван');
            // Запит іде з першого рендера (значення вже застосовані), а не після
            // паузи набору: переслане посилання не мусить чекати debounce.
            expect(mockGetPersonalizedNbuLinks).toHaveBeenCalledTimes(1);
            expect(
                screen.queryByText(
                    'Заповніть поля вище, щоб згенерувати QR-код для оплати.'
                )
            ).toBeNull();
            await flushDebounce();
            expect(mockGetPersonalizedNbuLinks).toHaveBeenCalledTimes(1);
            expect(qrImage()).not.toBeNull();
        });
    });

    describe('Період із пересланого посилання', () => {
        it('значення поза списком опцій видиме користувачу і йде в QR', async () => {
            renderWith(['period'], 'period=2 квартал 2019');

            expect(screen.getByText('2 квартал 2019')).toBeInTheDocument();
            expect(screen.queryByText('Оберіть період')).toBeNull();

            await flushDebounce();
            expect(mockGetPersonalizedNbuLinks).toHaveBeenCalledWith(
                'dps-kyiv',
                'esv',
                { period: '2 квартал 2019' }
            );
            expect(qrImage()).toHaveAttribute(
                'src',
                expect.stringContaining(queryEncoded('2 квартал 2019'))
            );
        });

        it('невалідне значення (поза NBU-charset) не осідає у полі: дефолт видимий', async () => {
            renderWith(['period'], 'period=2 квартал 2019 ⚡');

            expect(screen.queryByText(/⚡/)).toBeNull();
            expect(screen.queryByText('Оберіть період')).toBeNull();

            const now = new Date();
            const expected = `${Math.floor(now.getMonth() / 3) + 1} квартал ${now.getFullYear()}`;
            expect(screen.getByText(expected)).toBeInTheDocument();

            await flushDebounce();
            expect(mockGetPersonalizedNbuLinks).toHaveBeenCalledWith(
                'dps-kyiv',
                'esv',
                { period: expected }
            );
        });

        it('переживає тимчасово невалідне сусіднє поле: період лишається видимим і саме він іде в QR', async () => {
            // Форма стає невалідною (платник стер цифру РНОКПП), сторінка чистить
            // адресу. Значення періоду поза списком кварталів мусить лишитись у
            // полі: інакше воно стає невидимим, а в QR іде далі, тобто платник
            // сплачує за період, якого не бачить.
            renderWith(
                ['taxId', 'period'],
                `taxId=${VALID_TAX_ID}&period=2 квартал 2019`
            );
            await flushDebounce();
            expect(screen.getByText('2 квартал 2019')).toBeInTheDocument();

            const input = screen.getByLabelText(/РНОКПП/);
            fireEvent.change(input, { target: { value: '318271069' } });
            await flushDebounce();
            expect(window.location.search).toBe('');
            expect(screen.getByText('2 квартал 2019')).toBeInTheDocument();
            expect(screen.queryByText('Оберіть період')).toBeNull();

            fireEvent.change(input, { target: { value: VALID_TAX_ID } });
            await flushDebounce();
            expect(screen.getByText('2 квартал 2019')).toBeInTheDocument();
            expect(mockGetPersonalizedNbuLinks).toHaveBeenLastCalledWith(
                'dps-kyiv',
                'esv',
                { taxId: VALID_TAX_ID, period: '2 квартал 2019' }
            );
        });
    });

    describe('Помилка РНОКПП', () => {
        it('недобір цифр і провал контрольної суми — різні причини', async () => {
            renderWith(['taxId']);
            const input = screen.getByLabelText(/РНОКПП/);

            fireEvent.change(input, { target: { value: '12345' } });
            expect(
                screen.getByText('Введіть усі 10 цифр РНОКПП')
            ).toBeInTheDocument();

            // 10 цифр з битою контрольною сумою: «введіть 10 цифр» тут збивало б
            // з пантелику, бо користувач це вже зробив.
            fireEvent.change(input, { target: { value: '1234567890' } });
            expect(screen.queryByText('Введіть усі 10 цифр РНОКПП')).toBeNull();
            expect(
                screen.getByText(
                    'РНОКПП не проходить перевірку. Перевірте, чи немає описки в цифрах'
                )
            ).toBeInTheDocument();

            fireEvent.change(input, { target: { value: VALID_TAX_ID } });
            expect(screen.queryByText(/не проходить перевірку/)).toBeNull();

            await flushDebounce();
            expect(mockGetPersonalizedNbuLinks).toHaveBeenCalledTimes(1);
            expect(mockGetPersonalizedNbuLinks).toHaveBeenCalledWith(
                'dps-kyiv',
                'esv',
                { taxId: VALID_TAX_ID }
            );
        });
    });

    describe('Класифікація помилок сервера', () => {
        it('429 (ліміт запитів) не читається як відмова на даних', async () => {
            // Бакет personalized-qr спільний для посилань і QR, а лічильник
            // спільний на всіх відвідувачів (запити доходять до API через
            // web-контейнер), тож 429 можна отримати з цілком коректним РНОКПП.
            // Порада «спробуйте коротше ПІБ» тут змушувала б правити валідні дані.
            mockGetPersonalizedNbuLinks.mockRejectedValue(
                new PublicApiError(429, 'Too Many Requests')
            );
            renderWith(['taxId'], `taxId=${VALID_TAX_ID}`);
            await flushDebounce();

            expect(screen.getByText(/Забагато запитів/)).toBeInTheDocument();
            expect(screen.queryByText(/із цими даними/)).toBeNull();
            // QR-ендпоінт відповів би тим самим 429 — картинки бути не мусить.
            expect(document.querySelector('img')).toBeNull();
        });

        it('інший 4xx лишається відмовою на самих значеннях', async () => {
            mockGetPersonalizedNbuLinks.mockRejectedValue(
                new PublicApiError(400, 'Bad Request')
            );
            renderWith(['taxId'], `taxId=${VALID_TAX_ID}`);
            await flushDebounce();

            expect(
                screen.getByText(/Не вдалося скласти платіж із цими даними/)
            ).toBeInTheDocument();
            expect(screen.queryByText(/Забагато запитів/)).toBeNull();
        });
    });
});
