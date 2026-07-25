import { fireEvent, render, screen } from '@testing-library/react';

// `next/navigation` потрібен лише nav-режиму; у panel-режимі хук не викликається,
// але імпорт модуля стягує App Router runtime, який jsdom не піднімає.
jest.mock('next/navigation', () => ({ usePathname: () => '/admin/payees' }));

import UiTabs, { uiTabPanelProps } from './UiTabs';

const ITEMS = [
    { value: 'a' as const, label: 'Перший' },
    { value: 'b' as const, label: 'Другий' },
];

describe('UiTabs (panel-режим)', () => {
    /**
     * Регресія: Headless UI рахує `aria-controls` зі своїх `TabPanel`-ів, яких у
     * нас немає (панель живе в consumer-а), і його `undefined` затирає зовнішній
     * проп. Без обхідного `as`-компонента таби лишалися б без зв'язку з панеллю.
     */
    it("зв'язує кожен таб з панеллю consumer-а через aria-controls", () => {
        render(
            <>
                <UiTabs
                    aria-label="Набір"
                    panelId="my-panel"
                    items={ITEMS}
                    value="a"
                    onChange={() => {}}
                />
                <div {...uiTabPanelProps('my-panel', 'Перший')}>Контент</div>
            </>
        );

        for (const label of ['Перший', 'Другий']) {
            expect(screen.getByRole('tab', { name: label })).toHaveAttribute(
                'aria-controls',
                'my-panel'
            );
        }
        expect(
            screen.getByRole('tabpanel', { name: 'Перший' })
        ).toHaveTextContent('Контент');
    });

    it('лишає активним таб, що відповідає переданому value', () => {
        render(
            <UiTabs
                aria-label="Набір"
                panelId="my-panel"
                items={ITEMS}
                value="b"
                onChange={() => {}}
            />
        );

        expect(screen.getByRole('tab', { name: 'Другий' })).toHaveAttribute(
            'aria-selected',
            'true'
        );
    });

    /**
     * Регресія: з нативним `disabled` Headless UI виключає таб зі своєї мапи
     * індексів і, коли `value` вказує саме на нього, тихо перекидає підсвітку на
     * наступний увімкнений — без `onChange`. Панель показувала б контент одного
     * табу, а підсвічений був би інший.
     */
    it('тримає підсвітку на переданому value, навіть якщо цей таб disabled', () => {
        render(
            <UiTabs
                aria-label="Набір"
                panelId="my-panel"
                items={[
                    { value: 'a' as const, label: 'Перший', disabled: true },
                    { value: 'b' as const, label: 'Другий' },
                ]}
                value="a"
                onChange={() => {}}
            />
        );

        expect(screen.getByRole('tab', { name: 'Перший' })).toHaveAttribute(
            'aria-selected',
            'true'
        );
        expect(screen.getByRole('tab', { name: 'Другий' })).toHaveAttribute(
            'aria-selected',
            'false'
        );
    });

    it('не викликає onChange на клік по disabled-табу', () => {
        const onChange = jest.fn();
        render(
            <UiTabs
                aria-label="Набір"
                panelId="my-panel"
                items={[
                    { value: 'a' as const, label: 'Перший' },
                    { value: 'b' as const, label: 'Другий', disabled: true },
                ]}
                value="a"
                onChange={onChange}
            />
        );

        const disabled = screen.getByRole('tab', { name: 'Другий' });
        expect(disabled).toHaveAttribute('aria-disabled', 'true');

        fireEvent.click(disabled);
        expect(onChange).not.toHaveBeenCalled();
    });
});
