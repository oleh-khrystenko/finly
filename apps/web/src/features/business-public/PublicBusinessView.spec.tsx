import React from 'react';
import { render, screen } from '@testing-library/react';
import type { BusinessType } from '@finly/types';
import PublicBusinessView from './PublicBusinessView';

const NBU_LINKS = {
    primary: 'https://qr.bank.gov.ua/abc',
    legacy: 'https://bank.gov.ua/qr/abc',
};

/**
 * Sprint 7 §SP-5 — heading на public-сторінці бізнесу: уніфікований
 * "Платіж на користь {name}" для всіх 4 типів. До Sprint 7 був
 * type-driven шаблон ("Оплата на ${BUSINESS_TYPE_LABEL[type]} ${name}"),
 * що давав лінгвістично незграбні комбінації для individual / organization
 * і дублював юр-форму, що часто вже у назві.
 */
describe('PublicBusinessView — Sprint 7 §SP-5 type-нейтральний heading', () => {
    it.each<[BusinessType, string]>([
        ['individual', 'Іваненко І.І.'],
        ['fop', 'ФОП Іваненко'],
        ['tov', 'ТОВ Каса Здоровя'],
        ['organization', 'ОСББ Покрова'],
    ])('%s + name="%s" → heading "Платіж на користь %s"', (type, name) => {
        render(
            <PublicBusinessView
                type={type}
                name={name}
                slug="test"
                acceptedBanks={['privatbank']}
                nbuLinks={NBU_LINKS}
            />
        );
        const heading = screen.getByRole('heading', { level: 1 });
        expect(heading).toHaveTextContent(`Платіж на користь ${name}`);
    });

    it.each<BusinessType>(['individual', 'fop', 'tov', 'organization'])(
        '%s — heading НЕ містить BUSINESS_TYPE_LABEL префіксу',
        (type) => {
            render(
                <PublicBusinessView
                    type={type}
                    name="Тестовий"
                    slug="test"
                    acceptedBanks={['privatbank']}
                    nbuLinks={NBU_LINKS}
                />
            );
            const heading = screen.getByRole('heading', { level: 1 });
            // Перевіряємо, що heading НЕ починається з "Оплата на" (старий
            // pre-Sprint-7 формат) і не містить type-label-літералів.
            expect(heading.textContent).not.toMatch(/^Оплата на/);
            expect(heading.textContent).not.toContain('Я особисто');
            expect(heading.textContent).not.toContain('ФОП Тестовий ФОП');
        }
    );
});
