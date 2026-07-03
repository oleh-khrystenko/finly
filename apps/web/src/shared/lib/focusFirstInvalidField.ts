import type { BaseSyntheticEvent } from 'react';

/**
 * onInvalid-handler для RHF `handleSubmit(onValid, onInvalid)` у формах,
 * де є поля без ref (radio-картки, селекти через `setValue`, Controller
 * без `field.ref`). Вбудований `shouldFocusError` RHF фокусить лише
 * registered-поля з ref і в порядку реєстрації, тож у змішаних формах
 * пропускає перше по DOM невалідне поле — у таких формах його вимикають
 * (`shouldFocusError: false`) і підключають цей handler.
 *
 * Ціль шукається за `aria-invalid="true"` — контракт Ui-примітивів
 * (UiInput/UiTextarea/UiSelect/UiRadioCardGroup ставлять атрибут при
 * `error`). `requestAnimationFrame` — бо помилки з'являються у DOM після
 * React-коміту, що стається після виходу з submit-handler-а.
 *
 * `aria-invalid` може стояти на нефокусованому контейнері: Headless UI
 * `RadioGroup` — це `div role="radiogroup"` без tabIndex (roving tabindex
 * живе на `Radio`-опціях). `.focus()` на такому елементі — тихий no-op,
 * тож фокусимо focusable-нащадка з `tabindex="0"` (roving-активна опція);
 * скрол лишається на контейнері, щоб відцентрувати всю групу з помилкою.
 */
export function focusFirstInvalidField(
    _errors: unknown,
    event?: BaseSyntheticEvent
): void {
    const target = event?.target;
    if (!(target instanceof HTMLElement)) return;
    const scope = target.closest('form') ?? target;

    requestAnimationFrame(() => {
        const invalid = scope.querySelector<HTMLElement>(
            '[aria-invalid="true"]'
        );
        if (!invalid) return;
        const focusTarget =
            invalid.tabIndex >= 0
                ? invalid
                : (invalid.querySelector<HTMLElement>('[tabindex="0"]') ??
                  invalid);
        focusTarget.focus({ preventScroll: true });
        invalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
}
