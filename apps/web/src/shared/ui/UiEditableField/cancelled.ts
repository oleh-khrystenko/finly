/**
 * Sprint 4 review fix — sentinel-error для confirmation-flow з UiEditableField.
 *
 * **Проблема.** Caller (наприклад `InvoicesSettingsSection`) робить
 * confirmation-modal перед save (privacy-warning для `with-purpose`-пресета).
 * Якщо user натискає Cancel у warning, оригінальна імплементація викликала
 * `reject(new Error('Скасовано'))`, що `UiEditableField.save` ловив у `catch`
 * і показував "Скасовано" як inline-error поля — нормальна користувацька
 * дія перетворювалась на видимий error stripe. Непрофесійний UX.
 *
 * **Контракт.** Caller, що скасовує save через user-action (modal cancel,
 * ESC, click-outside), кидає `EditableFieldCancelledError`. UiEditableField
 * розпізнає цей клас і:
 *  - НЕ показує error.
 *  - Лишає field у edit-mode з draft-значенням (user може спробувати
 *    знову або змінити вибір без re-typing-у).
 *
 * Будь-яка інша помилка (network fail, validation, тощо) лишається
 * звичайним error-flow з inline-повідомленням.
 */
export class EditableFieldCancelledError extends Error {
    constructor() {
        super('EDITABLE_FIELD_CANCELLED');
        this.name = 'EditableFieldCancelledError';
    }
}
