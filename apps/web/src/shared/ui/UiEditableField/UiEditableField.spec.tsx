import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import UiEditableField from './UiEditableField';

describe('UiEditableField', () => {
    it('renders read-mode за замовчуванням з "олівцем"', () => {
        render(
            <UiEditableField<string>
                label="Назва"
                value="Іваненко"
                renderRead={(v) => <span>{v}</span>}
                renderEdit={({ value, setValue }) => (
                    <input
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                    />
                )}
                onSave={jest.fn()}
            />
        );
        expect(screen.getByText('Іваненко')).toBeInTheDocument();
        expect(screen.getByLabelText('Редагувати: Назва')).toBeInTheDocument();
    });

    it('переходить у edit-mode при кліку на "олівець"', () => {
        render(
            <UiEditableField<string>
                label="Назва"
                value="Іваненко"
                renderRead={(v) => <span>{v}</span>}
                renderEdit={({ value, setValue }) => (
                    <input
                        data-testid="edit-input"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                    />
                )}
                onSave={jest.fn()}
            />
        );
        fireEvent.click(screen.getByLabelText('Редагувати: Назва'));
        expect(screen.getByTestId('edit-input')).toBeInTheDocument();
        expect(screen.getByText('Скасувати')).toBeInTheDocument();
        expect(screen.getByText('Зберегти')).toBeInTheDocument();
    });

    it('Cancel revert-ить до read-mode без виклику onSave', () => {
        const onSave = jest.fn();
        render(
            <UiEditableField<string>
                label="Назва"
                value="Іваненко"
                renderRead={(v) => <span>{v}</span>}
                renderEdit={({ value, setValue }) => (
                    <input
                        data-testid="edit-input"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                    />
                )}
                onSave={onSave}
            />
        );
        fireEvent.click(screen.getByLabelText('Редагувати: Назва'));
        fireEvent.change(screen.getByTestId('edit-input'), {
            target: { value: 'New Name' },
        });
        fireEvent.click(screen.getByText('Скасувати'));
        expect(onSave).not.toHaveBeenCalled();
        expect(screen.getByText('Іваненко')).toBeInTheDocument();
    });

    it('Save: викликає onSave з draft значенням і повертає у read-mode', async () => {
        const onSave = jest.fn().mockResolvedValue(undefined);
        render(
            <UiEditableField<string>
                label="Назва"
                value="Іваненко"
                renderRead={(v) => <span>{v}</span>}
                renderEdit={({ value, setValue }) => (
                    <input
                        data-testid="edit-input"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                    />
                )}
                onSave={onSave}
            />
        );
        fireEvent.click(screen.getByLabelText('Редагувати: Назва'));
        fireEvent.change(screen.getByTestId('edit-input'), {
            target: { value: 'New Name' },
        });
        fireEvent.click(screen.getByText('Зберегти'));
        await waitFor(() => expect(onSave).toHaveBeenCalledWith('New Name'));
        await waitFor(() =>
            expect(screen.queryByTestId('edit-input')).not.toBeInTheDocument()
        );
    });

    it('validate fail — лишається у edit-mode, onSave не викликається', () => {
        const onSave = jest.fn();
        render(
            <UiEditableField<string>
                label="Назва"
                value="Іваненко"
                renderRead={(v) => <span>{v}</span>}
                renderEdit={({ value, setValue }) => (
                    <input
                        data-testid="edit-input"
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                    />
                )}
                validate={(v) =>
                    v.length === 0 ? 'Не може бути порожнім' : null
                }
                onSave={onSave}
            />
        );
        fireEvent.click(screen.getByLabelText('Редагувати: Назва'));
        fireEvent.change(screen.getByTestId('edit-input'), {
            target: { value: '' },
        });
        fireEvent.click(screen.getByText('Зберегти'));
        expect(onSave).not.toHaveBeenCalled();
        expect(screen.getByTestId('edit-input')).toBeInTheDocument();
    });
});
